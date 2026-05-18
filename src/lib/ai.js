import { supabase } from './supabase';

const AI_FUNCTION_NAME = 'generate-itinerary';

export async function generateItinerary(preferences) {
  try {
    const { data, error } = await supabase.functions.invoke(AI_FUNCTION_NAME, {
      body: { preferences },
    });
    if (error) throw error;
    if (data?.itinerary) return data.itinerary;
    return data;
  } catch (err) {
    console.warn(
      '[ai] Edge function indisponible, fallback local actif.',
      err?.message ?? err
    );
    return buildMockItinerary(preferences);
  }
}

function buildMockItinerary(prefs) {
  const start = prefs.startDate ? new Date(prefs.startDate) : new Date();
  const end = prefs.endDate
    ? new Date(prefs.endDate)
    : new Date(start.getTime() + 6 * 86400000);
  const days = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  );
  const destinations = (prefs.destinations || 'Destination')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  const travellers =
    Number(prefs.adults || 1) + Number(prefs.children || 0);
  const dailyBudget = prefs.budget
    ? Math.round(Number(prefs.budget) / Math.max(days, 1))
    : 150;

  const activities = (prefs.activities || []).length
    ? prefs.activities
    : ['culture', 'gastronomie'];
  const meals = ['Petit-déjeuner local', 'Déjeuner régional', 'Dîner gastronomique'];

  const program = Array.from({ length: days }).map((_, i) => {
    const date = new Date(start.getTime() + i * 86400000);
    const dest = destinations[i % destinations.length] || destinations[0];
    return {
      day: i + 1,
      date: date.toISOString().slice(0, 10),
      location: dest,
      accommodation: {
        name: `${prefs.accommodation || 'Hôtel'} central à ${dest}`,
        type: prefs.accommodation || 'Hôtel',
        price_per_night: Math.round(dailyBudget * 0.45),
      },
      meals: meals.map((m) => ({
        name: m,
        suggestion: `Adresse locale recommandée — ${dest}`,
        price: Math.round(dailyBudget * 0.08),
      })),
      activities: activities.slice(0, 3).map((a, idx) => ({
        time: ['09:30', '14:00', '17:30'][idx % 3],
        title: `Activité ${a} à ${dest}`,
        duration: '2h',
        price: Math.round(dailyBudget * 0.1),
      })),
      transport: i === 0 || i === days - 1
        ? {
            mode: prefs.transport || 'avion',
            note: i === 0 ? 'Arrivée' : 'Retour',
            price: Math.round(dailyBudget * 0.6),
          }
        : {
            mode: 'local',
            note: 'Transports sur place',
            price: Math.round(dailyBudget * 0.05),
          },
      rest_time: '15:30 — 17:00',
    };
  });

  const totalEstimate = program.reduce((sum, d) => {
    const meals = d.meals.reduce((s, m) => s + (m.price || 0), 0);
    const acts = d.activities.reduce((s, a) => s + (a.price || 0), 0);
    return (
      sum +
      (d.accommodation?.price_per_night || 0) +
      meals +
      acts +
      (d.transport?.price || 0)
    );
  }, 0);

  return {
    summary: {
      destinations,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      days,
      travellers,
      transport: prefs.transport || 'avion',
      accommodation: prefs.accommodation || 'Hôtel',
      activities,
    },
    program,
    budget: {
      total_estimate: totalEstimate * travellers,
      per_person: totalEstimate,
      indicative_input: Number(prefs.budget) || null,
      currency: 'EUR',
    },
    generated_with: 'mock',
  };
}
