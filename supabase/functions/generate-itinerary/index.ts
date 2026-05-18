// Supabase Edge Function — generate-itinerary
//
// Modes :
//   1) { preferences }                                     → génère un itinéraire complet (≤ 8 jours)
//   2) { mode: "plan-trip", preferences }                  → renvoie SEULEMENT summary + day_plans + notes (long voyages)
//   3) { mode: "expand-day", preferences, day_plan, previous_plan, next_plan } → détaille UNE journée
//   4) { mode: "regenerate-day", itinerary, day_index, instructions } → régénère une journée existante
//
// Secret requis : ANTHROPIC_API_KEY

// deno-lint-ignore-file no-explicit-any
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514';
const EXPAND_MODEL =
  Deno.env.get('ANTHROPIC_EXPAND_MODEL') || 'claude-haiku-4-5-20251001';

// Secrets injectés automatiquement par Supabase dans toute Edge Function.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
- Tiens compte des dates pour calibrer la météo (saison réaliste pour la destination).
- Adapte le rythme au type de voyage : un séjour fixe a peu de trajets, un road trip en a beaucoup.
- Adapte les hébergements et les repas au niveau de budget choisi.
- Prix toujours en euros (€), réalistes pour le pays et la saison.
- N'invente pas d'établissements de luxe absurdement célèbres ; privilégie des adresses crédibles.
- Pour chaque jour, structure en Matin / Midi / Après-midi / Soir.
- Décris les excursions de façon immersive et commerciale.
- Pour chaque journée, fournis coordinates GPS approximatives (lat, lng) niveau ville.

MODE ROAD TRIP — règles supplémentaires :
- Construis un VRAI itinéraire bout-en-bout, en boucle si départ = retour, sinon en ligne.
- Trajets : distance_km, duration, coût carburant ((distance × conso / 100) × prix local), péages selon hauteur (classe 1 ≤ 2 m, 2 si 2-3 m, 3 si > 3 m en France), ferry si traversée maritime.
- Hébergements adaptés aux préférences : aire CC (5-15 €), aire privée (10-25 €), camping (15-35 €), camping municipal (10-20 €), France Passion (gratuit), bivouac (gratuit, "où autorisé"), parking gratuit.
- Si "Prévoir aires de service" : insère vidange/eau/électricité tous les 2-3 jours.
- Si cuisine van/mix : suggère marchés/supermarchés, budget repas réduit (10-15 €/jour/personne maison, 25-40 € mix).
- Indique particularités routières : routes étroites, hauteur sous tunnel, sections difficiles grand gabarit.

NIVEAU DE BUDGET :
- économique : auberges/campings, repas simples, activités gratuites/peu chères
- moyen : hôtels 3*/aires CC, brasseries, mix gratuites + payantes
- confort : hôtels 4*/campings premium, restaurants régionaux, plusieurs excursions guidées
- haut de gamme : boutique-hôtels/resorts, restaurants gastronomiques, expériences exclusives

Réponds UNIQUEMENT avec un JSON valide. Pas de texte autour. Pas de markdown.`;

function buildPreferencesContext(p: any): string {
  const children = Array.isArray(p.childrenAges) && p.childrenAges.length
    ? `${p.childrenAges.length} enfant(s) (âges : ${p.childrenAges.join(', ')} ans)`
    : '0 enfant';

  const isRoadTrip = ROAD_TRIP_TYPES.has(p.tripType);
  const v = p.vehicle;
  const vehicleBlock =
    isRoadTrip && v && v.type
      ? `
Véhicule : ${v.type} (${v.height || '?'} m × ${v.length || '?'} m)
  - Carburant : ${v.fuel || '?'} — ${v.consumption || '?'} L/100 km
  - Classe péage : ${!v.height ? '?' : v.height <= 2 ? '1' : v.height <= 3 ? '2' : '3'}`
      : isRoadTrip
        ? '\nVéhicule : non précisé — voiture standard essence 6.5 L/100.'
        : '';

  const stayPrefs = (p.nightStayPreferences || []).length
    ? p.nightStayPreferences.join(', ')
    : 'à adapter';

  const cookingMap: Record<string, string> = {
    vehicle: 'cuisine dans le véhicule',
    restaurants: 'restaurants uniquement',
    mix: 'mix cuisine maison + restos',
  };
  const cookingDesc = cookingMap[p.cooking] || 'restaurants';

  const practicalBlock = isRoadTrip
    ? `
Hébergement nocturne souhaité : ${stayPrefs}
Repas : ${cookingDesc}
Aires de service : ${p.needsServicePoints ? 'OUI, tous les 2-3 jours' : 'au besoin'}
Ferries acceptés : ${p.okWithFerry === false ? 'NON' : 'OUI si nécessaire'}`
    : `\nHébergement nocturne souhaité : ${stayPrefs}`;

  return `Destination(s) : ${p.destinations}
Période : du ${p.startDate} au ${p.endDate}
Départ : ${p.departureLocation}
Arrivée finale : ${p.returnLocation || p.departureLocation}${
    p.returnLocation && p.returnLocation !== p.departureLocation
      ? ' (aller-simple)'
      : ' (aller-retour)'
  }
Participants : ${p.adults} adulte(s), ${children}
Type de voyage : ${p.tripType}${vehicleBlock}
Centres d'intérêt : ${(p.interests || []).join(', ')}
Niveau de budget : ${p.budget}${practicalBlock}
Étapes IMPÉRATIVES : ${p.mustInclude || '(aucune)'}
À éviter : ${p.toAvoid || '(aucun)'}`;
}

const FULL_DAY_SCHEMA = `{
  "label": "Jx",
  "date": "YYYY-MM-DD",
  "weekday": "lundi",
  "location": "Ville / région",
  "coordinates": { "lat": number, "lng": number },
  "weather": { "temperature_c": number, "emoji": string, "description": string },
  "morning":   { "title": string, "description": string },
  "noon":      { "title": string, "description": string },
  "afternoon": { "title": string, "description": string },
  "evening":   { "title": string, "description": string },
  "accommodation": {
    "name": string, "type": string, "price_eur": number,
    "services": string[], "note": string, "coordinates_hint": string
  },
  "trips": [ {
    "from": string, "to": string, "distance_km": number, "duration": string,
    "mode": string, "estimated_cost_eur": number,
    "fuel_cost_eur": number|null, "toll_cost_eur": number|null, "ferry_cost_eur": number|null,
    "cost_note": string, "road_warning": string|null
  } ],
  "service_stops": [ {
    "type": string, "name": string, "location": string, "estimated_cost_eur": number
  } ],
  "activities": [ {
    "title": string, "schedule": string, "duration": string,
    "description": string, "immersive_description": string,
    "price_per_person_eur": number, "family_total_eur": number
  } ],
  "meals": { "daily_family_budget_eur": number, "style": string, "note": string },
  "day_total_eur": number
}`;

const FULL_SCHEMA = `{
  "summary": {
    "destinations": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD",
    "duration_days": number, "departure_location": string, "return_location": string,
    "is_round_trip": boolean,
    "travellers": { "adults": number, "children_ages": number[] },
    "trip_type": string, "interests": string[], "budget_level": string,
    "vehicle_summary": string|null, "total_distance_km": number|null,
    "headline": string
  },
  "days": [ ${FULL_DAY_SCHEMA} ],
  "budget_summary": {
    "trips_eur": number, "fuel_eur": number, "tolls_eur": number, "ferries_eur": number,
    "accommodation_eur": number, "meals_eur": number, "activities_eur": number,
    "service_stops_eur": number, "grand_total_eur": number, "per_person_eur": number,
    "currency": "EUR"
  },
  "notes": {
    "visa_and_documents": string, "climate_and_packing": string,
    "useful_apps": string[], "practical_tips": string[], "road_trip_tips": string[]
  }
}`;

function buildFullPrompt(p: any): string {
  return `Voici les préférences. Génère l'itinéraire COMPLET.

${buildPreferencesContext(p)}

Schéma JSON STRICT à respecter :
${FULL_SCHEMA}

Contraintes :
- days contient EXACTEMENT duration_days entrées.
- coordinates obligatoire chaque jour.
- emoji météo : ☀️ 🌤️ ⛅ 🌧️ ❄️ 🌫️ 🌩️
- day_total_eur = trips + accommodation + activities + meals + service_stops du jour.
- grand_total_eur = somme des day_total_eur.
- per_person_eur = grand_total / (adults + enfants).
- Si is_round_trip, dernier jour à departure_location ; sinon à return_location.`;
}

function buildPlanPrompt(p: any): string {
  return `Voici les préférences. Tu produis UNIQUEMENT le PLAN GLOBAL du voyage (squelette), pas les détails de chaque jour.

${buildPreferencesContext(p)}

Schéma JSON STRICT :
{
  "summary": {
    "destinations": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD",
    "duration_days": number, "departure_location": string, "return_location": string,
    "is_round_trip": boolean,
    "travellers": { "adults": number, "children_ages": number[] },
    "trip_type": string, "interests": string[], "budget_level": string,
    "vehicle_summary": string|null, "total_distance_km": number|null,
    "headline": string
  },
  "day_plans": [
    {
      "label": "J1",
      "date": "YYYY-MM-DD",
      "weekday": "lundi",
      "location": "Ville / région du jour",
      "anchor_theme": "1 phrase qui résume la journée",
      "end_location": "lieu d'arrivée en fin de journée (pour cohérence avec j+1)",
      "coordinates": { "lat": number, "lng": number }
    }
  ],
  "notes": {
    "visa_and_documents": string, "climate_and_packing": string,
    "useful_apps": string[], "practical_tips": string[], "road_trip_tips": string[]
  }
}

Contraintes :
- day_plans contient EXACTEMENT duration_days entrées (du jour 1 au dernier jour).
- end_location du jour N doit cohérer avec location du jour N+1.
- Le voyage doit être réaliste : pas plus de 400 km/jour en road trip moyen, pas plus de 250 km/jour en montagne.
- Pas de détails de matin/midi/après-midi, pas d'hébergement, pas de trips, pas de budget. JUSTE le plan.`;
}

function buildExpandPrompt(
  p: any,
  dayPlan: any,
  previousPlan: any,
  nextPlan: any
): string {
  return `Voici les préférences globales du voyage :

${buildPreferencesContext(p)}

Tu dois maintenant DÉTAILLER une seule journée, à partir du plan suivant :

Journée à détailler : ${dayPlan.label} — ${dayPlan.date} (${dayPlan.weekday}) — ${dayPlan.location}
Thème : ${dayPlan.anchor_theme}
Lieu d'arrivée du jour : ${dayPlan.end_location}
Coordonnées indicatives : ${JSON.stringify(dayPlan.coordinates)}

${
    previousPlan
      ? `Jour précédent : ${previousPlan.label} (${previousPlan.location}) — terminé à ${previousPlan.end_location}. Ta journée DOIT commencer là.`
      : '(c\'est le premier jour : tu commences depuis le lieu de départ du voyage)'
  }

${
    nextPlan
      ? `Jour suivant : ${nextPlan.label} (${nextPlan.location}). Ta journée doit finir à ${dayPlan.end_location} pour permettre l'enchaînement.`
      : '(c\'est le dernier jour : tu finis au lieu d\'arrivée final du voyage)'
  }

Renvoie UNIQUEMENT le JSON d'UNE journée selon ce schéma EXACT (pas d'enveloppe \`day\`, pas de tableau) :

${FULL_DAY_SCHEMA}

Contraintes :
- Garde EXACTEMENT le label, la date, le weekday et le location indiqués.
- coordinates obligatoire (utilise les coordonnées du plan ou affine).
- day_total_eur = somme trips + accommodation + activities + meals + service_stops.`;
}

function buildRegenerateDayPrompt(
  itinerary: any,
  dayIndex: number,
  instructions: string
): string {
  const day = itinerary.days?.[dayIndex];
  if (!day) throw new Error(`Jour ${dayIndex} introuvable`);
  const prev = itinerary.days?.[dayIndex - 1];
  const next = itinerary.days?.[dayIndex + 1];

  return `Régénère UNE SEULE journée d'un itinéraire existant en tenant compte d'une consigne utilisateur.

Contexte itinéraire :
${JSON.stringify(itinerary.summary, null, 2)}

Journée à régénérer : ${day.label} (${day.date} — ${day.weekday})
Jour précédent : ${prev ? `${prev.location}, hébergement ${prev.accommodation?.name}` : '(premier jour)'}
Jour suivant : ${next ? next.location : '(dernier jour)'}

Journée actuelle :
${JSON.stringify(day, null, 2)}

CONSIGNE :
"""
${instructions}
"""

Renvoie UNIQUEMENT le JSON de la nouvelle journée selon le même schéma. Garde label, date et weekday. Recalcule day_total_eur. Cohérence avec le départ du jour suivant.`;
}

async function callClaude(userPrompt: string, maxTokens = 16000, model = MODEL) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
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

function extractJsonString(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return candidate.slice(first, last + 1);
  }
  return candidate;
}

function tryParseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  const candidate = extractJsonString(text);
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Si Claude renvoie du JSON cassé, on fait un seul aller-retour pour qu'il le corrige.
// Bien moins cher qu'une nouvelle génération complète.
async function parseOrRepair(rawText: string, model: string): Promise<any> {
  const first = tryParseJson(rawText);
  if (first.ok) return first.value;

  console.warn('[json] première tentative échouée :', first.error);

  const broken = extractJsonString(rawText);
  const repairPrompt = `Le JSON que tu viens de produire est invalide. Voici l'erreur du parseur JavaScript :

"${first.error}"

Voici le JSON brut que tu as renvoyé :
<<<RAW
${broken}
RAW>>>

Tâche : renvoie EXACTEMENT le même contenu mais avec la syntaxe JSON corrigée. Vérifie :
- chaque élément d'un tableau est suivi d'une virgule (sauf le dernier)
- chaque accolade / crochet ouvrant a son fermant
- les guillemets sont des guillemets droits "
- pas de virgule en trop avant un } ou un ]

Réponds UNIQUEMENT avec le JSON valide. Aucun texte autour, aucun bloc markdown, aucun commentaire.`;

  const { text: repaired } = await callClaude(repairPrompt, 16000, model);
  const second = tryParseJson(repaired);
  if (second.ok) {
    console.log('[json] réparé avec succès');
    return second.value;
  }
  throw new Error(
    `JSON invalide même après tentative de réparation : ${second.error}`
  );
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// Décode le JWT (3 parties base64url) sans vérifier la signature.
// La signature est vérifiée en amont par Supabase si verify_jwt=true ;
// ici on utilise juste le payload pour identifier l'utilisateur.
function decodeJwtPayload(jwt: string): any | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Récupère l'utilisateur courant depuis l'Authorization header, vérifie
// que c'est un user authentifié (pas l'anon key) et qu'il est approuvé.
async function getApprovedUser(req: Request): Promise<
  { ok: true; userId: string; tier: string }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return { ok: false, status: 401, error: 'Authentification requise.' };
  }
  const jwt = m[1];
  const payload = decodeJwtPayload(jwt);
  if (!payload) {
    return { ok: false, status: 401, error: 'Token invalide.' };
  }
  // Refuse l'anon key (role='anon'). On exige un user authentifié.
  if (payload.role !== 'authenticated' || !payload.sub) {
    return {
      ok: false,
      status: 401,
      error: 'Vous devez être connecté pour utiliser TravelO.',
    };
  }

  // Lecture du profil via le service-role pour contourner la RLS sans
  // dépendre du contexte JWT (sûr car on a déjà identifié l'utilisateur).
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Si les secrets ne sont pas dispo, on laisse passer pour ne pas casser
    // le service — la gate frontale ProtectedRoute reste en place.
    return { ok: true, userId: payload.sub, tier: 'free' };
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${payload.sub}&select=status,subscription_tier`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!res.ok) {
      return {
        ok: false,
        status: 500,
        error: 'Impossible de vérifier votre profil.',
      };
    }
    const rows = await res.json();
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile) {
      return {
        ok: false,
        status: 403,
        error: 'Profil introuvable. Veuillez vous reconnecter.',
      };
    }
    if (profile.status !== 'approved') {
      return {
        ok: false,
        status: 403,
        error:
          'Votre compte est en attente d\'approbation par un administrateur.',
      };
    }
    return {
      ok: true,
      userId: payload.sub,
      tier: profile.subscription_tier || 'free',
    };
  } catch (err) {
    console.error('[auth] profile fetch failed', err);
    return { ok: false, status: 500, error: 'Erreur de vérification du profil.' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: 'ANTHROPIC_API_KEY non configuré côté Edge Function.' },
      500
    );
  }

  // Gate auth : utilisateur connecté + statut 'approved' obligatoires
  const auth = await getApprovedUser(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  try {
    const body = await req.json();
    const mode = body?.mode || 'generate';

    if (mode === 'regenerate-day') {
      const { itinerary, day_index, instructions } = body;
      if (!itinerary || typeof day_index !== 'number' || !instructions) {
        return jsonResponse(
          { error: 'Body invalide : itinerary, day_index, instructions requis' },
          400
        );
      }
      const prompt = buildRegenerateDayPrompt(itinerary, day_index, instructions);
      const { text, usage } = await callClaude(prompt, 6000);
      const day = await parseOrRepair(text, MODEL);
      return jsonResponse({ day, usage, model: MODEL });
    }

    if (mode === 'plan-trip') {
      const preferences = body?.preferences;
      if (!preferences?.destinations || !preferences?.startDate) {
        return jsonResponse({ error: 'preferences invalides' }, 400);
      }
      const prompt = buildPlanPrompt(preferences);
      const { text, usage } = await callClaude(prompt, 8000);
      const plan = await parseOrRepair(text, MODEL);
      return jsonResponse({ plan, usage, model: MODEL });
    }

    if (mode === 'expand-day') {
      const { preferences, day_plan, previous_plan, next_plan } = body;
      if (!preferences || !day_plan) {
        return jsonResponse(
          { error: 'preferences et day_plan requis' },
          400
        );
      }
      const prompt = buildExpandPrompt(
        preferences,
        day_plan,
        previous_plan,
        next_plan
      );
      // Haiku pour le détail des journées : suffisant et 4× moins cher
      const { text, usage } = await callClaude(prompt, 6000, EXPAND_MODEL);
      const day = await parseOrRepair(text, EXPAND_MODEL);
      return jsonResponse({ day, usage, model: EXPAND_MODEL });
    }

    // Default : full single-call generation (small trips ≤ 8 days)
    const preferences = body?.preferences;
    if (!preferences?.destinations || !preferences?.startDate) {
      return jsonResponse({ error: 'preferences invalides' }, 400);
    }
    const userPrompt = buildFullPrompt(preferences);
    const { text, usage } = await callClaude(userPrompt, 16000);
    const itinerary = await parseOrRepair(text, MODEL);
    return jsonResponse({ itinerary, usage, model: MODEL });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || String(err) },
      500
    );
  }
});
