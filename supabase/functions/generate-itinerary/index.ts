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
// À configurer manuellement dans Edge Functions → Secrets
const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY') || '';
const UNSPLASH_ACCESS_KEY = Deno.env.get('UNSPLASH_ACCESS_KEY') || '';
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';

// Backend LLM unifié : 'gemini' ou 'claude'. Auto-détecté en fonction des clés.
// Quand BACKEND='gemini', TOUTES les opérations passent par Gemini Flash :
// plan, expand, régénération, fetch-spécialités, etc.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
const BACKEND = (
  Deno.env.get('BACKEND') ||
  Deno.env.get('EXPAND_BACKEND') ||
  (GEMINI_API_KEY ? 'gemini' : 'claude')
).toLowerCase();

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
- Si "Activités spécifiques souhaitées" est renseigné : intègre-les en priorité dans le programme quand le lieu et la saison s'y prêtent (ex. kayak demandé en Bretagne en juin → cale au moins 1 sortie kayak ; musées demandés à Lisbonne → cale 1-2 musées). Ne force pas une activité inadaptée (ex. ski en juillet).
- FORMAT DES NOMS DE LIEUX : le champ "location" des jours et les champs "from"/"to" des trips doivent contenir UNIQUEMENT un nom de ville ou village exploitable par Google Maps. PAS de description, PAS de "X - puis route vers Y", PAS de "Route vers X via Z", PAS de "X (matin) + Y". Mets l'éventuel détail dans le thème ou la description, pas dans le nom du lieu.
  ✅ "location": "Vérone"          ✅ "from": "Bastia"
  ❌ "location": "Vérone - puis route vers Bologne"
  ❌ "from": "Route vers Florence via Apennins"
- Champ "bookable" pour chaque activité :
  * true UNIQUEMENT si l'activité est typiquement réservable en ligne sur GetYourGuide / Tiqets / Viator (musée payant, château avec billetterie, visite guidée, excursion organisée, croisière, parc d'attractions, atelier, cours, dégustation, plongée, kayak, etc.)
  * false pour les activités libres / gratuites / non encadrées : balades, flâneries, plages, points de vue, pique-niques, marchés libres, temps libre, randonnée non guidée, repas dans un restaurant non chaîne, apéros, couchers de soleil.
  ✅ "Visite guidée du Louvre" → bookable: true
  ✅ "Cours de cuisine portugaise" → bookable: true
  ❌ "Balade sur le port" → bookable: false
  ❌ "Dîner dans une trattoria locale" → bookable: false

COHÉRENCE GÉOGRAPHIQUE (RÈGLE STRICTE) :
- Optimise l'ORDRE des étapes pour suivre un trajet logique de proche en proche.
- NE REVIENS JAMAIS SUR TES PAS : ne place pas une étape qui oblige à traverser deux fois la même région.
- Si plusieurs lieux impératifs (mustInclude) sont demandés, classe-les dans l'ordre géographique optimal entre le départ et l'arrivée, pas dans l'ordre où l'utilisateur les a listés.
- Pour un aller-retour (départ = arrivée), trace une boucle qui visite chaque étape une fois, sans repassage.
- Si une seule séquence "logique" est possible mais qu'elle vous fait passer 2 fois par un même endroit, signale-le dans road_warning du trip.
- Exemple : Paris → Bretagne avec Puy du Fou (Les Epesses, Vendée) ET zoo de Beauval (Saint-Aignan, Loir-et-Cher) imposés.
  ✅ ORDRE CORRECT : Paris → Saint-Aignan (proche, est) → Les Epesses (sud-ouest) → Vannes (Bretagne)
  ❌ MAUVAIS ORDRE : Paris → Les Epesses → Saint-Aignan (retour est) → Vannes (re-ouest) [zigzag inutile]

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

function computeDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.round((end - start) / 86400000) + 1;
}

function buildPreferencesContext(p: any): string {
  const children = Array.isArray(p.childrenAges) && p.childrenAges.length
    ? `${p.childrenAges.length} enfant(s) (âges : ${p.childrenAges.join(', ')} ans)`
    : '0 enfant';
  const expectedDays = computeDays(p.startDate, p.endDate);

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

  const specificActivities = (p.specificActivities || []).length
    ? `\nActivités spécifiques souhaitées : ${p.specificActivities.join(', ')}`
    : '';

  return `Destination(s) : ${p.destinations}
Période : du ${p.startDate} au ${p.endDate} (durée = ${expectedDays} jours inclusifs, à respecter EXACTEMENT — ne change AUCUNE date)
Départ : ${p.departureLocation}
Arrivée finale : ${p.returnLocation || p.departureLocation}${
    p.returnLocation && p.returnLocation !== p.departureLocation
      ? ' (aller-simple)'
      : ' (aller-retour)'
  }
Participants : ${p.adults} adulte(s), ${children}
Type de voyage : ${p.tripType}${vehicleBlock}
Centres d'intérêt : ${(p.interests || []).join(', ')}${specificActivities}
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
    "price_per_person_eur": number, "family_total_eur": number,
    "bookable": boolean
  } ],
  "meals": { "daily_family_budget_eur": number, "style": string, "note": string },
  "culinary_specialties": [ {
    "name": string,
    "category": string,
    "description": string,
    "photo_query": string
  } ],
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
    "useful_apps": string[], "practical_tips": string[], "road_trip_tips": string[],
    "packing_list": {
      "essentials": string[],
      "clothing": string[],
      "tech_and_papers": string[],
      "vehicle_specific": string[],
      "activities_specific": string[]
    },
    "local_phrases": {
      "language": string,
      "phonetic_hint": string,
      "phrases": [ { "fr": string, "local": string, "pronunciation": string } ]
    }
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
- Si is_round_trip, dernier jour à departure_location ; sinon à return_location.
- culinary_specialties : 3 à 4 spécialités emblématiques par jour, propres à la région/ville du jour. category = "plat", "pâtisserie", "fromage", "vin", "boisson", "rue", etc. description = 1-2 phrases descriptives (ingrédients, contexte). photo_query = expression COURTE (2-3 mots maximum) qui décrit le PLAT/PRODUIT lui-même, SANS nom de ville ni adjectif de provenance. Le moteur de recherche photo (Unsplash) doit retrouver une photo du plat, pas une photo du lieu.
  ✅ "pastel de nata"      ✅ "panettone"           ✅ "risotto"          ✅ "fondue savoyarde"
  ❌ "Panettone de Como"   ❌ "Formaggini di Tresenda"   ❌ "Missultini du lac"
  Évite les doublons d'un jour à l'autre quand le lieu change.`;
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
    "useful_apps": string[], "practical_tips": string[], "road_trip_tips": string[],
    "packing_list": {
      "essentials": string[],
      "clothing": string[],
      "tech_and_papers": string[],
      "vehicle_specific": string[],
      "activities_specific": string[]
    },
    "local_phrases": {
      "language": string,
      "phonetic_hint": string,
      "phrases": [ { "fr": string, "local": string, "pronunciation": string } ]
    }
  }
}

Contraintes :
- packing_list adaptée au climat, aux activités, au véhicule (12-20 items par catégorie).
- local_phrases : language = langue principale parlée à la destination ; si destination francophone, mets une liste vide pour "phrases" et indique "Français" en language. Sinon 10-15 phrases utiles.
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

function buildFetchSpecialtiesPrompt(location: string, count = 4): string {
  return `Tu es un expert en gastronomie locale. Pour le lieu "${location}", liste ${count} spécialités culinaires emblématiques.

Renvoie UNIQUEMENT un JSON valide selon ce schéma (pas de texte autour) :

{
  "specialties": [
    {
      "name": "nom du plat / produit",
      "category": "plat | pâtisserie | fromage | vin | boisson | rue | autre",
      "description": "1-2 phrases : ingrédients + contexte local",
      "photo_query": "expression courte optimisée pour Pexels, ex. 'pastel de nata'"
    }
  ]
}

Contraintes :
- ${count} spécialités, vraiment emblématiques de ${location} ou sa région
- description en français, 1-2 phrases concrètes
- pas de doublons
- photo_query : 2-3 mots décrivant LE PLAT lui-même, SANS nom de ville ni adjectif de provenance, sinon le moteur de recherche photo renvoie le lieu au lieu du plat.
  ✅ "pastel de nata"   ✅ "panettone"   ✅ "risotto"
  ❌ "Panettone de Como"   ❌ "Formaggini di Tresenda"`;
}

function buildRegenerateActivityPrompt(
  itinerary: any,
  dayIndex: number,
  activityIndex: number,
  instructions: string
): string {
  const day = itinerary.days?.[dayIndex];
  if (!day) throw new Error(`Jour ${dayIndex} introuvable`);
  const activity = day.activities?.[activityIndex];
  if (!activity) throw new Error(`Activité ${activityIndex} introuvable`);

  return `Tu vas REMPLACER une seule activité d'un itinéraire existant, en tenant compte d'une consigne utilisateur.

Contexte du voyage :
${JSON.stringify(itinerary.summary, null, 2)}

Journée concernée : ${day.label} — ${day.location} (${day.date})
Météo du jour : ${day.weather?.temperature_c || '?'}°C ${day.weather?.emoji || ''}

Activité actuelle à remplacer :
${JSON.stringify(activity, null, 2)}

Autres activités du jour (à éviter de dupliquer) :
${(day.activities || [])
  .filter((_: any, i: number) => i !== activityIndex)
  .map((a: any) => `  - ${a.title}`)
  .join('\n') || '  (aucune)'}

CONSIGNE :
"""
${instructions}
"""

Renvoie UNIQUEMENT le JSON d'UNE activité selon ce schéma EXACT (pas d'enveloppe, pas de tableau) :

{
  "title": string,
  "schedule": string,
  "duration": string,
  "description": string,
  "immersive_description": string,
  "price_per_person_eur": number,
  "family_total_eur": number
}

Contraintes :
- Cohérence avec le lieu du jour (${day.location}) et la saison.
- Pas de doublon avec les autres activités du jour.
- Prix réalistes en euros.`;
}

function buildReplanFromDayPrompt(
  itinerary: any,
  fromDayIndex: number,
  instructions: string
): string {
  const fromDay = itinerary.days?.[fromDayIndex];
  if (!fromDay) throw new Error(`Jour ${fromDayIndex} introuvable`);
  const prev = itinerary.days?.[fromDayIndex - 1];
  const remainingDays = itinerary.days?.slice(fromDayIndex) || [];

  return `Tu vas REPLANIFIER une portion d'itinéraire. L'utilisateur souhaite modifier le jour ${fromDay.label} et tu dois recalculer cohéremment TOUS les jours suivants pour tenir compte de cette modification, en gardant inchangées les dates et la destination finale.

Contexte itinéraire global :
${JSON.stringify(itinerary.summary, null, 2)}

Jour précédent (point de départ) : ${prev ? `${prev.location}, fin à ${prev.accommodation?.coordinates_hint || prev.location}` : '(premier jour - point de départ : ' + itinerary.summary?.departure_location + ')'}

Jours à replanifier (${remainingDays.length} jours, du ${fromDay.label} au dernier) :
${remainingDays.map((d: any) => `  - ${d.label} ${d.date} : était à ${d.location}`).join('\n')}

CONSIGNE UTILISATEUR pour le jour ${fromDay.label} :
"""
${instructions}
"""

Tu dois renvoyer UNIQUEMENT le JSON sous cette forme exacte (le tableau "days" remplace EXACTEMENT les ${remainingDays.length} jours de l'itinéraire à partir de l'index ${fromDayIndex}) :

{
  "days": [ ${FULL_DAY_SCHEMA} ]
}

Contraintes :
- Garde EXACTEMENT les mêmes labels (${remainingDays.map((d: any) => d.label).join(', ')}) et dates (${remainingDays.map((d: any) => d.date).join(', ')}).
- Le premier jour de la liste applique la consigne utilisateur.
- Les jours suivants enchaînent de façon cohérente.
- Le dernier jour DOIT se terminer à ${itinerary.summary?.return_location || itinerary.summary?.departure_location}.
- coordinates obligatoire pour chaque jour.`;
}

async function callClaude(
  userPrompt: string,
  maxTokens = 16000,
  model = MODEL,
  retryCount = 0
): Promise<{ text: string; usage: any }> {
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

  // Retry sur 429 (rate limit) et 529 (overloaded) avec backoff exponentiel
  if ((res.status === 429 || res.status === 529) && retryCount < 4) {
    const retryAfterHeader = res.headers.get('retry-after');
    const fromHeader = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    // Backoff exponentiel : 8s, 16s, 32s, 64s (plafonné à 90s)
    const backoff = Math.min(
      Number.isFinite(fromHeader) ? fromHeader : 8 * Math.pow(2, retryCount),
      90
    );
    console.warn(
      `[anthropic] ${res.status} rate limited (try ${retryCount + 1}/4), waiting ${backoff}s`
    );
    await new Promise((r) => setTimeout(r, backoff * 1000));
    return callClaude(userPrompt, maxTokens, model, retryCount + 1);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Réponse Claude vide.');
  return { text, usage: data?.usage };
}

// ----- Backend Gemini -----
type LLMResult = { text: string; usage: any; modelUsed: string };

async function callGemini(
  userPrompt: string,
  maxTokens = 6000,
  retryCount = 0
): Promise<LLMResult> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY non configuré.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.9,
        // Force la sortie en JSON valide (Gemini garantit la syntaxe).
        responseMimeType: 'application/json',
      },
    }),
  });

  if ((res.status === 429 || res.status === 503) && retryCount < 4) {
    const retryAfterHeader = res.headers.get('retry-after');
    const fromHeader = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const backoff = Math.min(
      Number.isFinite(fromHeader) ? fromHeader : 5 * Math.pow(2, retryCount),
      60
    );
    console.warn(
      `[gemini] ${res.status} (try ${retryCount + 1}/4), waiting ${backoff}s`
    );
    await new Promise((r) => setTimeout(r, backoff * 1000));
    return callGemini(userPrompt, maxTokens, retryCount + 1);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Réponse Gemini vide.');
  const meta = data?.usageMetadata || {};
  // Gemini 2.5 Flash utilise "thinking" par défaut → thoughtsTokenCount est
  // billé comme output. Sans ça, on sous-estime le coût d'un facteur 2.
  const candidates = meta.candidatesTokenCount || 0;
  const thoughts = meta.thoughtsTokenCount || 0;
  return {
    text,
    usage: {
      input_tokens: meta.promptTokenCount || 0,
      output_tokens: candidates + thoughts,
      cache_read_input_tokens: meta.cachedContentTokenCount || 0,
      // détails séparés pour debug si besoin
      thoughts_tokens: thoughts,
      response_tokens: candidates,
    },
    modelUsed: GEMINI_MODEL,
  };
}

// Dispatcher principal (plan, régénération de jour, replan) :
// Gemini si configuré, sinon Sonnet (Claude). Fallback automatique.
async function callMain(
  userPrompt: string,
  maxTokens = 16000
): Promise<LLMResult> {
  if (BACKEND === 'gemini' && GEMINI_API_KEY) {
    try {
      return await callGemini(userPrompt, maxTokens);
    } catch (e) {
      console.warn(
        '[main] Gemini échec, fallback sur Claude Sonnet :',
        (e as Error).message
      );
    }
  }
  const r = await callClaude(userPrompt, maxTokens, MODEL);
  return { ...r, modelUsed: MODEL };
}

// Dispatcher expansion (expand-day, regenerate-activity, fetch-specialties) :
// Gemini si configuré, sinon Haiku (Claude). Fallback automatique.
async function callExpansion(
  userPrompt: string,
  maxTokens = 6000
): Promise<LLMResult> {
  if (BACKEND === 'gemini' && GEMINI_API_KEY) {
    try {
      return await callGemini(userPrompt, maxTokens);
    } catch (e) {
      console.warn(
        '[expansion] Gemini échec, fallback sur Claude Haiku :',
        (e as Error).message
      );
    }
  }
  const r = await callClaude(userPrompt, maxTokens, EXPAND_MODEL);
  return { ...r, modelUsed: EXPAND_MODEL };
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

// Helpers prêts à passer comme caller à parseOrRepair
const callMainSafe = (p: string, t: number) => callMain(p, t);
const callExpansionSafe = (p: string, t: number) => callExpansion(p, t);

// Si le LLM renvoie du JSON cassé, on fait un seul aller-retour pour qu'il le corrige.
// "caller" = fonction qui appelle le LLM (Claude main ou expansion = Gemini/Haiku).
async function parseOrRepair(
  rawText: string,
  caller: (prompt: string, maxTokens: number) => Promise<{ text: string; usage: any }>
): Promise<any> {
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

  const { text: repaired } = await caller(repairPrompt, 16000);
  const second = tryParseJson(repaired);
  if (second.ok) {
    console.log('[json] réparé avec succès');
    return second.value;
  }
  throw new Error(
    `JSON invalide même après tentative de réparation : ${second.error}`
  );
}

async function fetchUnsplashPhotos(query: string, perPage = 5): Promise<any[]> {
  if (!UNSPLASH_ACCESS_KEY) return [];
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });
    if (!res.ok) {
      console.warn('[unsplash]', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return (data?.results || []).map((p: any) => ({
      id: p.id,
      url: p.links?.html,
      photographer: p.user?.name || 'Unsplash',
      photographer_url: p.user?.links?.html,
      src: {
        small: p.urls?.small,
        medium: p.urls?.regular,
        large: p.urls?.full,
      },
      alt: p.alt_description || query,
      source: 'unsplash',
    }));
  } catch (e) {
    console.error('[unsplash] fetch failed', e);
    return [];
  }
}

async function fetchGooglePlacesPhotos(
  query: string,
  maxPhotos = 5
): Promise<any[]> {
  if (!GOOGLE_PLACES_API_KEY) return [];
  try {
    // 1. Cherche le lieu correspondant à la requête
    const searchRes = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.photos',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'fr',
          maxResultCount: 1,
        }),
      }
    );
    if (!searchRes.ok) {
      console.warn('[places] search failed', searchRes.status, await searchRes.text());
      return [];
    }
    const data = await searchRes.json();
    const place = data?.places?.[0];
    if (!place?.photos?.length) return [];

    const placeName = place.displayName?.text || query;
    const photoEntries = place.photos.slice(0, maxPhotos);

    // 2. Pour chaque photo, suit le 302 pour récupérer l'URL CDN googleusercontent
    //    (qui est publique et n'expose pas notre API key).
    const resolved = await Promise.all(
      photoEntries.map(async (p: any, idx: number) => {
        const photoUrl = `https://places.googleapis.com/v1/${p.name}/media?maxHeightPx=600&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}&skipHttpRedirect=true`;
        try {
          // skipHttpRedirect=true retourne du JSON contenant photoUri (pas de 302)
          const r = await fetch(photoUrl);
          if (!r.ok) return null;
          const body = await r.json();
          const cdnUrl = body?.photoUri;
          if (!cdnUrl) return null;
          const attribution = p.authorAttributions?.[0];
          return {
            id: `${place.id}-${idx}`,
            url: attribution?.uri || cdnUrl,
            photographer: attribution?.displayName || placeName,
            photographer_url: attribution?.uri || '',
            src: { small: cdnUrl, medium: cdnUrl, large: cdnUrl },
            alt: placeName,
            source: 'google-places',
          };
        } catch (e) {
          console.warn('[places] photo resolve failed', e);
          return null;
        }
      })
    );

    return resolved.filter(Boolean) as any[];
  } catch (e) {
    console.error('[places] failed', e);
    return [];
  }
}

async function fetchPexelsPhotos(query: string, perPage = 5): Promise<any[]> {
  if (!PEXELS_API_KEY) {
    return [];
  }
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
    });
    if (!res.ok) {
      console.warn('[pexels]', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return (data?.photos || []).map((p: any) => ({
      id: p.id,
      url: p.url,
      photographer: p.photographer,
      photographer_url: p.photographer_url,
      src: {
        small: p.src?.small,
        medium: p.src?.medium,
        large: p.src?.large,
      },
      alt: p.alt || query,
      source: 'pexels',
    }));
  } catch (e) {
    console.error('[pexels] fetch failed', e);
    return [];
  }
}

// Dispatcher : route vers la bonne source avec fallback gracieux
async function fetchPhotos(
  query: string,
  perPage: number,
  preferredSource: string
): Promise<any[]> {
  // Ordre de tentative selon la préférence
  const order: Record<string, string[]> = {
    'google-places': ['google-places', 'unsplash', 'pexels'],
    unsplash: ['unsplash', 'google-places', 'pexels'],
    pexels: ['pexels', 'unsplash', 'google-places'],
    auto: ['google-places', 'unsplash', 'pexels'],
  };
  const sources = order[preferredSource] || order.auto;
  for (const src of sources) {
    let photos: any[] = [];
    if (src === 'google-places') photos = await fetchGooglePlacesPhotos(query, perPage);
    else if (src === 'unsplash') photos = await fetchUnsplashPhotos(query, perPage);
    else if (src === 'pexels') photos = await fetchPexelsPhotos(query, perPage);
    if (photos.length) return photos;
  }
  return [];
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
      const { text, usage, modelUsed } = await callMain(prompt, 6000);
      const day = await parseOrRepair(text, callMainSafe);
      return jsonResponse({ day, usage, model: modelUsed });
    }

    if (mode === 'fetch-specialties') {
      const { location, count } = body;
      if (!location || typeof location !== 'string') {
        return jsonResponse({ error: 'Paramètre "location" requis.' }, 400);
      }
      const prompt = buildFetchSpecialtiesPrompt(location, count || 4);
      // Expansion backend (Gemini ou Haiku selon EXPAND_BACKEND)
      const { text, usage, modelUsed } = await callExpansion(prompt, 2000);
      const parsed = await parseOrRepair(text, callExpansionSafe);
      return jsonResponse({
        specialties: parsed?.specialties || [],
        usage,
        model: modelUsed,
      });
    }

    if (mode === 'regenerate-activity') {
      const { itinerary, day_index, activity_index, instructions } = body;
      if (
        !itinerary ||
        typeof day_index !== 'number' ||
        typeof activity_index !== 'number' ||
        !instructions
      ) {
        return jsonResponse(
          {
            error:
              'Body invalide : itinerary, day_index, activity_index, instructions requis',
          },
          400
        );
      }
      const prompt = buildRegenerateActivityPrompt(
        itinerary,
        day_index,
        activity_index,
        instructions
      );
      // Expansion backend (Gemini ou Haiku) — modification ciblée, pas besoin de Sonnet
      const { text, usage, modelUsed } = await callExpansion(prompt, 2000);
      const activity = await parseOrRepair(text, callExpansionSafe);
      return jsonResponse({ activity, usage, model: modelUsed });
    }

    if (mode === 'replan-from-day') {
      const { itinerary, from_day_index, instructions } = body;
      if (
        !itinerary ||
        typeof from_day_index !== 'number' ||
        !instructions
      ) {
        return jsonResponse(
          { error: 'Body invalide : itinerary, from_day_index, instructions requis' },
          400
        );
      }
      const prompt = buildReplanFromDayPrompt(itinerary, from_day_index, instructions);
      // Budget large : replanifier la suite d'un long voyage peut nécessiter
      // beaucoup de tokens (chaque jour fait ~1500-2000 tokens).
      const { text, usage, modelUsed } = await callMain(prompt, 32000);
      const parsed = await parseOrRepair(text, callMainSafe);
      const days = parsed?.days;
      if (!Array.isArray(days)) {
        return jsonResponse(
          { error: 'Réponse mal formée : "days" attendu en tableau.' },
          500
        );
      }
      return jsonResponse({ days, usage, model: modelUsed });
    }

    if (mode === 'fetch-photos') {
      const { query, per_page, source } = body;
      if (!query || typeof query !== 'string') {
        return jsonResponse({ error: 'Paramètre "query" requis.' }, 400);
      }
      const preferred = source || 'auto';
      const photos = await fetchPhotos(query, per_page || 5, preferred);
      return jsonResponse({ photos });
    }

    if (mode === 'plan-trip') {
      const preferences = body?.preferences;
      if (!preferences?.destinations || !preferences?.startDate) {
        return jsonResponse({ error: 'preferences invalides' }, 400);
      }
      const prompt = buildPlanPrompt(preferences);
      // 32000 tokens : Gemini "thinking" peut en consommer une partie,
      // le reste doit suffire pour summary + 30+ day_plans + notes complètes
      // (packing list + phrases + tips). Gemini Flash supporte jusqu'à 65k.
      const { text, usage, modelUsed } = await callMain(prompt, 32000);
      const plan = await parseOrRepair(text, callMainSafe);
      return jsonResponse({ plan, usage, model: modelUsed });
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
      // Expansion backend : Gemini 2.5 Flash si configuré, sinon Haiku
      const { text, usage, modelUsed } = await callExpansion(prompt, 6000);
      const day = await parseOrRepair(text, callExpansionSafe);
      return jsonResponse({ day, usage, model: modelUsed });
    }

    // Default : full single-call generation (small trips ≤ 8 days)
    const preferences = body?.preferences;
    if (!preferences?.destinations || !preferences?.startDate) {
      return jsonResponse({ error: 'preferences invalides' }, 400);
    }
    const userPrompt = buildFullPrompt(preferences);
    // Budget large : un voyage 8 jours détaillé peut atteindre 20k tokens.
    const { text, usage, modelUsed } = await callMain(userPrompt, 24000);
    const itinerary = await parseOrRepair(text, callMainSafe);
    return jsonResponse({ itinerary, usage, model: modelUsed });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || String(err) },
      500
    );
  }
});
