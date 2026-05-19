import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

// Au-delà de ce nombre de jours, on bascule en mode plan+expand
// pour rester sous le wall-clock limit des Edge Functions (150s plan gratuit).
const SHORT_TRIP_MAX_DAYS = 8;
// Concurrence faible pour éviter de saturer le quota Anthropic
// (output tokens per minute). 2 = bon compromis vitesse/sécurité.
const EXPAND_CONCURRENCY = 2;

// Prix en USD par million de tokens. À mettre à jour si la tarification évolue.
const PRICING = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached_input: 0.075 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached_input: 0.025 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cached_input: 0.31 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cached_input: 0.3 },
  'claude-sonnet-4-6': { input: 3, output: 15, cached_input: 0.3 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cached_input: 0.1 },
};
const USD_TO_EUR = 0.92;

function pricingFor(model) {
  return (
    PRICING[model] ||
    (model?.includes('gemini') ? PRICING['gemini-2.5-flash'] : PRICING['claude-haiku-4-5-20251001'])
  );
}

function computeCallCost(model, usage) {
  if (!usage) return 0;
  const p = pricingFor(model);
  const cached = usage.cache_read_input_tokens || 0;
  const uncachedInput = Math.max(0, (usage.input_tokens || 0) - cached);
  const output = usage.output_tokens || 0;
  return (
    (uncachedInput * p.input + cached * p.cached_input + output * p.output) /
    1_000_000
  );
}

function emptyMeta() {
  return {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cached_input_tokens: 0,
    total_cost_usd: 0,
    models_used: [],
    call_count: 0,
    last_updated: new Date().toISOString(),
  };
}

function addUsageToMeta(meta, model, usage) {
  const m = { ...(meta || emptyMeta()) };
  if (!m.models_used) m.models_used = [];
  if (usage) {
    m.total_input_tokens += usage.input_tokens || 0;
    m.total_output_tokens += usage.output_tokens || 0;
    m.total_cached_input_tokens += usage.cache_read_input_tokens || 0;
    m.total_cost_usd += computeCallCost(model, usage);
    if (model && !m.models_used.includes(model)) m.models_used.push(model);
    m.call_count = (m.call_count || 0) + 1;
  }
  m.last_updated = new Date().toISOString();
  return m;
}

export function costEur(usd) {
  if (typeof usd !== 'number' || !isFinite(usd)) return null;
  return usd * USD_TO_EUR;
}

async function readErrorDetail(error) {
  try {
    // En supabase-js v2, error.context EST la Response (pour FunctionsHttpError)
    const ctx = error?.context;
    if (ctx && typeof ctx.text === 'function') {
      const body = await ctx.text();
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error) return parsed.error;
        return body.slice(0, 500);
      } catch {
        if (body) return body.slice(0, 500);
      }
    }
  } catch (e) {
    console.error('[ai] readErrorDetail failed:', e);
  }
  return error?.message || null;
}

function computeDurationDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.round((end - start) / 86400000) + 1;
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke(FN_NAME, { body });
  if (error) {
    console.error('[ai] Edge Function error:', error, 'body sent:', body?.mode || 'generate');
    const detail = await readErrorDetail(error);
    throw new Error(detail || 'Erreur Edge Function');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function generateItinerary(preferences, onProgress) {
  const days = computeDurationDays(preferences.startDate, preferences.endDate);
  let meta = emptyMeta();

  // Petits voyages : un seul appel (plus rapide grâce au prompt caching).
  if (days > 0 && days <= SHORT_TRIP_MAX_DAYS) {
    onProgress?.({ phase: 'generating', current: 0, total: 1 });
    const data = await invoke({ preferences });
    if (!data?.itinerary) throw new Error('Réponse vide reçue.');
    meta = addUsageToMeta(meta, data.model, data.usage);
    onProgress?.({ phase: 'generating', current: 1, total: 1 });
    return { ...data.itinerary, metadata: meta };
  }

  // Long voyages : plan + expand parallèle.
  onProgress?.({ phase: 'planning' });
  const planData = await invoke({ mode: 'plan-trip', preferences });
  const plan = planData?.plan;
  if (!plan?.day_plans?.length) {
    throw new Error('Plan reçu vide. Relancez la génération.');
  }
  meta = addUsageToMeta(meta, planData.model, planData.usage);

  const total = plan.day_plans.length;
  const expandedDays = new Array(total);
  let done = 0;
  onProgress?.({ phase: 'expanding', current: 0, total });

  for (let i = 0; i < total; i += EXPAND_CONCURRENCY) {
    const batch = plan.day_plans.slice(i, i + EXPAND_CONCURRENCY);
    await Promise.all(
      batch.map(async (dayPlan, idxInBatch) => {
        const dayIndex = i + idxInBatch;
        const data = await invoke({
          mode: 'expand-day',
          preferences,
          day_plan: dayPlan,
          previous_plan: plan.day_plans[dayIndex - 1] || null,
          next_plan: plan.day_plans[dayIndex + 1] || null,
        });
        if (!data?.day) throw new Error(`Jour ${dayPlan.label} vide.`);
        expandedDays[dayIndex] = data.day;
        // Note : on cumule dans meta de façon thread-unsafe mais OK car JS mono-thread
        meta = addUsageToMeta(meta, data.model, data.usage);
        done += 1;
        onProgress?.({ phase: 'expanding', current: done, total });
      })
    );
  }

  onProgress?.({ phase: 'assembling' });
  const budget = computeBudget(expandedDays, plan.summary);
  return {
    summary: { ...plan.summary, ...budget.summaryPatch },
    days: expandedDays,
    budget_summary: budget.budget_summary,
    notes: plan.notes || {},
    metadata: meta,
  };
}

export async function replanFromDay(itinerary, fromDayIndex, instructions) {
  const data = await invoke({
    mode: 'replan-from-day',
    itinerary,
    from_day_index: fromDayIndex,
    instructions,
  });
  if (!Array.isArray(data?.days)) {
    throw new Error('Réponse vide pour la replanification.');
  }
  const before = itinerary.days.slice(0, fromDayIndex);
  const newDays = [...before, ...data.days];
  const budget = computeBudget(newDays, itinerary.summary);
  const metadata = addUsageToMeta(itinerary.metadata, data.model, data.usage);
  return {
    ...itinerary,
    days: newDays,
    summary: { ...itinerary.summary, ...budget.summaryPatch },
    budget_summary: { ...itinerary.budget_summary, ...budget.budget_summary },
    metadata,
  };
}

export async function regenerateActivity(
  itinerary,
  dayIndex,
  activityIndex,
  instructions
) {
  const data = await invoke({
    mode: 'regenerate-activity',
    itinerary,
    day_index: dayIndex,
    activity_index: activityIndex,
    instructions,
  });
  if (!data?.activity) {
    throw new Error('Réponse vide pour l\'activité.');
  }
  const metadata = addUsageToMeta(itinerary.metadata, data.model, data.usage);
  const newDays = itinerary.days.map((d, di) => {
    if (di !== dayIndex) return d;
    const newActivities = d.activities.map((a, ai) =>
      ai === activityIndex ? data.activity : a
    );
    return { ...d, activities: newActivities };
  });
  // Recalcul du jour + budget global
  const budget = computeBudget(newDays, itinerary.summary);
  // Patch day_total_eur du jour modifié
  const dayActivitiesTotal = (newDays[dayIndex].activities || []).reduce(
    (s, a) => s + (a.family_total_eur || 0),
    0
  );
  const oldActivitiesTotal = (itinerary.days[dayIndex].activities || []).reduce(
    (s, a) => s + (a.family_total_eur || 0),
    0
  );
  newDays[dayIndex] = {
    ...newDays[dayIndex],
    day_total_eur:
      (newDays[dayIndex].day_total_eur || 0) +
      dayActivitiesTotal -
      oldActivitiesTotal,
  };
  return {
    ...itinerary,
    days: newDays,
    summary: { ...itinerary.summary, ...budget.summaryPatch },
    budget_summary: { ...itinerary.budget_summary, ...budget.budget_summary },
    metadata,
  };
}

export function removeActivity(itinerary, dayIndex, activityIndex) {
  const newDays = itinerary.days.map((d, di) => {
    if (di !== dayIndex) return d;
    const removed = d.activities?.[activityIndex];
    const removedCost = removed?.family_total_eur || 0;
    const newActivities = (d.activities || []).filter(
      (_, ai) => ai !== activityIndex
    );
    return {
      ...d,
      activities: newActivities,
      day_total_eur: (d.day_total_eur || 0) - removedCost,
    };
  });
  const budget = computeBudget(newDays, itinerary.summary);
  return {
    ...itinerary,
    days: newDays,
    summary: { ...itinerary.summary, ...budget.summaryPatch },
    budget_summary: { ...itinerary.budget_summary, ...budget.budget_summary },
  };
}

export async function regenerateDay(itinerary, dayIndex, instructions) {
  const data = await invoke({
    mode: 'regenerate-day',
    itinerary,
    day_index: dayIndex,
    instructions,
  });
  if (!data?.day) throw new Error('Réponse vide pour la journée régénérée.');

  const newDays = itinerary.days.map((d, i) => (i === dayIndex ? data.day : d));
  const budget = computeBudget(newDays, itinerary.summary);
  const metadata = addUsageToMeta(itinerary.metadata, data.model, data.usage);
  return {
    ...itinerary,
    days: newDays,
    summary: { ...itinerary.summary, ...budget.summaryPatch },
    budget_summary: { ...itinerary.budget_summary, ...budget.budget_summary },
    metadata,
  };
}

function computeBudget(days, summary) {
  let trips = 0,
    fuel = 0,
    tolls = 0,
    ferries = 0,
    accommodation = 0,
    meals = 0,
    activities = 0,
    service = 0,
    distance = 0;

  for (const d of days || []) {
    for (const t of d.trips || []) {
      trips += t.estimated_cost_eur || 0;
      fuel += t.fuel_cost_eur || 0;
      tolls += t.toll_cost_eur || 0;
      ferries += t.ferry_cost_eur || 0;
      distance += t.distance_km || 0;
    }
    accommodation += d.accommodation?.price_eur || 0;
    meals += d.meals?.daily_family_budget_eur || 0;
    for (const a of d.activities || []) {
      activities += a.family_total_eur || 0;
    }
    for (const s of d.service_stops || []) {
      service += s.estimated_cost_eur || 0;
    }
  }

  const grand = trips + accommodation + meals + activities + service;
  const heads =
    (summary?.travellers?.adults || 1) +
    (summary?.travellers?.children_ages?.length || 0);

  return {
    summaryPatch: {
      total_distance_km: distance > 0 ? distance : summary?.total_distance_km,
    },
    budget_summary: {
      trips_eur: trips,
      fuel_eur: fuel,
      tolls_eur: tolls,
      ferries_eur: ferries,
      accommodation_eur: accommodation,
      meals_eur: meals,
      activities_eur: activities,
      service_stops_eur: service,
      grand_total_eur: grand,
      per_person_eur: Math.round(grand / Math.max(heads, 1)),
      currency: 'EUR',
    },
  };
}
