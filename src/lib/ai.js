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
  'deepseek-chat': { input: 0.27, output: 1.1, cached_input: 0.07 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cached_input: 0.14 },
};
const USD_TO_EUR = 0.92;

function pricingFor(model) {
  if (PRICING[model]) return PRICING[model];
  if (model?.includes('gemini')) return PRICING['gemini-2.5-flash'];
  if (model?.includes('deepseek')) return PRICING['deepseek-chat'];
  return PRICING['claude-haiku-4-5-20251001'];
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

const WEEKDAYS_FR = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
];

// Filet de sécurité : dédoublonne activités et spécialités culinaires
// dans l'ensemble de l'itinéraire (au cas où le modèle se trompe malgré
// les instructions du prompt). Limite aussi à 2 spécialités par jour.
function dedupeItinerary(itinerary) {
  if (!itinerary?.days) return itinerary;
  const seenActivities = new Set();
  const seenSpecialties = new Set();
  for (const day of itinerary.days) {
    if (Array.isArray(day.activities)) {
      day.activities = day.activities.filter((a) => {
        const key = (a?.title || '').toLowerCase().trim();
        if (!key) return true;
        if (seenActivities.has(key)) return false;
        seenActivities.add(key);
        return true;
      });
    }
    if (Array.isArray(day.culinary_specialties)) {
      day.culinary_specialties = day.culinary_specialties
        .filter((s) => {
          const key = (s?.name || '').toLowerCase().trim();
          if (!key) return true;
          if (seenSpecialties.has(key)) return false;
          seenSpecialties.add(key);
          return true;
        })
        .slice(0, 2);
    }
  }
  return itinerary;
}

function isoAddDays(startIso, days) {
  const d = new Date(startIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return {
    iso: d.toISOString().slice(0, 10),
    weekday: WEEKDAYS_FR[d.getUTCDay()],
  };
}

// Réécrit les dates (start/end/duration + chaque jour) en se basant
// sur les préférences utilisateur. Évite que l'IA hallucine les dates.
function normalizeItineraryDates(itinerary, preferences, dayArrayKey = 'days') {
  const expectedDays = computeDurationDays(
    preferences.startDate,
    preferences.endDate
  );
  if (!itinerary.summary) itinerary.summary = {};
  itinerary.summary.start_date = preferences.startDate;
  itinerary.summary.end_date = preferences.endDate;
  itinerary.summary.duration_days = expectedDays;

  const arr = itinerary[dayArrayKey];
  if (Array.isArray(arr)) {
    itinerary[dayArrayKey] = arr.slice(0, expectedDays).map((d, i) => {
      const { iso, weekday } = isoAddDays(preferences.startDate, i);
      return { ...d, label: `J${i + 1}`, date: iso, weekday };
    });
  }
  return itinerary;
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
    // Normalise les dates : on force celles de l'utilisateur, l'IA hallucine parfois
    normalizeItineraryDates(data.itinerary, preferences, 'days');
    dedupeItinerary(data.itinerary);
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

  // Si le plan a une mauvaise durée, c'est que le modèle s'est trompé sur les dates.
  // On informe l'utilisateur pour qu'il relance.
  if (plan.day_plans.length !== days) {
    throw new Error(
      `Le plan généré a ${plan.day_plans.length} jours mais ${days} étaient demandés (du ${preferences.startDate} au ${preferences.endDate}). Veuillez régénérer — le modèle s'est trompé sur la durée.`
    );
  }

  // Normalise les dates de chaque day_plan
  normalizeItineraryDates(plan, preferences, 'day_plans');

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
        // Force le label, date, weekday du jour à correspondre au plan normalisé
        // (sinon l'expansion peut renvoyer des dates inventées).
        expandedDays[dayIndex] = {
          ...data.day,
          label: dayPlan.label,
          date: dayPlan.date,
          weekday: dayPlan.weekday,
        };
        // Note : on cumule dans meta de façon thread-unsafe mais OK car JS mono-thread
        meta = addUsageToMeta(meta, data.model, data.usage);
        done += 1;
        onProgress?.({ phase: 'expanding', current: done, total });
      })
    );
  }

  onProgress?.({ phase: 'assembling' });

  // Vérification finale : on doit avoir EXACTEMENT le bon nombre de jours,
  // et chaque jour doit avoir du contenu (pas un trou dans expandedDays).
  const filledCount = expandedDays.filter(Boolean).length;
  if (filledCount !== days) {
    throw new Error(
      `Itinéraire incomplet : ${filledCount} jours générés sur ${days} attendus. Veuillez régénérer.`
    );
  }

  const budget = computeBudget(expandedDays, plan.summary);
  const itinerary = {
    summary: { ...plan.summary, ...budget.summaryPatch },
    days: expandedDays,
    budget_summary: budget.budget_summary,
    notes: plan.notes || {},
    metadata: meta,
  };
  dedupeItinerary(itinerary);
  return itinerary;
}

// 3 catégories appelées en PARALLÈLE pour obtenir ~45-50 lieux au total
// (15-18 par catégorie) avec des descriptions évocatrices.
// Un 4ème appel en parallèle récupère les villes principales (si destination = pays/région).
const PLACE_CATEGORIES = ['incontournable', 'insolite', 'hors-sentiers'];

export async function suggestPlaces({
  destination,
  tripType,
  startDate,
  endDate,
  adults,
  childrenAges,
  onCategoryReady,
  onCitiesReady,
}) {
  const baseArgs = {
    destination,
    tripType,
    startDate,
    endDate,
    adults,
    childrenAges,
  };

  // Villes principales (4ème appel parallèle, indépendant)
  const citiesPromise = (async () => {
    try {
      const data = await invoke({ mode: 'suggest-cities', ...baseArgs });
      const cities = Array.isArray(data?.cities) ? data.cities : [];
      onCitiesReady?.(cities);
      return cities;
    } catch (err) {
      console.warn('[suggest-cities] échec', err);
      onCitiesReady?.([]);
      return [];
    }
  })();

  const placesPromise = Promise.all(
    PLACE_CATEGORIES.map(async (category) => {
      try {
        const data = await invoke({
          mode: 'suggest-places',
          ...baseArgs,
          category,
        });
        const places = Array.isArray(data?.places) ? data.places : [];
        const normalized = places.map((p) => ({ ...p, category }));
        onCategoryReady?.(category, normalized);
        return normalized;
      } catch (err) {
        console.warn(`[suggest-places] ${category} a échoué`, err);
        return [];
      }
    })
  );

  const [cities, placesGroups] = await Promise.all([
    citiesPromise,
    placesPromise,
  ]);
  const places = placesGroups.flat();
  if (places.length === 0 && cities.length === 0) {
    throw new Error('Aucune suggestion n\'a pu être générée. Réessayez.');
  }
  return { places, cities };
}

// Autocomplete d'adresses (Google Places). Renvoie [] si query < 3 chars.
// sessionToken groupe les frappes d'une même saisie pour un billing unique.
export async function getPlacePredictions(query, sessionToken) {
  if (!query || query.trim().length < 3) return [];
  try {
    const data = await invoke({
      mode: 'autocomplete-place',
      query,
      session_token: sessionToken,
    });
    return Array.isArray(data?.predictions) ? data.predictions : [];
  } catch (e) {
    console.warn('[autocomplete] failed', e);
    return [];
  }
}

// Découverte d'activités locales (mode autour-de-moi).
// `exclude` = liste de titres déjà affichés, pour ne pas les répéter
// lors d'un "Charger plus".
export async function suggestLocalActivities({
  location,
  radiusKm,
  types,
  rainyOnly,
  withKids,
  exclude,
}) {
  const data = await invoke({
    mode: 'local-activities',
    location,
    radius_km: radiusKm,
    types,
    rainy_only: !!rainyOnly,
    with_kids: !!withKids,
    exclude: exclude || [],
  });
  return {
    activities: Array.isArray(data?.activities) ? data.activities : [],
    model: data?.model,
    usage: data?.usage,
  };
}

// Construit une journée complète à partir d'activités sélectionnées.
// Renvoie un itinéraire 1-jour prêt à sauvegarder dans la base.
export async function buildDayFromActivities({
  selectedActivities,
  location,
  date,
  withKids,
  adults,
  childrenAges,
}) {
  const data = await invoke({
    mode: 'build-day-from-activities',
    selected_activities: selectedActivities,
    location,
    date,
    with_kids: !!withKids,
    adults: adults || 2,
    children_ages: childrenAges || [],
  });
  if (!data?.day) throw new Error('Réponse vide pour la journée construite.');
  const meta = addUsageToMeta(emptyMeta(), data.model, data.usage);
  // Force label/date/weekday cohérents avec ce que le user a demandé.
  const d = new Date(date + 'T00:00:00Z');
  const weekday = WEEKDAYS_FR[d.getUTCDay()];
  const day = { ...data.day, label: 'J1', date, weekday };

  // Calcule un budget_summary minimal à partir de l'unique jour
  const budget = computeBudget([day], {
    travellers: { adults: adults || 2, children_ages: childrenAges || [] },
  });

  const itinerary = {
    summary: {
      destinations: location,
      start_date: date,
      end_date: date,
      duration_days: 1,
      departure_location: location,
      return_location: location,
      is_round_trip: true,
      travellers: {
        adults: adults || 2,
        children_ages: childrenAges || [],
      },
      trip_type: 'sejour-fixe',
      interests: [],
      budget_level: 'moyen',
      vehicle_summary: null,
      total_distance_km: budget.summaryPatch.total_distance_km || null,
      headline:
        day.day_title ||
        `Une journée à ${location}`,
    },
    days: [day],
    budget_summary: budget.budget_summary,
    notes: {},
    metadata: meta,
  };
  return itinerary;
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
  // moments_update : { morning, noon, afternoon, evening } — chaque clé peut
  // être null (moment non impacté) ou {title, description} (réécrit pour
  // refléter la nouvelle activité). Sans ça, on aurait un programme qui
  // mentionne encore l'ancienne activité ("Chutes Montmorency") alors que
  // l'activité réelle est devenue autre chose ("Parc Aquarium du Québec").
  const momentsUpdate = data.moments_update || {};
  const newDays = itinerary.days.map((d, di) => {
    if (di !== dayIndex) return d;
    const newActivities = d.activities.map((a, ai) =>
      ai === activityIndex ? data.activity : a
    );
    const updatedDay = { ...d, activities: newActivities };
    // Applique les mises à jour de moments si l'IA en a fournies
    for (const key of ['morning', 'noon', 'afternoon', 'evening']) {
      const upd = momentsUpdate[key];
      if (upd && (upd.title || upd.description)) {
        updatedDay[key] = {
          ...(updatedDay[key] || {}),
          ...upd,
        };
      }
    }
    return updatedDay;
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

/**
 * Envoie une capture d'écran (Booking / autre site hôtelier) au backend qui
 * appelle un LLM vision (Gemini Flash ou Claude Haiku) pour extraire les
 * infos structurées de l'hôtel. Aucune persistance de l'image — extraction
 * one-shot, retour direct.
 *
 *   imageDataUrl : "data:image/png;base64,iVBORw0..."
 *   context      : { day_location?, current_hotel_name? }
 *
 * Renvoie { hotel: {...}, usage, model } ou throw en cas d'échec.
 */
export async function extractHotelFromImage(imageDataUrl, context = {}) {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
    throw new Error('Image invalide (data URL attendue).');
  }
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Image invalide : impossible de parser le data URL.');
  const [, mime, base64] = match;
  const data = await invoke({
    mode: 'extract-hotel-from-image',
    image_base64: base64,
    mime_type: mime,
    context,
  });
  if (!data?.hotel) throw new Error("L'extraction n'a renvoyé aucune donnée.");
  return data.hotel;
}

/**
 * Demande au backend des alternatives pour UN moment de la journée
 * (matin / midi / aprem / soir). Renvoie un tableau d'alternatives, à
 * afficher dans une modale pour que l'utilisateur en choisisse une.
 *
 * Pas de mutation de l'itinéraire ici — c'est l'appelant (handler dans
 * ItineraryDetailPage) qui appliquera le choix via replaceMoment().
 */
export async function suggestMomentAlternatives(itinerary, dayIndex, momentKey) {
  const day = itinerary?.days?.[dayIndex];
  if (!day) throw new Error(`Jour ${dayIndex} introuvable`);
  const data = await invoke({
    mode: 'suggest-moment-alternatives',
    day,
    moment_key: momentKey,
    day_index: dayIndex,
    total_days: itinerary.days?.length || 0,
  });
  return Array.isArray(data?.alternatives) ? data.alternatives : [];
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
