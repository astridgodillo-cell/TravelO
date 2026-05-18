import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

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

export async function generateItinerary(preferences) {
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: { preferences },
  });

  if (error) {
    const detail = await readErrorDetail(error);
    throw new Error(detail || 'Erreur Edge Function');
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.itinerary) {
    throw new Error('Réponse vide reçue de l\'Edge Function.');
  }
  return data.itinerary;
}

export async function regenerateDay(itinerary, dayIndex, instructions) {
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: {
      mode: 'regenerate-day',
      itinerary,
      day_index: dayIndex,
      instructions,
    },
  });

  if (error) {
    const detail = await readErrorDetail(error);
    throw new Error(detail || 'Erreur Edge Function (régénération)');
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.day) throw new Error('Réponse vide pour la journée régénérée.');

  const newDays = itinerary.days.map((d, i) =>
    i === dayIndex ? data.day : d
  );
  const newSummary = recomputeBudget({ ...itinerary, days: newDays });
  return { ...itinerary, days: newDays, ...newSummary };
}

function recomputeBudget(it) {
  const days = it.days || [];
  let trips = 0,
    fuel = 0,
    tolls = 0,
    ferries = 0,
    accommodation = 0,
    meals = 0,
    activities = 0,
    service = 0,
    distance = 0;

  for (const d of days) {
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
    (it.summary?.travellers?.adults || 1) +
    (it.summary?.travellers?.children_ages?.length || 0);

  return {
    summary: {
      ...it.summary,
      total_distance_km:
        it.summary?.total_distance_km != null ? distance : it.summary?.total_distance_km,
    },
    budget_summary: {
      ...it.budget_summary,
      trips_eur: trips,
      fuel_eur: fuel,
      tolls_eur: tolls,
      ferries_eur: ferries,
      accommodation_eur: accommodation,
      meals_eur: meals,
      activities_eur: activities,
      service_stops_eur: service,
      grand_total_eur: grand,
      per_person_eur: Math.round(grand / heads),
      currency: 'EUR',
    },
  };
}
