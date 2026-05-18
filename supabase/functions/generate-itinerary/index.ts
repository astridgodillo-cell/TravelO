// Supabase Edge Function — generate-itinerary
// 2 modes :
//   1) { preferences } → génère un itinéraire complet
//   2) { mode: "regenerate-day", itinerary, day_index, instructions } → régénère uniquement la journée demandée
//
// Secret requis :
//   ANTHROPIC_API_KEY (via dashboard Supabase → Edge Functions → Secrets)

// deno-lint-ignore-file no-explicit-any
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROAD_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
]);

const SYSTEM_PROMPT = `Tu es l'expert voyage TravelO, un agent de tour-opérateur francophone, méticuleux et passionné. Tu rédiges des itinéraires ultra-détaillés, comme un programme vendu par une grande agence.

Règles strictes :
- Rédige TOUJOURS en français, ton chaleureux et professionnel.
- Tiens compte des dates fournies pour calibrer la météo (saison réaliste pour la destination).
- Adapte le rythme au type de voyage : un séjour fixe a peu de trajets, un road trip en a beaucoup.
- Adapte les hébergements et les repas au niveau de budget choisi.
- Prix toujours en euros (€), réalistes pour le pays et la saison.
- N'invente pas d'établissements de luxe absurdement célèbres ; privilégie des adresses crédibles.
- Pour chaque jour, structure en Matin / Midi / Après-midi / Soir.
- Décris les excursions de façon immersive et commerciale ("vous emprunterez le sentier...", "votre guide local vous racontera...").
- Pour chaque journée, fournis des coordonnées GPS approximatives (latitude, longitude) du lieu principal — niveau ville ou village, pas besoin de précision GPS exacte. Utilise tes connaissances géographiques.

MODE ROAD TRIP (van, camping-car, voiture) — règles supplémentaires :
- Construis un VRAI itinéraire bout-en-bout, en boucle si départ = retour, sinon en ligne.
- Chaque journée comporte un ou plusieurs trajets entre étapes, AVEC :
  * distance_km et duration réalistes (vitesse moyenne 70-80 km/h sur route, 90 km/h sur autoroute, 60 km/h en montagne)
  * coût carburant calculé : (distance_km × consommation_L_par_100 / 100) × prix_carburant_local_par_litre
  * coût péages selon hauteur du véhicule (classe 1 si ≤ 2 m, classe 2 si 2-3 m, classe 3 si > 3 m en France)
  * coût ferry si traversée maritime nécessaire (Corse, Sardaigne, îles grecques, GB, Norvège, etc.) — chiffre estimé pour véhicule + passagers
- Adapte les hébergements nocturnes aux préférences cochées : aire de camping-car (5-15 €), aire privée (10-25 €), camping (15-35 €), camping municipal (10-20 €), France Passion (gratuit avec consommation locale), bivouac (gratuit, à signaler "où autorisé"), parking gratuit (à signaler).
- Si "Prévoir aires de service" coché : insère une étape vidange/eau/électricité tous les 2-3 jours, idéalement combinée à une halte courses.
- Si "cuisine dans le véhicule" ou "mix" : suggère des marchés / supermarchés en cours de route, et baisse le budget repas (10-15 €/jour/personne pour cuisine maison, 25-40 € pour mix).
- Indique les particularités routières : routes étroites en montagne, hauteur sous tunnel/pont, sections difficiles avec un grand gabarit.

NIVEAU DE BUDGET :
- économique : auberges/campings, repas simples, activités gratuites/peu chères
- moyen : hôtels 3*/aires CC, brasseries, mix activités gratuites + payantes
- confort : hôtels 4*/campings premium, restaurants régionaux, plusieurs excursions guidées
- haut de gamme : boutique-hôtels/resorts, restaurants gastronomiques, expériences exclusives

Réponds UNIQUEMENT avec un JSON valide qui respecte EXACTEMENT le schéma demandé. Pas de texte avant ni après. Pas de bloc markdown \`\`\`json.`;

function buildUserPrompt(p: any): string {
  const childrenDesc =
    Array.isArray(p.childrenAges) && p.childrenAges.length
      ? `${p.childrenAges.length} enfant(s) (âges : ${p.childrenAges.join(', ')} ans)`
      : '0 enfant';

  const isRoadTrip = ROAD_TRIP_TYPES.has(p.tripType);
  const v = p.vehicle;
  const vehicleBlock =
    isRoadTrip && v && v.type
      ? `
Véhicule : ${v.type}
  - Dimensions : ${v.height || '?'} m × ${v.length || '?'} m
  - Carburant : ${v.fuel || '?'}
  - Consommation : ${v.consumption || '?'} L/100 km
  - Classe péage estimée : ${
    !v.height ? 'inconnue' : v.height <= 2 ? '1 (légère)' : v.height <= 3 ? '2 (intermédiaire)' : '3 (lourde)'
  }`
      : isRoadTrip
        ? '\nVéhicule : non précisé — utilise une voiture standard (essence, 6.5 L/100 km).'
        : '';

  const stayPrefs = (p.nightStayPreferences || []).length
    ? p.nightStayPreferences.join(', ')
    : 'à adapter selon le voyage';

  const cookingMap: Record<string, string> = {
    vehicle: 'cuisine dans le véhicule (prévoir courses, budget repas réduit)',
    restaurants: 'restaurants uniquement',
    mix: 'mix cuisine maison + restos',
  };
  const cookingDesc = cookingMap[p.cooking] || 'restaurants';

  const practicalBlock = isRoadTrip
    ? `
Hébergement nocturne souhaité : ${stayPrefs}
Repas : ${cookingDesc}
Aires de service (vidange/eau) : ${p.needsServicePoints ? 'OUI, tous les 2-3 jours' : 'au besoin uniquement'}
Ferries acceptés : ${p.okWithFerry === false ? 'NON — éviter toute traversée maritime' : 'OUI si nécessaire'}`
    : `
Hébergement nocturne souhaité : ${stayPrefs}`;

  return `Voici les préférences du voyageur. Génère l'itinéraire complet.

Destination(s) / région : ${p.destinations}
Période : du ${p.startDate} au ${p.endDate}
Lieu de départ : ${p.departureLocation}
Lieu d'arrivée final : ${p.returnLocation || p.departureLocation}${
    p.returnLocation && p.returnLocation !== p.departureLocation
      ? ' (trajet ALLER-SIMPLE, pas de retour au départ)'
      : ' (aller-retour, on revient au point de départ)'
  }
Participants : ${p.adults} adulte(s), ${childrenDesc}
Type de voyage : ${p.tripType}${vehicleBlock}
Centres d'intérêt : ${(p.interests || []).join(', ')}
Niveau de budget : ${p.budget}${practicalBlock}
Lieux ou étapes IMPÉRATIFS à inclure : ${p.mustInclude || '(aucun)'}
Lieux ou choses à éviter : ${p.toAvoid || '(aucun)'}

Tu dois renvoyer un JSON STRICT avec exactement cette structure :

{
  "summary": {
    "destinations": string,
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "duration_days": number,
    "departure_location": string,
    "return_location": string,
    "is_round_trip": boolean,
    "travellers": { "adults": number, "children_ages": number[] },
    "trip_type": string,
    "interests": string[],
    "budget_level": string,
    "vehicle_summary": string | null,
    "total_distance_km": number | null,
    "headline": string
  },
  "days": [
    {
      "label": "J1",
      "date": "YYYY-MM-DD",
      "weekday": "lundi",
      "location": "Ville / région du jour",
      "coordinates": { "lat": number, "lng": number },
      "weather": { "temperature_c": number, "emoji": string, "description": string },
      "morning":   { "title": string, "description": string },
      "noon":      { "title": string, "description": string },
      "afternoon": { "title": string, "description": string },
      "evening":   { "title": string, "description": string },
      "accommodation": {
        "name": string,
        "type": string,
        "price_eur": number,
        "services": string[],
        "note": string,
        "coordinates_hint": string
      },
      "trips": [
        {
          "from": string,
          "to": string,
          "distance_km": number,
          "duration": string,
          "mode": string,
          "estimated_cost_eur": number,
          "fuel_cost_eur": number | null,
          "toll_cost_eur": number | null,
          "ferry_cost_eur": number | null,
          "cost_note": string,
          "road_warning": string | null
        }
      ],
      "service_stops": [
        {
          "type": string,
          "name": string,
          "location": string,
          "estimated_cost_eur": number
        }
      ],
      "activities": [
        {
          "title": string,
          "schedule": string,
          "duration": string,
          "description": string,
          "immersive_description": string,
          "price_per_person_eur": number,
          "family_total_eur": number
        }
      ],
      "meals": {
        "daily_family_budget_eur": number,
        "style": string,
        "note": string
      },
      "day_total_eur": number
    }
  ],
  "budget_summary": {
    "trips_eur": number,
    "fuel_eur": number,
    "tolls_eur": number,
    "ferries_eur": number,
    "accommodation_eur": number,
    "meals_eur": number,
    "activities_eur": number,
    "service_stops_eur": number,
    "grand_total_eur": number,
    "per_person_eur": number,
    "currency": "EUR"
  },
  "notes": {
    "visa_and_documents": string,
    "climate_and_packing": string,
    "useful_apps": string[],
    "practical_tips": string[],
    "road_trip_tips": string[]
  }
}

Contraintes :
- duration_days = nombre exact de jours entre start_date et end_date inclus.
- days contient EXACTEMENT duration_days entrées.
- Si is_round_trip est true, le dernier jour DOIT revenir à departure_location.
- Sinon le dernier jour se termine à return_location.
- emoji météo cohérent : ☀️ 🌤️ ⛅ 🌧️ ❄️ 🌫️ 🌩️
- coordinates.lat et coordinates.lng sont OBLIGATOIRES pour chaque jour (approximations city-level acceptées).
- day_total_eur = somme des trips.estimated_cost_eur + accommodation.price_eur + activities.family_total_eur + meals.daily_family_budget_eur + service_stops.estimated_cost_eur du jour.
- grand_total_eur = somme des day_total_eur.
- per_person_eur = grand_total_eur / (adults + nombre d'enfants).`;
}

function buildRegenerateDayPrompt(
  itinerary: any,
  dayIndex: number,
  instructions: string
): string {
  const day = itinerary.days?.[dayIndex];
  if (!day) throw new Error(`Jour ${dayIndex} introuvable`);

  const previousDay = itinerary.days?.[dayIndex - 1];
  const nextDay = itinerary.days?.[dayIndex + 1];

  return `Tu dois régénérer UNE SEULE journée d'un itinéraire existant en tenant compte d'une consigne utilisateur.

Contexte de l'itinéraire complet :
${JSON.stringify(itinerary.summary, null, 2)}

Journée à régénérer : ${day.label} (${day.date} — ${day.weekday})
Journée précédente (J${dayIndex} doit en suivre logiquement la fin) :
${previousDay ? `Lieu : ${previousDay.location}, hébergement : ${previousDay.accommodation?.name}` : '(premier jour de l\'itinéraire)'}

Journée suivante (la journée régénérée doit pouvoir enchaîner sur celle-ci) :
${nextDay ? `Lieu : ${nextDay.location}` : '(dernier jour de l\'itinéraire)'}

Journée actuelle (à remplacer) :
${JSON.stringify(day, null, 2)}

CONSIGNE UTILISATEUR :
"""
${instructions}
"""

Renvoie UNIQUEMENT le JSON de la nouvelle journée, avec EXACTEMENT le même schéma que celui de days[i] (toutes les clés présentes : label, date, weekday, location, coordinates, weather, morning, noon, afternoon, evening, accommodation, trips, service_stops, activities, meals, day_total_eur). Pas de texte autour, pas de bloc markdown.

- Garde le même label, la même date et le même weekday que la journée originale.
- Recalcule day_total_eur en fonction des nouveaux coûts.
- Assure-toi que le lieu d'arrivée colle bien avec le départ de la journée suivante.`;
}

async function callClaude(userPrompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Réponse Claude vide.');
  return { text, usage: data?.usage };
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw new Error('Impossible de parser le JSON renvoyé par Claude.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'Le secret ANTHROPIC_API_KEY n\'est pas configuré dans la fonction.',
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  }

  try {
    const body = await req.json();
    const mode = body?.mode || 'generate';

    if (mode === 'regenerate-day') {
      const { itinerary, day_index, instructions } = body;
      if (
        !itinerary ||
        typeof day_index !== 'number' ||
        !instructions
      ) {
        return new Response(
          JSON.stringify({
            error: 'Body invalide : itinerary, day_index, instructions requis',
          }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
          }
        );
      }
      const prompt = buildRegenerateDayPrompt(itinerary, day_index, instructions);
      const { text, usage } = await callClaude(prompt);
      const day = extractJson(text);
      return new Response(JSON.stringify({ day, usage, model: MODEL }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }

    // Default : full generation
    const preferences = body?.preferences;
    if (!preferences || !preferences.destinations || !preferences.startDate) {
      return new Response(JSON.stringify({ error: 'preferences invalides' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }

    const userPrompt = buildUserPrompt(preferences);
    const { text, usage } = await callClaude(userPrompt);
    const itinerary = extractJson(text);

    return new Response(
      JSON.stringify({ itinerary, usage, model: MODEL }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || String(err) }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }
    );
  }
});
