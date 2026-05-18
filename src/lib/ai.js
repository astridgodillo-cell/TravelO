import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

// Au-delà de ce nombre de jours, on bascule en mode plan+expand
// pour rester sous le wall-clock limit des Edge Functions (150s plan gratuit).
const SHORT_TRIP_MAX_DAYS = 8;
const EXPAND_CONCURRENCY = 3;

async function readErrorDetail(error) {
  try {
    if (error?.context?.response) {
      const body = await error.context.response.text();
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error) return parsed.error;
      } catch {
        if (body) return body.slice(0, 500);
      }
    }
  } catch {
    // ignore
  }
  return error?.context?.error || error?.message || null;
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
    const detail = await readErrorDetail(error);
    throw new Error(detail || 'Erreur Edge Function');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function generateItinerary(preferences, onProgress) {
  const days = computeDurationDays(preferences.startDate, preferences.endDate);

  // Petits voyages : un seul appel (plus rapide grâce au prompt caching).
  if (days > 0 && days <= SHORT_TRIP_MAX_DAYS) {
    onProgress?.({ phase: 'generating', current: 0, total: 1 });
    const data = await invoke({ preferences });
    if (!data?.itinerary) throw new Error('Réponse vide reçue.');
    onProgress?.({ phase: 'generating', current: 1, total: 1 });
    return data.itinerary;
  }

  // Long voyages : plan + expand parallèle.
  onProgress?.({ phase: 'planning' });
  const planData = await invoke({ mode: 'plan-trip', preferences });
  const plan = planData?.plan;
  if (!plan?.day_plans?.length) {
    throw new Error('Plan reçu vide. Relancez la génération.');
  }

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
  return {
    ...itinerary,
    days: newDays,
    summary: { ...itinerary.summary, ...budget.summaryPatch },
    budget_summary: { ...itinerary.budget_summary, ...budget.budget_summary },
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
