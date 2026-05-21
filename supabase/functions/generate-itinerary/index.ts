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
import { jsonrepair } from 'https://esm.sh/jsonrepair@3.10.0';

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

// Backend LLM : 'gemini', 'claude' ou 'deepseek'. Lu dynamiquement depuis
// la table app_config (clé 'llm_backend') — l'admin peut basculer depuis
// le dashboard sans redéployer la fonction.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || '';
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-chat';
// Fallback statique si la table app_config est inaccessible
const DEFAULT_BACKEND = (
  Deno.env.get('BACKEND') ||
  Deno.env.get('EXPAND_BACKEND') ||
  (GEMINI_API_KEY ? 'gemini' : 'claude')
).toLowerCase();

// Cache 60s pour ne pas spammer la DB à chaque appel
let cachedBackend: { value: string; expires: number } | null = null;

async function getActiveBackend(): Promise<string> {
  if (cachedBackend && Date.now() < cachedBackend.expires) {
    return cachedBackend.value;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return DEFAULT_BACKEND;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_config?key=eq.llm_backend&select=value`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (res.ok) {
      const rows = await res.json();
      const stored = rows?.[0]?.value;
      const value =
        typeof stored === 'string'
          ? stored.toLowerCase()
          : DEFAULT_BACKEND;
      // TTL court (15s) pour que les bascules admin soient quasi immédiates
      cachedBackend = { value, expires: Date.now() + 15_000 };
      return value;
    }
  } catch (e) {
    console.warn('[config] failed to read llm_backend', e);
  }
  return DEFAULT_BACKEND;
}

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

const VEHICLE_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
  'avion-voiture',
]);

const SYSTEM_PROMPT = `Tu es l'expert voyage TravelO, un agent de tour-opérateur francophone, méticuleux et passionné. Tu rédiges des itinéraires comme un programme vendu par une grande agence : tu donnes envie de partir.

STYLE D'ÉCRITURE — RÈGLE CRITIQUE :
Tu écris dans le style d'un magazine de voyage haut de gamme (Condé Nast Traveller, Géo, Le Routard). Chaque description doit :
1. Démarrer avec un verbe de second personne au futur ou à l'impératif doux ("Vous flânerez", "Laissez-vous porter", "Plongez dans...", "Embarquez pour...").
2. Convoquer les SENS : lumière, odeurs, sons, textures, goûts. Cite des détails concrets et évocateurs ("la lumière dorée du soir sur les façades ocre", "l'odeur du café fraîchement moulu mêlée à celle des pastels chauds").
3. Évoquer une ATMOSPHÈRE, pas juste une suite d'actions. Le lecteur doit visualiser et ressentir.
4. Mentionner au moins une anecdote, un détail local, une référence historique ou culturelle qui ancre le lieu.
5. Éviter à tout prix : "Visite de…", "Vous visiterez…", "Découverte de…" en début de phrase. Préfère "Au cœur des ruelles pavées d'Alfama, vous découvrirez…".

EXEMPLES À SUIVRE :

❌ MAUVAIS (sec, factuel) :
"Matin : Visite de la cathédrale de Lisbonne. Vous verrez les vitraux. Puis promenade dans le quartier."

✅ BON (immersif, magazine) :
"Matin : Dès l'aube, prenez la direction de la cathédrale Sé, posée sur sa colline depuis le XIIe siècle. Poussez les lourdes portes en bois : vous pénétrerez dans une nef baignée d'une lumière ambrée, où chaque vitrail raconte une page de l'histoire portugaise. À la sortie, laissez-vous happer par les ruelles d'Alfama qui descendent vers le Tage, ponctuées du chant lancinant d'un Fado échappé d'une fenêtre entrouverte."

❌ MAUVAIS :
"Repas : Pastel de nata."

✅ BON :
"Repas : impossible de partir sans goûter à la pâtisserie nationale chez Manteigaria : une coque croquante, une crème vanillée encore tiède, un nuage de cannelle — l'archétype du pastel de nata, à savourer debout au comptoir, comme les Lisboètes."

UNICITÉ — RÈGLE STRICTE (pas de doublons dans l'itinéraire) :
- Chaque activité unique apparaît UNE SEULE fois sur tout le voyage. Pas 2 visites du même temple, pas 2 dégustations du même plat dans deux endroits différents, pas 2 musées identiques.
- culinary_specialties : MAX 2 par jour. Si une journée n'a pas de spécialité vraiment marquante, mets un tableau VIDE ([]) — mieux vaut 0 spécialité qu'une banale ou répétée.
- Aucune spécialité culinaire ne doit être citée 2 fois dans l'itinéraire (ex. si "panettone" est en J3, n'en parle plus dans aucune autre journée).
- Cette unicité vaut pour activities, culinary_specialties, et le contenu des moments (morning/noon/afternoon/evening).

Règles strictes (en plus du style) :
- Rédige TOUJOURS en français, ton chaleureux, sensoriel, narratif.
- TEMPÉRATURE NARRATIVE ÉLEVÉE : sois généreux dans les descriptions, lyrique mais jamais kitsch. Pas de superlatifs vides ("magnifique", "incroyable", "merveilleux" seuls). Préfère des images précises.
- Tiens compte des dates pour calibrer la météo (saison réaliste pour la destination).
- Adapte le rythme au type de voyage : un séjour fixe a peu de trajets, un road trip en a beaucoup.
- Adapte les hébergements et les repas au niveau de budget choisi.
- Prix toujours en euros (€), réalistes pour le pays et la saison.
- N'invente pas d'établissements de luxe absurdement célèbres ; privilégie des adresses crédibles.
- Pour chaque jour, structure en Matin / Midi / Après-midi / Soir.
- Les champs "immersive_description" des activités sont l'occasion d'être ENCORE plus narratif et descriptif (3-5 phrases, ton vendeur de rêve).
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

TYPES DE VOYAGE — RÈGLES SPÉCIFIQUES :
- itinerant : voyage moyennement structuré, mix de transports selon le contexte.
- roadtrip-voiture / roadtrip-van / roadtrip-camping-car : véhicule PERSONNEL du voyageur, départ direct du domicile (cf. règles road trip ci-dessous).
- avion-voiture : vol aller depuis lieu de départ vers la destination, puis VOITURE DE LOCATION sur place. Journée 1 = arrivée vol + récupération voiture. Ajoute le coût de la location dans budget (~40-70 €/jour selon catégorie, + caution + assurance ~150 € amortie). Trajets locaux en voiture (carburant à compter). Dernière journée = restitution voiture + vol retour.
- avion-citybreak : vol aller-retour + visite à PIED et transports en commun sur place. AUCUNE voiture. Hôtels en centre-ville. Plus court généralement (3-7 jours). Ajoute le coût des vols et des transports en commun.
- train-international : Eurostar / TGV / ICE / nuit-train pour rejoindre une destination étrangère (Londres, Barcelone, Berlin, etc.). Pas de voiture, transports en commun sur place. Coût du billet aller-retour explicité dans le 1er et le dernier trip.
- circuit-train : circuit en train DOMESTIQUE avec plusieurs étapes (ex. JR Pass au Japon, InterRail). Coût total des billets train.
- velo : voyage à VÉLO. Étapes 50-80 km/jour, dénivelé raisonnable, hébergements vélo-friendly (gîtes/auberges/B&B avec garage vélo). Pas de voiture. Pense aux jours plus courts en montagne.
- trek : voyage itinérant à PIED (randonnée). Étapes 15-25 km/jour, refuges/gîtes d'étape/bivouac selon préférence d'hébergement. Pas de voiture. Pense au dénivelé et à la difficulté.
- croisiere : ports d'escale, transitions en MER entre les étapes (1 nuit en mer typiquement). Hébergement = cabine sur le navire (déjà inclus dans le forfait croisière, mettre price_eur = 0 et type = "Cabine croisière"). Compte le prix total du forfait dans les trips.
- sejour-fixe : base unique + excursions à la journée. Pas d'enchaînement de villes, le même hébergement chaque nuit.

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

const WEEKDAYS_FR = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
];

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

  const offDays = Number(p.offDays) || 0;
  const offBlock =
    offDays > 0
      ? `\nJours off / repos : ${offDays} jours sur ${expectedDays}, à RÉPARTIR ÉQUILIBREMENT dans l'itinéraire. Un jour off : reste au même endroit que la veille (pas de trajet), activités minimales/optionnelles, pas d'excursion payante, repas tranquille. anchor_theme commence par "Journée libre" ou "Repos à <lieu>". is_off_day = true.`
      : '';

  // === Données de profil utilisateur (injectées via _profileExtras) ===
  // Voyageurs : régimes, allergies, mobilité, langues
  const extras = p._profileExtras || {};
  const travelers = Array.isArray(extras.travelers) ? extras.travelers : [];
  const personalInfo = extras.personalInfo || {};
  const visited = Array.isArray(extras.visitedPlaces) ? extras.visitedPlaces : [];
  const wishlist = Array.isArray(extras.wishlistPlaces) ? extras.wishlistPlaces : [];

  const allDietary = new Set<string>();
  const allAllergies: string[] = [];
  const mobilityNotes: string[] = [];
  const allLanguages = new Set<string>();

  if (Array.isArray(personalInfo.dietary)) {
    for (const d of personalInfo.dietary) allDietary.add(d);
  }
  if (personalInfo.allergies) allAllergies.push(`utilisateur : ${personalInfo.allergies}`);
  if (personalInfo.mobility) mobilityNotes.push(`utilisateur : ${personalInfo.mobility}`);
  if (Array.isArray(personalInfo.languages)) {
    for (const l of personalInfo.languages) allLanguages.add(l);
  }

  for (const t of travelers) {
    if (Array.isArray(t.dietary)) for (const d of t.dietary) allDietary.add(d);
    if (t.allergies) allAllergies.push(`${t.name} : ${t.allergies}`);
    if (t.mobility) mobilityNotes.push(`${t.name} : ${t.mobility}`);
    if (Array.isArray(t.languages)) for (const l of t.languages) allLanguages.add(l);
  }

  let constraintsBlock = '';
  if (allDietary.size) {
    constraintsBlock += `\nRégime(s) alimentaire(s) du groupe : ${[...allDietary].join(', ')} — adapte les suggestions de restaurants et de spécialités culinaires en conséquence (évite ce qui n'est pas compatible).`;
  }
  if (allAllergies.length) {
    constraintsBlock += `\nAllergies / contraintes médicales : ${allAllergies.join(' ; ')} — signale dans practical_tips et évite les activités/repas à risque.`;
  }
  if (mobilityNotes.length) {
    constraintsBlock += `\nMobilité : ${mobilityNotes.join(' ; ')} — privilégie hébergements et activités accessibles, évite les randonnées difficiles, escaliers nombreux, dénivelés importants.`;
  }
  if (allLanguages.size) {
    constraintsBlock += `\nLangues parlées par le groupe : ${[...allLanguages].join(', ')} — utile pour calibrer les "local_phrases" (privilégie une langue locale que le groupe ne parle pas).`;
  }

  let travelersBlock = '';
  if (travelers.length) {
    const lines = travelers.map((t: any) => {
      const age = t.birth_year ? new Date().getFullYear() - t.birth_year : null;
      const parts = [t.name];
      if (t.relation) parts.push(`(${t.relation}${age !== null ? `, ${age} ans` : ''})`);
      else if (age !== null) parts.push(`(${age} ans)`);
      return `  - ${parts.join(' ')}`;
    });
    travelersBlock = `\nVoyageurs supplémentaires (en plus de l'utilisateur principal) :\n${lines.join('\n')}`;
  }

  let visitedBlock = '';
  if (visited.length) {
    const names = visited.map((v: any) => v.name).filter(Boolean);
    if (names.length) {
      visitedBlock = `\nLieux DÉJÀ VISITÉS par le voyageur (à ÉVITER dans l'itinéraire sauf si listés dans mustInclude) : ${names.join(', ')}.`;
    }
  }

  let wishlistBlock = '';
  if (wishlist.length) {
    const names = wishlist.map((w: any) => w.name).filter(Boolean);
    if (names.length) {
      wishlistBlock = `\nWISHLIST du voyageur (lieux qu'il rêve de visiter — INTÈGRE-LES en priorité si la destination/itinéraire s'y prête géographiquement) : ${names.join(', ')}.`;
    }
  }

  return `Destination(s) : ${p.destinations}
Période : du ${p.startDate} au ${p.endDate} (durée = ${expectedDays} jours inclusifs, à respecter EXACTEMENT — ne change AUCUNE date)
Départ : ${p.departureLocation}
Arrivée finale : ${p.returnLocation || p.departureLocation}${
    p.returnLocation && p.returnLocation !== p.departureLocation
      ? ' (aller-simple)'
      : ' (aller-retour)'
  }
Participants : ${p.adults} adulte(s), ${children}${travelersBlock}
Type de voyage : ${p.tripType}${vehicleBlock}
Centres d'intérêt : ${(p.interests || []).join(', ')}${specificActivities}
Niveau de budget : ${p.budget}${practicalBlock}${offBlock}${constraintsBlock}${visitedBlock}${wishlistBlock}
Étapes IMPÉRATIVES : ${p.mustInclude || '(aucune)'}
À éviter : ${p.toAvoid || '(aucun)'}`;
}

const FULL_DAY_SCHEMA = `{
  "label": "Jx",
  "date": "YYYY-MM-DD",
  "weekday": "lundi",
  "location": "Ville / région",
  "day_title": "Titre accrocheur 8-14 mots qui RÉSUME L'ENSEMBLE DE LA JOURNÉE en mentionnant 2-3 lieux-clés + ambiance/fil rouge (ex: 'Tokyo en contrastes : marché de Toyosu à l'aube, néons de Shibuya à minuit'). PAS juste le matin.",
  "is_off_day": boolean,
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
- day_title obligatoire pour CHAQUE jour. RÈGLE CRITIQUE : il doit
  (1) mentionner 2 à 3 LIEUX-CLÉS visités entre le matin, l'après-midi ET le soir (pas seulement le matin)
  (2) capturer l'ambiance/contraste/fil rouge de la journée
  (3) faire 8 à 14 mots, style magazine voyage haut de gamme, donner TERRIBLEMENT envie
  Modèle : [accroche/ambiance] : [2-3 lieux phares]
  ✅ "Tokyo en contrastes : marché de Toyosu à l'aube, néons de Shibuya à minuit"
  ✅ "Kyoto poétique : Pavillon d'Or, Gion et chemin des philosophes"
  ✅ "De la mer au volcan : ports d'Otaru, fumerolles de Showa-Shinzan, ryokan de Noboribetsu"
  ❌ "Visite de Tokyo" (générique)
  ❌ "Éveil des sens au marché de Toyosu" (ne couvre que le matin, oublie Todoroki et Shibuya)
  ❌ "Belle journée à Kyoto" (creux, pas de lieux)
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
      "is_off_day": boolean,
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
- day_title obligatoire : 8-14 mots, style magazine voyage, qui RÉSUME LA JOURNÉE ENTIÈRE en mentionnant 2 à 3 LIEUX-CLÉS répartis sur matin/après-midi/soir + ambiance/fil rouge. Pas seulement le matin. Modèle : [accroche/ambiance] : [2-3 lieux phares]. Ex : "Tokyo en contrastes : marché de Toyosu à l'aube, néons de Shibuya à minuit".
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

const CATEGORY_BRIEF: Record<string, { label: string; brief: string; examples: string }> = {
  incontournable: {
    label: 'INCONTOURNABLES',
    brief:
      'les lieux qu\'on ne peut pas manquer, ceux qu\'on regrettera toute sa vie d\'avoir ratés. Les emblèmes absolus de la destination, ceux que tout le monde reconnaît mais qui méritent vraiment leur réputation.',
    examples:
      'monuments mythiques, panoramas légendaires, villes-symboles, sites classés UNESCO, plages emblématiques',
  },
  insolite: {
    label: 'INSOLITES',
    brief:
      'des expériences originales, inattendues, qu\'on ne trouve pas dans les guides classiques mais qui marquent à vie. Le contraire d\'une visite touristique standard : on raconte ça en rentrant.',
    examples:
      'bains thermaux secrets, dîners chez l\'habitant, festivals locaux insolites, observation d\'un phénomène naturel, ateliers d\'artisans, hôtels improbables, restos sans menu, marchés nocturnes confidentiels, micro-musées passion',
  },
  'hors-sentiers': {
    label: 'HORS DES SENTIERS BATTUS',
    brief:
      'les pépites que seuls les locaux connaissent. Villages confidentiels, vallées oubliées, sentiers déserts, lieux préservés du tourisme de masse. L\'authenticité brute, sans filtre, sans foule.',
    examples:
      'villages perchés à 800 habitants, criques accessibles uniquement à pied, lacs d\'altitude peu fréquentés, chemins muletiers oubliés, vallées rurales méconnues, ports de pêche authentiques',
  },
};

function buildSuggestPlacesPrompt(
  destination: string,
  tripType: string,
  startDate: string,
  endDate: string,
  adults: number,
  childrenAges: number[],
  category: 'incontournable' | 'insolite' | 'hors-sentiers'
): string {
  const days = computeDays(startDate, endDate);
  const children = Array.isArray(childrenAges) && childrenAges.length
    ? `${childrenAges.length} enfant(s) (âges : ${childrenAges.join(', ')} ans)`
    : '0 enfant';
  const c = CATEGORY_BRIEF[category];

  return `Tu es l'expert voyage TravelO. L'utilisateur ne sait pas encore quoi visiter à "${destination}". Tu vas lui proposer une SÉLECTION RICHE et VARIÉE de lieux dans UNE SEULE catégorie : ${c.label}.

DÉFINITION DE LA CATÉGORIE :
${c.brief}
Exemples : ${c.examples}

Contexte voyage :
- Destination : ${destination}
- Période : du ${startDate} au ${endDate} (${days} jours sur place)
- Mode de voyage : ${tripType}
- Participants : ${adults} adulte(s), ${children}

OBJECTIF : 15 à 18 lieux ${c.label} de ${destination}, vraiment différents les uns des autres, qui donnent toutes envie de partir.

STYLE D'ÉCRITURE — RÈGLE CRITIQUE :
Pour CHAQUE lieu, tu produis DEUX TEXTES distincts :

1. "hook" : UNE accroche courte et frappante (8 à 14 mots, UNE seule phrase).
   - Doit donner envie en un clin d'œil, comme un titre de magazine
   - Concrète, sensorielle, jamais générique
   ✅ "Un sanctuaire d'or qui flamboie au-dessus d'un étang miroir"
   ✅ "Un train à vapeur qui s'enfonce dans 41 tunnels et 21 ponts"
   ✅ "Le marché aux poissons le plus dingue du monde, dès 5h du matin"
   ❌ "Un beau sanctuaire bouddhiste"
   ❌ "Une expérience culinaire intéressante"

2. "short_description" : 2 phrases (30-50 mots) qui DÉTAILLENT la promesse du hook.
   - Faire APPEL AUX SENS (ce qu'on voit, entend, sent, ressent)
   - Détails concrets, jamais de phrases plates
   - Un détail singulier qui ne s'invente pas

EXEMPLE COMPLET (à ne PAS copier, c'est juste pour le ton) :
{
  "hook": "Un sanctuaire d'or qui flamboie au-dessus d'un étang miroir",
  "short_description": "À l'aube, la brume s'effiloche entre les pins et le pavillon doré se reflète à la perfection dans l'eau noire. L'odeur de cèdre se mêle à celle de l'encens des premiers visiteurs."
}

Schéma JSON STRICT (renvoie UNIQUEMENT ce JSON, pas de texte autour, pas de markdown) :
{
  "places": [
    {
      "id": "slug-ascii-en-minuscules-tirets",
      "name": "Nom du lieu / de l'expérience",
      "category": "${category}",
      "type": "ville" | "village" | "site" | "musée" | "plage" | "rando" | "parc" | "panorama" | "experience" | "gastronomie",
      "location": "Ville ou région où se trouve le lieu",
      "coordinates": { "lat": number, "lng": number },
      "hook": "Accroche courte et frappante, 8-14 mots, une seule phrase",
      "short_description": "2 phrases (30-50 mots) qui détaillent et donnent les sensations concrètes",
      "suggested_duration": "1h" | "2h" | "Demi-journée" | "1 jour" | "1-2 jours",
      "best_season": "Toute l'année" | "Printemps-été" | "Été" | "Automne" | "Hiver" | "Avril-octobre",
      "photo_query": "expression COURTE (2-4 mots) optimisée pour trouver une photo sur Unsplash/Pexels"
    }
  ]
}

Contraintes :
- 15 à 18 lieux, TOUS dans la catégorie "${category}" (ne mélange pas)
- Varier les TYPES : ne propose pas 12 musées, mélange paysages, expériences, sites, gastronomie, panoramas, etc.
- Géographiquement RÉPARTIS sur ${destination} — pas tous dans la même ville
- Adapter au mode de voyage "${tripType}" : vélo → accessible vélo ; van/CC → nature et bivouacs ; citybreak → urbain ; trek → randos
- ${childrenAges?.length ? `Avec enfants (${childrenAges.join(', ')} ans) : inclure 2-3 lieux clairement family-friendly` : 'Sans enfants : tu peux pousser sur des lieux plus pointus ou physiques'}
- Pas de doublons, pas de "centre-ville de X" générique
- coordinates obligatoire et précis (utilise tes connaissances géographiques)
- photo_query : 2-4 mots, nom du lieu sans préposition (ex: "Kinkaku-ji Kyoto", "Mont Fuji Kawaguchiko"), pour qu'Unsplash trouve une photo du LIEU lui-même
- id : slug ASCII unique en minuscules, ex: "kinkaku-ji-kyoto"`;
}

function buildSuggestCitiesPrompt(
  destination: string,
  tripType: string,
  startDate: string,
  endDate: string,
  adults: number,
  childrenAges: number[]
): string {
  const days = computeDays(startDate, endDate);
  const children = Array.isArray(childrenAges) && childrenAges.length
    ? `${childrenAges.length} enfant(s) (âges : ${childrenAges.join(', ')} ans)`
    : '0 enfant';

  return `Tu es l'expert voyage TravelO. L'utilisateur veut visiter "${destination}". Tu vas lui proposer les VILLES PRINCIPALES à inclure dans son voyage — celles que les grands tours-opérateurs (Voyageurs du Monde, Kuoni, Asia, Marco Vasco, etc.) mettent presque systématiquement dans leurs circuits.

Contexte voyage :
- Destination : ${destination}
- Période : ${startDate} au ${endDate} (${days} jours)
- Mode de voyage : ${tripType}
- Participants : ${adults} adulte(s), ${children}

RÈGLE CRITIQUE — quand renvoyer des villes :
- Si la destination est un PAYS ou une RÉGION large (ex: Japon, Italie, Corse, Andalousie, Patagonie) → renvoie 4 à 8 villes incontournables des circuits classiques.
- Si la destination est UNE SEULE VILLE (ex: Lisbonne, Tokyo, Marrakech) → renvoie un tableau VIDE [].
- Si la destination est un mix (ex: "Paris-Côte d'Azur"), prends les villes mentionnées + 1-2 ajouts classiques.

STYLE :
Pour chaque ville :
- "hook" : 1 phrase courte (10-15 mots) qui résume pourquoi cette ville est dans tous les circuits, avec un détail concret (un monument, un quartier, une ambiance)
- "why" : 1 phrase qui explique pourquoi les tours-opérateurs l'incluent quasi-systématiquement (pas plus de 25 mots)
- "suggested_days" : nombre de jours réaliste à y consacrer (1-4)

EXEMPLE (à ne PAS copier, juste pour le ton) :
{
  "name": "Kyoto",
  "hook": "L'ancienne capitale impériale, 1 600 temples et un labyrinthe de ruelles à lanternes",
  "why": "Présente dans 95% des circuits Japon : concentre les sites UNESCO les plus emblématiques.",
  "suggested_days": 3
}

Schéma JSON STRICT (UNIQUEMENT ce JSON, pas de texte autour) :
{
  "cities": [
    {
      "id": "slug-en-minuscules",
      "name": "Nom de la ville",
      "coordinates": { "lat": number, "lng": number },
      "hook": "1 phrase 10-15 mots avec un détail concret",
      "why": "Pourquoi les TO l'incluent quasi-toujours, max 25 mots",
      "suggested_days": 1 | 2 | 3 | 4,
      "photo_query": "expression COURTE (2-4 mots) optimisée Unsplash/Pexels, ex 'Kyoto temples Japan'"
    }
  ]
}

Contraintes :
- ${days <= 4 ? '4 à 5 villes max (voyage court)' : days <= 10 ? '5 à 7 villes' : '6 à 8 villes (voyage long)'}
- Ordonnées par ordre de PRIORITÉ (la plus incontournable en premier)
- coordinates précises
- Adapter au mode "${tripType}" : trek/vélo → villes étapes accessibles ; croisière → ports
- Si destination = une seule ville, renvoie : { "cities": [] }`;
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

// ============================================================
// MODE "local-activities" : découverte d'activités autour d'un point
// (radius, types, météo, enfants) — ne crée PAS d'itinéraire.
// ============================================================
const ACTIVITY_TYPES_BRIEF: Record<string, string> = {
  insolite: 'expériences originales / hors guides classiques',
  culture: 'musées, monuments, sites historiques, galeries',
  nature: 'parcs, jardins, balades en pleine nature, forêts, grottes',
  baignade:
    'lieux pour se baigner : plages, lacs, rivières baignables, cascades, piscines naturelles, sources chaudes',
  sport: 'sport et activités physiques (kayak, escalade, vélo, etc.)',
  aventure:
    'sensations fortes : parapente, accrobranche, saut élastique, karting, escape game, via ferrata',
  panorama:
    'points de vue, belvédères, miradors, sommets accessibles, spots couchers de soleil',
  gastronomie: 'restaurants typiques, marchés, dégustations, cours de cuisine',
  famille:
    'parcs d\'attractions, mini-golf, ateliers enfants, plaines de jeux, lieux family-friendly',
  animalier:
    'zoos, aquariums, fermes pédagogiques, observation faune sauvage, parcs animaliers',
  festival:
    'événements de SAISON : concerts, marchés saisonniers, fêtes locales, expos temporaires actuellement en cours',
  'bien-etre': 'spa, thermes, sauna, yoga, retraites',
  spirituel:
    'monastères, abbayes, lieux de méditation, sites sacrés, pèlerinages',
  'vie-nocturne': 'bars, concerts, clubs, événements du soir',
  shopping: 'boutiques uniques, marchés, créateurs locaux',
  romantique: 'idées en couple : panoramas, dîners intimes, croisières',
};

function buildLocalActivitiesPrompt(args: {
  location: string;
  radiusKm: number;
  types: string[];
  rainyOnly: boolean;
  withKids: boolean;
  exclude: string[];
}): string {
  const { location, radiusKm, types, rainyOnly, withKids, exclude } = args;
  const typesList = types.length
    ? types
        .map((t) => `  - ${t} : ${ACTIVITY_TYPES_BRIEF[t] || t}`)
        .join('\n')
    : '  (tous types confondus)';

  const filterBlock = [
    rainyOnly
      ? '⚠️ TEMPS DE PLUIE : indoor=true OBLIGATOIRE pour CHAQUE activité (sauf si elle reste agréable sous la pluie : thermes en plein air, forêt enchantée, etc.). Évite tout ce qui devient pénible mouillé.'
      : '',
    withKids
      ? '👨‍👩‍👧 AVEC ENFANTS : chaque activité doit être adaptée aux enfants (durée raisonnable, intérêt pour eux, pas de risque).'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const excludeBlock = exclude.length
    ? `\n⛔ NE PROPOSE PAS les activités suivantes (déjà vues par l'utilisateur) : ${exclude.join(', ')}.`
    : '';

  return `Tu es l'expert voyage TravelO. Un utilisateur cherche des activités à faire AUTOUR de lui pour s'occuper aujourd'hui ou demain. Tu vas lui proposer 10 activités situées dans un rayon de ${radiusKm} km autour de "${location}".

Position de l'utilisateur : ${location}
Rayon de recherche : ${radiusKm} km

Types d'activités souhaitées :
${typesList}

${filterBlock}${excludeBlock}

STYLE D'ÉCRITURE :
Pour chaque activité, produis :
- "title" : nom clair et identifiable, comme dans Google Maps (ex: "Grotte de Lacave", "Atelier verrier de Biot")
- "hook" : 1 phrase courte (10-15 mots) qui donne envie d'un coup d'œil
- "description" : 2-3 phrases (40-70 mots) qui décrivent l'expérience sensoriellement, avec un détail concret qui ne s'invente pas

EXEMPLE (à NE PAS copier — juste pour le ton) :
{
  "title": "Gouffre de Padirac",
  "hook": "Descendez à 103 m sous terre pour glisser en barque sur une rivière émeraude",
  "description": "L'ascenseur plonge dans la pénombre, puis une barque vous emporte sur une eau translucide entre des draperies calcaires. Une heure hors du temps, à 13°C constants, dans le silence des galeries souterraines."
}

Schéma JSON STRICT (uniquement ce JSON, pas de markdown, pas de texte autour) :
{
  "activities": [
    {
      "id": "slug-ascii-unique-en-minuscules",
      "title": "Nom exact et trouvable sur Google Maps",
      "type": "insolite" | "culture" | "nature" | "baignade" | "sport" | "aventure" | "panorama" | "gastronomie" | "famille" | "animalier" | "festival" | "bien-etre" | "spirituel" | "vie-nocturne" | "shopping" | "romantique",
      "hook": "Accroche 10-15 mots",
      "description": "2-3 phrases, 40-70 mots, sensorielle et concrète",
      "address": "Adresse postale lisible (ville + département/région)",
      "distance_km": number,
      "coordinates": { "lat": number, "lng": number },
      "indoor": boolean,
      "duration": "30 min" | "1h" | "2h" | "Demi-journée" | "Journée",
      "price_eur_per_person": number,
      "price_note": "gratuit" | "5-15 €" | "20-40 €" | etc.,
      "best_time": "matin" | "après-midi" | "soir" | "toute la journée",
      "booking_hint": "Site/plateforme où réserver si pertinent, sinon null",
      "photo_query": "expression COURTE (2-4 mots) pour trouver une photo sur Unsplash, ex 'Gouffre Padirac Lot'"
    }
  ]
}

Contraintes :
- EXACTEMENT 10 activités, vraiment différentes les unes des autres.
- TOUTES dans un rayon RÉALISTE de ${radiusKm} km à vol d'oiseau autour de "${location}" — utilise tes connaissances géographiques pour rester proche.
- distance_km : entier en kilomètres, distance à vol d'oiseau approximative. Doit être ≤ ${radiusKm}.
- coordinates : lat/lng précis pour situer sur carte.
- Variées : ne mets pas 10 musées même si l'utilisateur a coché "culture". Mélange les sous-genres et les distances.
- indoor : true si l'activité se déroule à l'intérieur (musée, grotte, spa, restaurant). false si extérieur (rando, plage, festival open-air).
- Adresse réaliste et identifiable (Google Maps doit pouvoir la trouver).
- Pas de doublons. Pas d'activité fictive.
- id : slug ASCII unique, ex: "gouffre-de-padirac".`;
}

// ============================================================
// MODE "build-day-from-activities" : assemble une journée
// à partir d'activités sélectionnées par l'utilisateur.
// Réutilise FULL_DAY_SCHEMA pour s'intégrer aux itinéraires existants.
// ============================================================
function buildBuildDayPrompt(args: {
  selectedActivities: any[];
  location: string;
  date: string;
  withKids: boolean;
  adults: number;
  childrenAges: number[];
}): string {
  const { selectedActivities, location, date, withKids, adults, childrenAges } = args;
  const dayWeekday = (() => {
    try {
      const d = new Date(date + 'T00:00:00Z');
      return WEEKDAYS_FR[d.getUTCDay()];
    } catch {
      return '';
    }
  })();
  const childrenLabel = childrenAges.length
    ? `${childrenAges.length} enfant(s) (âges : ${childrenAges.join(', ')} ans)`
    : '0 enfant';

  return `Tu vas construire UNE journée complète à partir des activités que l'utilisateur a sélectionnées. La journée doit s'enchaîner logiquement (proximité géographique, horaires cohérents), inclure les repas et un peu de temps libre si besoin.

Lieu de base : ${location}
Date : ${date} (${dayWeekday})
Participants : ${adults} adulte(s), ${childrenLabel}${withKids ? ' — adapter aux enfants' : ''}

Activités sélectionnées par l'utilisateur (à TOUTES INCLURE dans la journée) :
${selectedActivities
  .map(
    (a, i) =>
      `  ${i + 1}. ${a.title} — ${a.address || a.location || ''} (${a.duration || 'durée variable'}, ${a.price_note || a.price_eur_per_person + '€'})\n     ${a.hook || a.description || ''}`
  )
  .join('\n')}

Renvoie UNIQUEMENT le JSON d'UNE journée selon ce schéma EXACT (pas d'enveloppe, pas de tableau) :

${FULL_DAY_SCHEMA}

Contraintes :
- label = "J1", date = "${date}", weekday = "${dayWeekday}", location = "${location}".
- Les activités sélectionnées doivent apparaître dans le tableau "activities", ENRICHIES (immersive_description, schedule cohérent matin/après-midi/soir).
- Réutilise les coordonnées et adresses fournies.
- Construis morning / noon / afternoon / evening en répartissant les activités selon leur "best_time" et leur durée. Pas d'enchaînement absurde.
- meals : prévoir le déjeuner et le dîner (style adapté au lieu, budget réaliste pour le groupe).
- trips : si certaines activités sont éloignées (>10 km), liste les courts trajets entre elles.
- accommodation : si nécessaire pour finir la journée (sinon mets type "Aucun (retour à domicile)" et price_eur = 0).
- day_total_eur : somme cohérente.
- coordinates : barycentre approximatif du lieu.
- day_title : 8-14 mots, mentionne 2-3 activités phares, style magazine.
- Style sensoriel, narratif, comme pour un itinéraire complet.`;
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
        temperature: 1.0,
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

// Appel DeepSeek (API OpenAI-compatible)
async function callDeepseek(
  userPrompt: string,
  maxTokens = 8000,
  retryCount = 0
): Promise<LLMResult> {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY non configuré.');
  const res = await fetch(
    'https://api.deepseek.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        // 1.0 : compromis entre créativité (1.3 = creative writing) et
        // stabilité du JSON. Le prompt fait déjà beaucoup pour le style.
        // Trop haut → DeepSeek glisse parfois des guillemets typographiques
        // ou des sauts de ligne qui cassent la sortie JSON.
        temperature: 1.0,
        response_format: { type: 'json_object' },
      }),
    }
  );

  if ((res.status === 429 || res.status === 503) && retryCount < 4) {
    const backoff = 5 * Math.pow(2, retryCount);
    console.warn(
      `[deepseek] ${res.status} (try ${retryCount + 1}/4), waiting ${backoff}s`
    );
    await new Promise((r) => setTimeout(r, backoff * 1000));
    return callDeepseek(userPrompt, maxTokens, retryCount + 1);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DeepSeek ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Réponse DeepSeek vide.');
  return {
    text,
    usage: {
      input_tokens: data?.usage?.prompt_tokens || 0,
      output_tokens: data?.usage?.completion_tokens || 0,
      cache_read_input_tokens:
        data?.usage?.prompt_cache_hit_tokens || 0,
    },
    modelUsed: DEEPSEEK_MODEL,
  };
}

// Sélection du provider selon le backend actif
async function callProvider(
  prompt: string,
  maxTokens: number,
  claudeModel: string
): Promise<LLMResult> {
  const backend = await getActiveBackend();
  if (backend === 'gemini' && GEMINI_API_KEY) {
    try {
      return await callGemini(prompt, maxTokens);
    } catch (e) {
      console.warn('[provider] Gemini échec :', (e as Error).message);
    }
  }
  if (backend === 'deepseek' && DEEPSEEK_API_KEY) {
    try {
      return await callDeepseek(prompt, maxTokens);
    } catch (e) {
      console.warn('[provider] DeepSeek échec :', (e as Error).message);
    }
  }
  // Fallback Claude
  const r = await callClaude(prompt, maxTokens, claudeModel);
  return { ...r, modelUsed: claudeModel };
}

// Dispatcher principal (plan, régénération de jour, replan)
async function callMain(
  userPrompt: string,
  maxTokens = 16000
): Promise<LLMResult> {
  return callProvider(userPrompt, maxTokens, MODEL);
}

// Dispatcher expansion (expand-day, regenerate-activity, fetch-specialties)
async function callExpansion(
  userPrompt: string,
  maxTokens = 6000
): Promise<LLMResult> {
  return callProvider(userPrompt, maxTokens, EXPAND_MODEL);
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
    // Tentative de réparation locale via jsonrepair : gère les
    // guillemets typographiques, virgules manquantes, sauts de ligne
    // non échappés, accolades manquantes, etc. — sans appel LLM.
    try {
      const repaired = jsonrepair(candidate);
      return { ok: true, value: JSON.parse(repaired) };
    } catch {
      return { ok: false, error: (e as Error).message };
    }
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

    if (mode === 'suggest-cities') {
      const {
        destination,
        tripType,
        startDate,
        endDate,
        adults,
        childrenAges,
      } = body;
      if (!destination || !startDate || !endDate) {
        return jsonResponse(
          { error: 'destination, startDate, endDate requis' },
          400
        );
      }
      const prompt = buildSuggestCitiesPrompt(
        destination,
        tripType || 'itinerant',
        startDate,
        endDate,
        adults || 2,
        childrenAges || []
      );
      const { text, usage, modelUsed } = await callMain(prompt, 3000);
      const parsed = await parseOrRepair(text, callMainSafe);
      return jsonResponse({
        cities: parsed?.cities || [],
        usage,
        model: modelUsed,
      });
    }

    if (mode === 'suggest-places') {
      const {
        destination,
        tripType,
        startDate,
        endDate,
        adults,
        childrenAges,
        category,
      } = body;
      if (!destination || !startDate || !endDate) {
        return jsonResponse(
          { error: 'destination, startDate, endDate requis' },
          400
        );
      }
      const cat = ['incontournable', 'insolite', 'hors-sentiers'].includes(
        category
      )
        ? category
        : 'incontournable';
      const prompt = buildSuggestPlacesPrompt(
        destination,
        tripType || 'itinerant',
        startDate,
        endDate,
        adults || 2,
        childrenAges || [],
        cat
      );
      // Budget large : 15-18 lieux avec descriptions riches ~200 tokens chacun → ~3-4k tokens
      const { text, usage, modelUsed } = await callMain(prompt, 8000);
      const parsed = await parseOrRepair(text, callMainSafe);
      return jsonResponse({
        places: parsed?.places || [],
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

    if (mode === 'local-activities') {
      const {
        location,
        radius_km,
        types,
        rainy_only,
        with_kids,
        exclude,
      } = body;
      if (!location || typeof location !== 'string') {
        return jsonResponse({ error: 'Paramètre "location" requis.' }, 400);
      }
      const prompt = buildLocalActivitiesPrompt({
        location,
        radiusKm: Number(radius_km) || 30,
        types: Array.isArray(types) ? types : [],
        rainyOnly: !!rainy_only,
        withKids: !!with_kids,
        exclude: Array.isArray(exclude) ? exclude : [],
      });
      // Budget : 10 activités riches ~ 300 tokens chacune + structure ~ 5000 tokens
      const { text, usage, modelUsed } = await callMain(prompt, 6000);
      const parsed = await parseOrRepair(text, callMainSafe);
      return jsonResponse({
        activities: parsed?.activities || [],
        usage,
        model: modelUsed,
      });
    }

    if (mode === 'build-day-from-activities') {
      const {
        selected_activities,
        location,
        date,
        with_kids,
        adults,
        children_ages,
      } = body;
      if (
        !Array.isArray(selected_activities) ||
        selected_activities.length === 0 ||
        !location ||
        !date
      ) {
        return jsonResponse(
          {
            error:
              'Body invalide : selected_activities, location, date requis.',
          },
          400
        );
      }
      const prompt = buildBuildDayPrompt({
        selectedActivities: selected_activities,
        location,
        date,
        withKids: !!with_kids,
        adults: Number(adults) || 2,
        childrenAges: Array.isArray(children_ages) ? children_ages : [],
      });
      const { text, usage, modelUsed } = await callMain(prompt, 8000);
      const day = await parseOrRepair(text, callMainSafe);
      return jsonResponse({ day, usage, model: modelUsed });
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
