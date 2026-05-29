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
import {
  cityToIata,
  buildAviasalesDeeplink,
  type FlightData,
} from '../_shared/travelpayouts.ts';
import { buildGoogleFlightsDeeplink } from '../_shared/duffel.ts';
import {
  searchFlightAny,
  getActiveFlightProvider,
  isRealFlightSource,
  type AnyFlightData,
} from '../_shared/flightProvider.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const TRAVELPAYOUTS_TOKEN = Deno.env.get('TRAVELPAYOUTS_TOKEN') || '';
const TRAVELPAYOUTS_MARKER = Deno.env.get('TRAVELPAYOUTS_MARKER') || '';
const DUFFEL_API_TOKEN = Deno.env.get('DUFFEL_API_TOKEN') || '';
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
// Modèle dédié pour la vision (extraction depuis image). DeepSeek V4 Flash
// supporte le multimodal via le même endpoint api.deepseek.com depuis avril
// 2026 — bien moins cher et plus rapide que deepseek-v4-pro pour de l'OCR.
const DEEPSEEK_VISION_MODEL =
  Deno.env.get('DEEPSEEK_VISION_MODEL') || 'deepseek-v4-flash';
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

// Note : depuis la v2 du formulaire, 'roadtrip-van' couvre van ET camping-car.
// On garde 'roadtrip-camping-car' dans les sets pour les itinéraires/templates
// historiques (créés avant la fusion).
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

// Types de voyage avec horaire impératif d'arrivée/départ.
const SCHEDULED_TRIP_TYPES = new Set([
  'avion-voiture',
  'avion-citybreak',
  'train-international',
  'croisiere',
]);

// Marge avant l'heure de départ selon le type de transport.
const DEPARTURE_BUFFER: Record<string, string> = {
  'avion-intl': '~3 heures à l\'aéroport',
  'avion-domestique': '~1 h 30 à l\'aéroport',
  train: '~30-45 minutes en gare',
  ferry: '~1 heure au port',
  croisiere: '~2 heures avant embarquement',
};

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
- COÛT DES TRAJETS — RÈGLE CRITIQUE : le champ "estimated_cost_eur" des trips DOIT TOUJOURS être le coût TOTAL FAMILLE pour la jambe entière, JAMAIS un prix unitaire par personne. Exemple : 3 personnes × 600 € par personne sur un Marseille → New York aller-retour = "estimated_cost_eur": 1800 (pas 600). Pour les vols, multiplie systématiquement le prix unitaire par le nombre total de voyageurs (adultes + enfants). Le champ "cost_note" peut mentionner "≈ X €/pers" pour information, mais le chiffre principal reste le TOTAL.
- PRIX DES VOLS — fourchettes RÉALISTES par personne aller-retour en classe économique (à utiliser UNIQUEMENT en l'absence de bloc "VOL RÉEL" injecté ci-dessous) :
  * Vols intra-France (ex: MRS-CDG, NCE-LYS) : 60-180 € par personne A/R
  * Vols intra-Europe courts (<2h, ex: MRS-Berlin, Paris-Rome, Lyon-Madrid) : 100-250 € par personne A/R
  * Vols intra-Europe longs (2-4h, ex: Paris-Athènes, Madrid-Helsinki) : 150-350 € par personne A/R
  * Vols Europe → Maghreb / Turquie / Israël / Égypte : 200-450 € par personne A/R
  * Vols moyen-courrier (ex: Europe → Émirats, Inde, Asie du Sud) : 400-800 € par personne A/R
  * Vols long-courrier (ex: Europe → USA, Asie de l'Est, Amérique du Sud) : 600-1200 € par personne A/R
  * Vols très long-courrier (ex: Europe → Australie, Nouvelle-Zélande, Polynésie) : 1200-2200 € par personne A/R
  ⚠️ TOUJOURS utiliser le BAS de la fourchette par défaut (les voyageurs utilisent en majorité easyJet/Ryanair/Vueling/Transavia/Volotea en Europe, qui sont nettement moins chers que les compagnies nationales).
  ⚠️ Pour 3 personnes Marseille-Berlin A/R = ~150 €/pers × 3 = ~450 €, PAS 700 €/pers × 3 = 2100 €.
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
- roadtrip-voiture / roadtrip-van (qui couvre van ET camping-car) : véhicule PERSONNEL du voyageur, départ direct du domicile (cf. règles road trip ci-dessous). roadtrip-camping-car (ancien id, encore présent dans certains itinéraires) = équivalent à roadtrip-van.
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

HORAIRES IMPÉRATIFS D'ARRIVÉE ET DE DÉPART (vol, train longue distance, croisière, ferry) :
Quand le bloc "Horaires impératifs" apparaît dans les préférences, tu DOIS caler la première et la dernière journée en conséquence.

JOUR 1 (arrivée) :
- Si l'aéroport / gare / port d'arrivée est précisé ET diffère de la destination principale, prévois EXPLICITEMENT le transfert (taxi, train, navette, voiture de location) dans les "trips" du jour 1, avec durée et coût réalistes.
- Après l'heure d'arrivée, prévois ~1-2 heures de récupération bagages + transfert + check-in / installation avant toute activité.
- Pour un vol >5 fuseaux horaires : J1 = arrivée + check-in + repas tranquille + balade légère uniquement. PAS d'excursion lourde, PAS de musée fermant tôt. Mentionne le décalage horaire dans la description du jour.
- Pour un vol court (Europe, ≤3 fuseaux) ou un train : possible de prévoir une activité légère l'après-midi/soir si l'heure d'arrivée le permet.
- Si l'heure d'arrivée est avant 10h : journée presque complète possible (après installation).
- Si l'heure d'arrivée est après 18h : uniquement check-in + dîner sur place.

DERNIER JOUR (départ) :
- Marge OBLIGATOIRE avant l'heure de départ, selon le type de transport :
  * Vol international : 3 heures avant départ à l'aéroport (donc activités terminées 3h30 avant le décollage, en comptant le transfert)
  * Vol domestique : 1 h 30 avant à l'aéroport
  * Train (TGV, Eurostar, ICE) : 30-45 minutes en gare
  * Ferry : 1 heure au port
  * Croisière : 2 heures avant embarquement
- Ajoute le TRANSFERT vers le point de départ (aéroport / gare / port) dans les trips du dernier jour, avec durée réaliste.
- Si l'heure de départ est tôt (avant 10h) : dernière journée = check-out + transfert uniquement, programme la veille au soir pour profiter.
- Si l'heure de départ est en fin de journée (après 18h) : journée complète possible, mais terminer toutes les activités avec la marge précisée.

Le champ "headline" du summary peut mentionner les horaires si pertinent. Les jours concernés (J1 et dernier jour) doivent avoir une description qui rend visible cette contrainte horaire ("Arrivée vers 14h, le temps de poser les bagages..." / "Dernier matin à Kyoto avant le transfert vers Kansai pour le vol de 19h35.").

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

  // === Horaires impératifs (vol, train intl, croisière, ferry) ===
  // Bloc injecté UNIQUEMENT si l'utilisateur a renseigné au moins une heure
  // ou un point d'entrée. L'IA cale alors J1 (installation) et J_final
  // (marge avant départ) selon le type de transport.
  const scheduleAuto =
    SCHEDULED_TRIP_TYPES.has(p.tripType) || Boolean(p.hasFixedSchedule);
  const hasAnyScheduleField =
    Boolean(p.arrivalTime) ||
    Boolean(p.departureTime) ||
    Boolean(p.arrivalGateway) ||
    Boolean(p.departureGateway) ||
    Boolean(p.scheduledTransport);
  let scheduleBlock = '';
  if (scheduleAuto && hasAnyScheduleField) {
    const transport = p.scheduledTransport || inferTransport(p.tripType);
    const buffer = DEPARTURE_BUFFER[transport] || 'marge adaptée au type de transport';
    const arrivalGw = p.arrivalGateway || '(non précisé — supposer la ville de destination)';
    const departureGw =
      p.departureGateway || p.arrivalGateway || '(identique au point d\'arrivée)';
    const arrivalT = p.arrivalTime || '(non précisée)';
    const departureT = p.departureTime || '(non précisée)';

    // === Si vol confirmé via capture : bloc enrichi avec compagnies/n° vols
    // et CONTRAINTE FORTE de finir le voyage dans la ville de départ retour
    // (cas typique itinérant multi-villes où l'IA pouvait finir ailleurs).
    let confirmedFlightBlock = '';
    const cf: any = p.confirmedFlight || null;
    if (cf?.outbound?.origin_iata) {
      const out = cf.outbound;
      const ret = cf.return || null;
      const outAirline = [out.airline_code, out.flight_number].filter(Boolean).join(' ');
      const lines = [
        `\n\n⚡ VOLS CONFIRMÉS (l'utilisateur a déjà sélectionné ces vols sur Skyscanner/Google Flights — données extraites de sa capture) :`,
        `  ✈️ ALLER  : ${outAirline || 'Vol'} · ${out.origin_iata} → ${out.destination_iata}`,
        `             Départ ${(out.departure_at || '').replace('T', ' ')} → Arrivée ${(out.arrival_at || '').replace('T', ' ')}`,
        `             ${out.stops === 0 ? 'Direct' : `${out.stops || 1} escale(s)`}`,
      ];
      if (ret) {
        const retAirline = [ret.airline_code, ret.flight_number].filter(Boolean).join(' ');
        lines.push(
          `  ✈️ RETOUR : ${retAirline || 'Vol'} · ${ret.origin_iata} → ${ret.destination_iata}`,
          `             Départ ${(ret.departure_at || '').replace('T', ' ')} → Arrivée ${(ret.arrival_at || '').replace('T', ' ')}`,
          `             ${ret.stops === 0 ? 'Direct' : `${ret.stops || 1} escale(s)`}`
        );
      }
      lines.push(
        ``,
        `🚨 CONTRAINTE ABSOLUE (vol retour réservé) :`,
        `   Le voyageur DOIT physiquement être à ${departureGw} pour prendre son vol retour à ${departureT}.`,
        `   ⇒ Le DERNIER JOUR du voyage doit obligatoirement se passer à ${departureGw} (ville exclusivement, pas une autre ville à proximité avec "transfert le matin").`,
        `   ⇒ Si le voyage est itinérant et passe par d'autres villes, le retour à ${departureGw} doit être effectué AU PLUS TARD l'avant-dernier jour, en début de soirée. Programme la dernière nuit DANS ${departureGw} et prévois explicitement le trajet de retour vers ${departureGw} dans l'avant-dernier jour.`,
        `   ⇒ Tu NE PEUX PAS planifier un long trajet (vol interne, train de 6h, route de 800 km) le jour du vol retour. Ce serait irréaliste et risqué pour rater le vol.`,
        `   ⇒ Le jour du vol retour : check-out + matinée légère (café, derniers achats, balade <2h) + transfert aéroport avec ${buffer} d'avance. Aucune excursion lointaine.`
      );
      confirmedFlightBlock = lines.join('\n');
    }

    // Détecte le mode "open-jaw" (arrivée et départ par villes différentes)
    // pour adapter la structure de l'itinéraire : linéaire vs boucle.
    const normGw = (s: string) => String(s || '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '');
    const isOpenJaw =
      Boolean(p.arrivalGateway) &&
      Boolean(p.departureGateway) &&
      normGw(p.arrivalGateway) !== normGw(p.departureGateway);
    const tripStructureBlock = isOpenJaw
      ? `\n\n📍 STRUCTURE DU VOYAGE : OPEN-JAW (arrivée et départ par villes différentes) :
   - Arrivée à ${arrivalGw}, départ depuis ${departureGw}
   - L'itinéraire est LINÉAIRE — pas besoin de revenir au point d'arrivée
   - Construis une route logique de ${arrivalGw} vers ${departureGw}, en passant par les étapes intermédiaires qui ont du sens géographiquement
   - Dernière nuit obligatoirement à ${departureGw}`
      : `\n\n📍 STRUCTURE DU VOYAGE : BOUCLE (arrivée et départ par la même ville ${arrivalGw}) :
   - L'itinéraire est circulaire : tu pars de ${arrivalGw}, tu y reviens pour le vol retour
   - Dernière nuit obligatoirement à ${arrivalGw}
   - Si voyage itinérant : prévois le retour à ${arrivalGw} au plus tard l'avant-dernier jour`;

    scheduleBlock = `
Horaires impératifs (contrainte FORTE — utilise ces valeurs pour caler J1 et le dernier jour) :
  - Type de transport : ${transport || '(non précisé)'}
  - Point d'arrivée (aéroport / gare / port) : ${arrivalGw}
  - Heure d'arrivée à destination (J1) : ${arrivalT}
  - Point de départ retour : ${departureGw}
  - Heure de départ du transport (dernier jour) : ${departureT}
  - Marge OBLIGATOIRE avant le départ : ${buffer}
  ⇒ Sur J1 : prévois récupération bagages + transfert depuis ${arrivalGw} (s'il diffère de la destination) + check-in / installation (1-2 h) avant toute activité. Si arrivée après 18h : check-in + dîner uniquement. Si vol >5 fuseaux : J1 reste très léger (décalage horaire).
  ⇒ Sur le dernier jour : termine toutes les activités avec la marge ci-dessus + transfert vers ${departureGw}. Si heure de départ tôt (avant 10h) : check-out + transfert uniquement. Programme les visites importantes la veille au soir.${tripStructureBlock}${confirmedFlightBlock}`;
  } else if (
    p.tripType === 'avion-voiture' ||
    p.tripType === 'avion-citybreak' ||
    p.tripType === 'avion-itinerant'
  ) {
    // Voyage avion-* SANS horaires précis saisis : il faut éviter d'inventer
    // une heure d'arrivée précoce et de bâtir la journée dessus (cas typique
    // hallucination "atterrissage à 7h"). On force un programme léger et
    // robuste pour J1 et le dernier jour, valable quelle que soit l'heure
    // réelle du vol.
    scheduleBlock = `
HORAIRES DE VOL NON CONFIRMÉS — règle CRITIQUE pour J1 et le dernier jour :
L'utilisateur n'a PAS encore réservé son vol ou n'a pas saisi l'heure exacte d'arrivée/de départ. Tu NE DOIS PAS inventer une heure précise d'atterrissage/décollage (ex : "atterrissage à 7h"), car si la vraie heure est différente, toute la journée devient incohérente.

À FAIRE pour J1 :
- Description : "Arrivée à ${p.destinations} (horaire à confirmer dès réservation du vol) + transfert vers le centre + installation à l'hôtel + balade découverte légère + dîner local."
- AUCUNE activité payante, AUCUNE excursion guidée, AUCUN musée fermant tôt.
- Le programme doit rester valable quelle que soit l'heure d'arrivée réelle (matin, midi, fin d'après-midi, soir).
- moments matin/midi/après-midi/soir : laisse les premiers vides ou très flexibles selon la durée du vol typique (long-courrier transatlantique = arrivée souvent en fin d'après-midi/soirée ; vol moyen-courrier = arrivée variable).
- Mentionne EXPLICITEMENT dans la description du jour : "Programme volontairement léger — à enrichir une fois les horaires de vol confirmés".

À FAIRE pour le dernier jour (retour) :
- Description : "Dernière matinée libre à ${p.destinations} (selon l'heure du vol retour) + check-out + transfert vers l'aéroport."
- Privilégie le shopping souvenirs, un café/brunch détente, une balade — rien de planifié qui doit absolument être fait à une heure précise.
- AUCUNE excursion lointaine, AUCUNE activité longue.
- Mentionne : "Programme à ajuster selon l'heure réelle du vol retour".

Les jours du MILIEU (J2 à J_avant-dernier) gardent leur programme habituel, RICHE et DÉTAILLÉ.`;
  }

  // Bloc PERMIS DE CONDUIRE — n'apparaît que si l'utilisateur a explicitement
  // dit qu'il n'a pas le permis (true par défaut, donc rien à dire si le
  // groupe peut conduire).
  const carRentalPossibleTypes = new Set([
    'itinerant',
    'roadtrip-voiture',
    'roadtrip-van',
    'roadtrip-camping-car',
    'avion-voiture',
    'avion-itinerant',
  ]);
  let licenseBlock = '';
  if (p.hasDrivingLicense === false && carRentalPossibleTypes.has(p.tripType)) {
    licenseBlock = `

PERMIS DE CONDUIRE — RÈGLE STRICTE :
L'utilisateur a précisé qu'il N'A PAS le permis de conduire. Cela signifie :
  ❌ NE PROPOSE JAMAIS de location de voiture, de scooter ou de van.
  ❌ NE PROPOSE PAS de trips de mode "Voiture", "Voiture de location", "Scooter", "Van" ou "Camping-car".
  ❌ Aucun coût "fuel_cost_eur" ou "toll_cost_eur" (puisqu'aucun véhicule en autonomie).
  ✅ Utilise UNIQUEMENT : transports en commun (bus, métro, train régional), taxi / VTC, train longue distance, ferry, vélo, marche, excursions organisées avec chauffeur, transferts privés.
  ✅ Les "trips" entre villes doivent être en TRAIN, BUS ou TAXI (ou avion pour les longues distances).
  ✅ Si la destination est mal desservie en TC, privilégie les excursions guidées organisées (avec chauffeur fourni).
  ✅ Le budget transport peut être ajusté à la hausse (taxis, transferts privés sont plus chers qu'une location).`;
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
Type de voyage : ${p.tripType}${vehicleBlock}${scheduleBlock}${licenseBlock}
Centres d'intérêt : ${
    Array.isArray(p.interests) && p.interests.length > 0
      ? p.interests.join(', ')
      : "AUCUN précisé → le voyageur est OUVERT À TOUT. Propose un mélange équilibré et varié (culture, nature, gastronomie, détente, activités locales emblématiques) adapté à la destination, sans surreprésenter un seul thème."
  }${specificActivities}
Niveau de budget : ${p.budget}${practicalBlock}${offBlock}${constraintsBlock}${visitedBlock}${wishlistBlock}
Étapes IMPÉRATIVES : ${p.mustInclude || '(aucune)'}
À éviter : ${p.toAvoid || '(aucun)'}`;
}

// Déduit le type de transport (avion-intl / train / croisiere) depuis le
// tripType quand l'utilisateur n'a pas explicitement sélectionné dans le
// formulaire. Utilisé uniquement pour calibrer la marge de départ.
function inferTransport(tripType: string): string {
  if (
    tripType === 'avion-voiture' ||
    tripType === 'avion-citybreak' ||
    tripType === 'avion-itinerant'
  ) {
    return 'avion-intl';
  }
  if (tripType === 'train-international') return 'train';
  if (tripType === 'croisiere') return 'croisiere';
  return '';
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
    "area": string, "services": string[], "note": string, "coordinates_hint": string
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
- accommodation.area = QUARTIER + VILLE conseillé(e) pour dormir cette nuit-là,
  choisi pour être PROCHE des excursions et activités du jour. FORMAT IMPOSÉ :
  "Quartier, Ville" avec des noms RÉELS que Booking.com sait géolocaliser
  (ex : "Ribeira, Porto", "Gràcia, Barcelone", "Stare Miasto, Cracovie").
  ⚠️ Ce texte est envoyé tel quel à la recherche Booking, donc :
  • TOUJOURS inclure la vraie ville où l'on dort (qui peut DIFFÉRER du lieu
    principal de la journée : ex. journée à "Vallée du Douro" mais nuit à Porto
    → area = "Ribeira, Porto").
  • JAMAIS de "/", ni de mots vagues seuls ("centre historique", "centre-ville",
    "près de la gare") : ils renvoient vers la mauvaise ville.
  • Pas de coordonnées GPS dans ce champ.
  accommodation.name peut rester générique (ex : "Hôtel 3-4★ confortable") car
  on n'affiche pas de nom inventé : on guide vers Booking sur la bonne zone.
- accommodation.coordinates_hint = même zone au format "Quartier, Ville"
  (ex : "Ribeira, Porto"), JAMAIS de simples coordonnées GPS.
- day_total_eur = trips + accommodation + activities + meals + service_stops du jour.
- grand_total_eur = somme des day_total_eur.
- per_person_eur = grand_total / (adults + enfants).
- Si is_round_trip, dernier jour à departure_location ; sinon à return_location.
- VOLS — RÈGLE CRITIQUE même si le tripType n'est pas explicitement "avion-*" :
  si le lieu de DÉPART et la DESTINATION sont géographiquement éloignés (pays
  différent, continent différent, ou >1500 km de distance terrestre), alors
  l'utilisateur a forcément pris un AVION pour rejoindre la destination
  (et un autre pour revenir). Dans ce cas :
  * Tu DOIS créer dans days[0].trips un trip de mode "Avion" représentant le vol aller
    (from = lieu de départ, to = ville d'arrivée/destination principale).
  * Si is_round_trip, tu DOIS créer le même genre de trip en mode "Avion" sur le DERNIER jour.
  * Ne te contente PAS d'écrire "Arrivée à [ville]" dans morning sans créer le trip Avion.
  * Si tu n'as pas de prix/horaire fiable, mets "estimated_cost_eur": null + cost_note: "À confirmer après réservation".
  → TravelO appellera ensuite son fournisseur (Duffel) pour remplacer le prix.
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

  // Si la journée contient un trip "Avion" avec des horaires déjà figés
  // (par notre fournisseur ou corrigés manuellement par l'utilisateur), on
  // les injecte comme contraintes IMPÉRATIVES + on rappelle les règles
  // strictes de marge (2 h après atterrissage, 1 h 30 avant activités,
  // J1 light si trop tard).
  const flightTrip = (day.trips || []).find((t: any) =>
    /avion|vol|flight|plane/i.test(t?.mode || '')
  );
  let flightConstraintsBlock = '';
  if (flightTrip?._flight) {
    const f = flightTrip._flight;
    const depTime = f.departure_at ? String(f.departure_at).substring(11, 16) : null;
    const arrTime = f.arrival_at ? String(f.arrival_at).substring(11, 16) : null;
    const isFirstDay = dayIndex === 0;
    const isLastDay = dayIndex === (itinerary.days?.length || 0) - 1;
    const role = isFirstDay
      ? 'jour d\'ARRIVÉE'
      : isLastDay
        ? 'jour de DÉPART'
        : 'jour avec un VOL INTERNE';

    flightConstraintsBlock = `

CONTRAINTES VOL — ${role} (à respecter SANS exception) :
  - Trajet : ${flightTrip.from} → ${flightTrip.to}${f.airline ? ` (${f.airline}${f.flight_number || ''})` : ''}
  - Heure de DÉPART (heure locale de l'aéroport de départ) : ${depTime || '(non précisée)'}
  - Heure d'ARRIVÉE (heure locale de l'aéroport d'arrivée) : ${arrTime || '(non précisée)'}
  - Prix : ${flightTrip.estimated_cost_eur || 0} € (total famille) — NE PAS MODIFIER

  → Tu DOIS conserver ce trip "Avion" tel quel dans la sortie, AVEC EXACTEMENT ces horaires et ce prix.
  → Tu DOIS organiser le reste de la journée autour de ces contraintes :
    ${isFirstDay && arrTime ? `* Atterrissage à ${arrTime}. Installation hôtel possible à partir de ${addHours(arrTime, 2)} (= arrivée + 2 h pour bagages/transfert/check-in).
    * 1ʳᵉ activité programmée possible à partir de ${addHours(arrTime, 3.5)} minimum (= installation + 1 h 30 pour repos/douche).
    * Si ${addHours(arrTime, 3.5)} tombe après 19 h, ou s'il reste moins de 2 h avant 22 h → JOURNÉE LIGHT : SEULEMENT vol + transfert + installation + dîner à proximité de l'hôtel. AUCUNE excursion, AUCUNE visite.` : ''}
    ${isLastDay && depTime ? `* Départ vol à ${depTime}. Arrivée à l'aéroport requise au plus tard à ${addHours(depTime, -2)} (= départ - 2 h).
    * Toute activité doit se TERMINER au plus tard 30 min avant cette heure pour permettre check-out hôtel + transfert vers aéroport.
    * Si peu de temps disponible : JOURNÉE LIGHT — uniquement petit-déj, check-out, transfert aéroport.` : ''}
    ${!isFirstDay && !isLastDay ? '* Vol interne : prévoir 1 h 30 avant le vol pour rejoindre l\'aéroport. Activités cohérentes autour du décollage et de l\'atterrissage.' : ''}`;
  }

  return `Régénère UNE SEULE journée d'un itinéraire existant en tenant compte d'une consigne utilisateur.

Contexte itinéraire :
${JSON.stringify(itinerary.summary, null, 2)}

Journée à régénérer : ${day.label} (${day.date} — ${day.weekday})
Jour précédent : ${prev ? `${prev.location}, hébergement ${prev.accommodation?.name}` : '(premier jour)'}
Jour suivant : ${next ? next.location : '(dernier jour)'}

Journée actuelle :
${JSON.stringify(day, null, 2)}
${flightConstraintsBlock}

CONSIGNE UTILISATEUR :
"""
${instructions}
"""

Renvoie UNIQUEMENT le JSON de la nouvelle journée selon le même schéma. Garde label, date et weekday. Recalcule day_total_eur. Cohérence avec le départ du jour suivant.${flightConstraintsBlock ? ' RESPECTE IMPÉRATIVEMENT LES CONTRAINTES VOL CI-DESSUS.' : ''}`;
}

/**
 * Ajoute h heures (ou heures décimales : 1.5 = 1h30) à une heure "HH:MM"
 * et renvoie le résultat au format "HH:MM" (sans dépasser 24h / sans
 * gérer le débordement de jour — suffisant pour le prompt LLM).
 */
function addHours(hhmm: string, hours: number): string {
  const [hStr, mStr] = hhmm.split(':');
  const total = (Number(hStr) || 0) * 60 + (Number(mStr) || 0) + hours * 60;
  let mins = Math.round(total);
  while (mins < 0) mins += 24 * 60;
  while (mins >= 24 * 60) mins -= 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

  // Moments actuels (titres + descriptions) — pour que l'IA puisse les
  // mettre à jour si la nouvelle activité change la cohérence narrative.
  const momentsSnapshot = {
    morning: day.morning || null,
    noon: day.noon || null,
    afternoon: day.afternoon || null,
    evening: day.evening || null,
  };

  return `Tu vas REMPLACER une seule activité d'un itinéraire existant, en tenant compte d'une consigne utilisateur. Tu vas AUSSI mettre à jour les moments du jour qui mentionnaient l'ancienne activité pour qu'ils correspondent à la nouvelle.

Contexte du voyage :
${JSON.stringify(itinerary.summary, null, 2)}

Journée concernée : ${day.label} — ${day.location} (${day.date})
Météo du jour : ${day.weather?.temperature_c || '?'}°C ${day.weather?.emoji || ''}

Activité actuelle à remplacer :
${JSON.stringify(activity, null, 2)}

Moments actuels de la journée (matin / midi / après-midi / soir) :
${JSON.stringify(momentsSnapshot, null, 2)}

Autres activités du jour (à éviter de dupliquer) :
${(day.activities || [])
  .filter((_: any, i: number) => i !== activityIndex)
  .map((a: any) => `  - ${a.title}`)
  .join('\n') || '  (aucune)'}

CONSIGNE UTILISATEUR :
"""
${instructions}
"""

Renvoie UNIQUEMENT du JSON valide (rien autour) selon ce schéma :

{
  "activity": {
    "title": string,
    "schedule": string,
    "duration": string,
    "description": string,
    "immersive_description": string,
    "price_per_person_eur": number,
    "family_total_eur": number
  },
  "moments_update": {
    "morning":   { "title": string, "description": string } | null,
    "noon":      { "title": string, "description": string } | null,
    "afternoon": { "title": string, "description": string } | null,
    "evening":   { "title": string, "description": string } | null
  }
}

INSTRUCTIONS pour "moments_update" — TRÈS IMPORTANT :
- Pour CHAQUE moment (matin/midi/après-midi/soir) qui mentionne explicitement l'ancienne activité ("${activity.title}") dans son titre ou sa description, fournis une VERSION MISE À JOUR qui mentionne désormais la NOUVELLE activité et reste cohérente avec le reste de la journée.
- Pour les moments NON impactés (qui ne parlaient pas de l'ancienne activité), mets null — on conservera l'ancienne version intacte.
- Le moment qui correspond au CRÉNEAU HORAIRE de la nouvelle activité (selon "schedule") DOIT obligatoirement être mis à jour pour cohérence.
- Style des moments : titre concis (8-15 mots), description immersive (3-5 phrases) — même registre que dans la journée d'origine.

Contraintes activité :
- Cohérence avec le lieu du jour (${day.location}) et la saison.
- Pas de doublon avec les autres activités du jour.
- Prix réalistes en euros.`;
}

// ============================================================
// MODE "local-activities" : découverte d'activités autour d'un point.
// Architecture : Google Places (source de vérité, lieux RÉELS) + LLM
// pour enrichir (hook, description). Le LLM ne peut JAMAIS inventer
// de lieu — il reçoit une liste fermée et l'enrichit.
// ============================================================

// Mapping type → requêtes Google Places (en français).
// Plusieurs queries par type pour bien couvrir le spectre.
const PLACES_QUERIES_BY_TYPE: Record<string, string[]> = {
  insolite: ['lieu insolite', 'curiosité touristique', 'attraction originale'],
  culture: ['musée', 'monument historique', 'château'],
  nature: ['parc nature', 'forêt promenade', 'jardin botanique', 'réserve naturelle'],
  baignade: ['plage', 'lac baignade', 'cascade baignade', 'rivière baignade', 'piscine naturelle'],
  sport: ['kayak location', 'escalade salle', 'centre sportif', 'location vélo'],
  aventure: ['accrobranche', 'parapente', 'escape game', 'karting', 'paintball'],
  panorama: ['belvédère', 'point de vue', 'panorama'],
  gastronomie: ['restaurant gastronomique', 'marché local', 'cave dégustation', 'cours de cuisine'],
  famille: ['parc attractions', 'mini-golf', 'aire de jeux', 'ferme pédagogique'],
  animalier: ['zoo', 'aquarium', 'parc animalier', 'ferme pédagogique'],
  festival: ['festival', 'événement culturel', 'concert'],
  'bien-etre': ['spa', 'thermes', 'centre bien-être', 'sauna'],
  spirituel: ['abbaye', 'monastère', 'sanctuaire', 'lieu de pèlerinage'],
  'vie-nocturne': ['bar à cocktails', 'boîte de nuit', 'pub'],
  shopping: ['marché artisan', 'boutique créateur', 'galerie commerciale'],
  romantique: ['restaurant romantique', 'spot coucher de soleil', 'hôtel charme'],
};

// Distance haversine en km entre deux coordonnées
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Géocodage : "Ventabren" → { lat, lng }. Essaie d'abord Google Places
// avec plusieurs variantes du texte, puis Nominatim (OSM, gratuit) en
// fallback si Google échoue. Garantit qu'on trouve presque toujours.
async function geocodePlace(
  query: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const original = query.trim();
  if (!original) return null;

  // Génère un panel de variantes à essayer, de la plus fidèle à la plus permissive
  const variants: string[] = [original];

  // Nettoyage parenthèses : "Ventabren (13122)" → "Ventabren"
  const noParens = original
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (noParens && noParens !== original) variants.push(noParens);

  // Détection code postal français → on essaie aussi "VILLE CP France"
  // ET le nom de ville SEUL (sans CP)
  const postalMatch = original.match(/\b(\d{5})\b/);
  const wordsOnly = original
    .replace(/\b\d{5}\b/g, '')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (wordsOnly && wordsOnly !== noParens) variants.push(wordsOnly);
  if (postalMatch && wordsOnly) {
    variants.push(`${wordsOnly} ${postalMatch[1]} France`);
    variants.push(`${wordsOnly}, France`);
  }
  if (!/france/i.test(noParens) && noParens) {
    variants.push(`${noParens}, France`);
  }

  // === Tentative 1 : Google Places (si clé disponible) ===
  if (GOOGLE_PLACES_API_KEY) {
    const tried = new Set<string>();
    for (const variant of variants) {
      if (!variant || tried.has(variant)) continue;
      tried.add(variant);
      try {
        const res = await fetch(
          'https://places.googleapis.com/v1/places:searchText',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
              'X-Goog-FieldMask': 'places.location,places.formattedAddress',
            },
            body: JSON.stringify({
              textQuery: variant,
              languageCode: 'fr',
              maxResultCount: 1,
            }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          console.warn(`[geocode google] "${variant}" → ${res.status} ${txt.slice(0, 200)}`);
          continue;
        }
        const data = await res.json();
        const p = data?.places?.[0];
        if (p?.location) {
          return {
            lat: p.location.latitude,
            lng: p.location.longitude,
            formattedAddress: p.formattedAddress || variant,
          };
        }
      } catch (e) {
        console.warn(`[geocode google] "${variant}" crash`, e);
      }
    }
  }

  // === Tentative 2 : Nominatim (OSM, gratuit, sans clé) ===
  // Limite : 1 req/s. On essaie séquentiellement les 2-3 variantes les plus
  // probables seulement pour rester sous la limite.
  const nominatimVariants = Array.from(new Set([noParens || original, wordsOnly].filter(Boolean))).slice(0, 2);
  for (const variant of nominatimVariants) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        variant
      )}&format=json&limit=1&accept-language=fr&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TravelO/1.0 (travelo.app)' },
      });
      if (!res.ok) {
        console.warn(`[geocode nominatim] "${variant}" → ${res.status}`);
        continue;
      }
      const data = await res.json();
      const first = Array.isArray(data) ? data[0] : null;
      if (first?.lat && first?.lon) {
        return {
          lat: parseFloat(first.lat),
          lng: parseFloat(first.lon),
          formattedAddress: first.display_name || variant,
        };
      }
    } catch (e) {
      console.warn(`[geocode nominatim] "${variant}" crash`, e);
    }
  }

  return null;
}

// Cherche des lieux RÉELS via Google Places dans un rayon donné.
// Renvoie un tableau dédupliqué, filtré par distance, trié par popularité.
async function searchRealPlaces(args: {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  types: string[];
  excludeIds: string[];
  withKids: boolean;
}): Promise<any[]> {
  const { centerLat, centerLng, radiusKm, types, excludeIds } = args;

  // Choisit les queries selon les types demandés
  let queries: string[] = [];
  if (types.length === 0) {
    queries = ['attraction touristique', 'lieu à visiter', 'point d\'intérêt'];
  } else {
    for (const t of types) {
      const qs = PLACES_QUERIES_BY_TYPE[t];
      if (qs) queries.push(...qs);
    }
  }
  queries = Array.from(new Set(queries)).slice(0, 8);

  // === Tentative 1 : Google Places ===
  // FieldMask volontairement réduit aux SKUs Basic+Advanced (pas
  // editorialSummary/goodForChildren qui sont Preferred SKU et causent
  // un 403 si non activé dans le projet Google Cloud).
  let merged: any[] = [];
  if (GOOGLE_PLACES_API_KEY) {
    const radiusMeters = Math.min(radiusKm * 1000, 50000);
    const allResults = await Promise.all(
      queries.map(async (q) => {
        try {
          const res = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                'X-Goog-FieldMask':
                  'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri',
              },
              body: JSON.stringify({
                textQuery: q,
                languageCode: 'fr',
                maxResultCount: 10,
                locationBias: {
                  circle: {
                    center: { latitude: centerLat, longitude: centerLng },
                    radius: radiusMeters,
                  },
                },
              }),
            }
          );
          if (!res.ok) {
            const txt = await res.text();
            console.warn(`[places google] "${q}" ${res.status} ${txt.slice(0, 200)}`);
            return [];
          }
          const data = await res.json();
          return data?.places || [];
        } catch (e) {
          console.warn(`[places google] "${q}" crash`, e);
          return [];
        }
      })
    );

    const seen = new Set<string>(excludeIds);
    for (const arr of allResults) {
      for (const p of arr) {
        if (!p.id || seen.has(p.id)) continue;
        const lat = p.location?.latitude;
        const lng = p.location?.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        const distance = haversineKm(centerLat, centerLng, lat, lng);
        if (distance > radiusKm) continue;
        seen.add(p.id);
        merged.push({ ...p, _distance_km: Math.round(distance) });
      }
    }
    console.log(`[places] Google a renvoyé ${merged.length} lieux uniques`);
  }

  // === Tentative 2 : Nominatim/OSM fallback si Google n'a rien ===
  // Couverture excellente pour la nature/baignade en France.
  if (merged.length === 0) {
    console.log('[places] fallback Nominatim');
    merged = await searchPlacesNominatim({
      centerLat,
      centerLng,
      radiusKm,
      queries: queries.slice(0, 4), // serial → on limite pour rester rapide
      excludeIds,
    });
    console.log(`[places] Nominatim a renvoyé ${merged.length} lieux`);
  }

  // Tri : Google → score popularité ; Nominatim → importance OSM
  merged.sort((a, b) => {
    const sA = a.rating
      ? (a.rating || 3) * Math.log10((a.userRatingCount || 1) + 1)
      : (a._importance || 0) * 10;
    const sB = b.rating
      ? (b.rating || 3) * Math.log10((b.userRatingCount || 1) + 1)
      : (b._importance || 0) * 10;
    return sB - sA;
  });

  return merged.slice(0, 10);
}

// Fallback Nominatim : cherche des lieux RÉELS via OpenStreetMap.
// Rate-limited (1 req/s), donc on sérialise et on limite à 4 queries.
async function searchPlacesNominatim(args: {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  queries: string[];
  excludeIds: string[];
}): Promise<any[]> {
  const { centerLat, centerLng, radiusKm, queries, excludeIds } = args;

  // Bounding box approximative pour viewbox Nominatim
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180));
  const viewbox = `${centerLng - dLng},${centerLat + dLat},${centerLng + dLng},${centerLat - dLat}`;

  const seen = new Set<string>(excludeIds);
  const merged: any[] = [];

  for (const q of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        q
      )}&format=json&limit=10&accept-language=fr&addressdetails=1&bounded=1&viewbox=${viewbox}&extratags=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TravelO/1.0 (travelo.app)' },
      });
      if (!res.ok) {
        console.warn(`[nominatim] "${q}" → ${res.status}`);
        continue;
      }
      const data = await res.json();
      for (const r of Array.isArray(data) ? data : []) {
        const osmKey = r.osm_id ? `osm-${r.osm_type}-${r.osm_id}` : null;
        if (!osmKey || seen.has(osmKey)) continue;
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        if (isNaN(lat) || isNaN(lng)) continue;
        const distance = haversineKm(centerLat, centerLng, lat, lng);
        if (distance > radiusKm) continue;
        seen.add(osmKey);
        const niceName =
          r.name || (r.display_name || '').split(',')[0] || 'Lieu sans nom';
        const osmUrl = `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`;
        merged.push({
          id: osmKey,
          displayName: { text: niceName },
          formattedAddress: r.display_name || '',
          location: { latitude: lat, longitude: lng },
          types: [r.class, r.type].filter(Boolean),
          primaryType: r.type || r.class || 'point_of_interest',
          rating: null,
          userRatingCount: null,
          websiteUri: r.extratags?.website || r.extratags?.url || null,
          googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(niceName)}&center=${lat},${lng}`,
          _distance_km: Math.round(distance),
          _importance: parseFloat(r.importance) || 0,
          _osm_url: osmUrl,
        });
      }
    } catch (e) {
      console.warn(`[nominatim] "${q}" crash`, e);
    }
    // Respect du rate-limit Nominatim (1 req/s)
    await new Promise((r) => setTimeout(r, 1100));
  }

  return merged;
}

// Prompt d'enrichissement : le LLM reçoit une liste fermée et écrit hook
// + description pour chaque lieu. Interdit d'en ajouter ou en retirer.
function buildEnrichRealActivitiesPrompt(args: {
  places: any[];
  location: string;
  rainyOnly: boolean;
  withKids: boolean;
}): string {
  const { places, location, rainyOnly, withKids } = args;

  const filters = [
    rainyOnly && 'priorité aux lieux INDOOR (pluie)',
    withKids && 'priorité aux lieux adaptés ENFANTS',
  ]
    .filter(Boolean)
    .join(' ; ');

  const placesList = places
    .map((p, i) => {
      const summary = p.editorialSummary?.text || '';
      const cats = (p.types || []).slice(0, 3).join(', ');
      const rating = p.rating
        ? `Note Google : ${p.rating}/5 (${p.userRatingCount || 0} avis)`
        : 'Pas encore noté sur Google';
      return `LIEU ${i} :
  Nom : ${p.displayName?.text || 'Sans nom'}
  Adresse : ${p.formattedAddress || '?'}
  Catégories Google : ${cats || p.primaryType || '?'}
  Distance : ${p._distance_km} km
  ${rating}
  ${summary ? `Description officielle Google : ${summary}` : ''}`;
    })
    .join('\n\n');

  return `Tu reçois une liste de ${places.length} lieux RÉELS et VÉRIFIÉS situés autour de "${location}". Ces lieux EXISTENT — leurs noms et adresses viennent de Google Maps.

⚠️ INTERDICTION ABSOLUE :
- Tu ne PEUX PAS inventer de lieu.
- Tu ne PEUX PAS retirer un lieu.
- Tu ne PEUX PAS changer un nom.
- Tu dois produire EXACTEMENT ${places.length} entrées, dans le MÊME ORDRE, avec "index" qui correspond à l'index du lieu (0 à ${places.length - 1}).

Filtres demandés : ${filters || 'aucun filtre particulier'}

LIEUX À ENRICHIR :
${placesList}

POUR CHAQUE LIEU, produis :
- "index" : index du lieu dans la liste reçue (0, 1, 2…)
- "type" : choisis dans cette liste celui qui correspond le mieux à la catégorie Google :
  insolite | culture | nature | baignade | sport | aventure | panorama | gastronomie | famille | animalier | festival | bien-etre | spirituel | vie-nocturne | shopping | romantique
- "hook" : 1 phrase courte (10-15 mots), donne envie au premier regard. Concret, sensoriel.
- "description" : 2-3 phrases (40-70 mots). Si tu CONNAIS spécifiquement ce lieu, sois sensoriel et précis. Si tu ne le connais pas, reste GÉNÉRIQUE mais juste (ex: "Lieu très apprécié de la région, idéal pour une pause." ou "Restaurant bien noté, réputé pour sa cuisine locale.") — JAMAIS de détail inventé.
- "indoor" : true si majoritairement intérieur (musée, restaurant, spa, grotte), false sinon
- "best_time" : "matin" | "après-midi" | "soir" | "toute la journée"
- "duration" : "30 min" | "1h" | "2h" | "Demi-journée" | "Journée"
- "price_note" : déduis du type ("gratuit", "5-15 €", "20-40 €", "40-80 €"…)

Schéma JSON STRICT (uniquement ce JSON, pas de markdown, pas de texte autour) :
{
  "activities": [
    {
      "index": number,
      "type": string,
      "hook": string,
      "description": string,
      "indoor": boolean,
      "best_time": string,
      "duration": string,
      "price_note": string
    }
  ]
}

RAPPEL CRITIQUE : ${places.length} entrées EXACTEMENT, dans l'ordre, index 0 à ${places.length - 1}.`;
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

/**
 * Appel DeepSeek V4 Flash en mode vision (format OpenAI-compatible).
 * DeepSeek a ajouté le multimodal à son API officielle (api.deepseek.com)
 * en avril 2026 avec les modèles deepseek-v4-flash (rapide, peu cher) et
 * deepseek-v4-pro (plus lourd). On utilise Flash pour l'extraction OCR :
 * suffisant pour lire un site web standard, ~10× moins cher que Pro.
 */
async function callDeepseekVision(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  maxTokens = 1500
): Promise<LLMResult> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_VISION_MODEL,
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek vision ${res.status} : ${txt.substring(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Réponse DeepSeek vision vide.');
  return {
    text,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      cache_read_input_tokens:
        data.usage?.prompt_cache_hit_tokens ||
        data.usage?.cache_read_input_tokens ||
        0,
    },
    modelUsed: DEEPSEEK_VISION_MODEL,
  };
}

/**
 * Appel LLM avec une IMAGE (vision). Format multimodal. Utilisé pour
 * extraire des informations structurées depuis une capture d'écran
 * (ex : extraire les infos d'un hôtel depuis une capture Booking).
 *
 * Ordre de priorité :
 *   1. DeepSeek V4 Flash — le moins cher, parfait pour OCR / fiches
 *      structurées comme Booking. Pré-requis : DEEPSEEK_API_KEY ET un
 *      modèle multimodal (deepseek-v4-flash, configurable via env var
 *      DEEPSEEK_VISION_MODEL).
 *   2. Gemini 2.5 Flash — fallback si DeepSeek pas dispo ou erreur.
 *   3. Claude Haiku 4.5 — dernier recours, toujours présent puisque
 *      ANTHROPIC_API_KEY est obligatoire pour TravelO.
 */
async function callVisionLLM(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  maxTokens = 1500
): Promise<LLMResult> {
  // 1) DeepSeek V4 Flash (priorité — objectif "tout chez DeepSeek")
  if (DEEPSEEK_API_KEY) {
    try {
      return await callDeepseekVision(prompt, imageBase64, mimeType, maxTokens);
    } catch (e) {
      console.warn('[vision] DeepSeek error:', (e as Error).message);
      // On continue vers les fallbacks plutôt que de planter
    }
  }
  // 2) Gemini
  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.2, // peu de créativité, max de précision OCR
            responseMimeType: 'application/json',
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const meta = data?.usageMetadata || {};
          return {
            text,
            usage: {
              input_tokens: meta.promptTokenCount || 0,
              output_tokens:
                (meta.candidatesTokenCount || 0) +
                (meta.thoughtsTokenCount || 0),
              cache_read_input_tokens: meta.cachedContentTokenCount || 0,
            },
            modelUsed: GEMINI_MODEL,
          };
        }
      } else {
        const txt = await res.text().catch(() => '');
        console.warn('[vision] Gemini', res.status, txt.substring(0, 200));
      }
    } catch (e) {
      console.warn('[vision] Gemini error:', (e as Error).message);
    }
  }
  // Fallback Claude (Haiku ou Sonnet selon ce qui est configuré pour expand)
  if (!ANTHROPIC_API_KEY) {
    throw new Error('Aucun backend vision configuré (GEMINI_API_KEY ou ANTHROPIC_API_KEY requis).');
  }
  const url = 'https://api.anthropic.com/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EXPAND_MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude vision ${res.status} : ${txt}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Réponse Claude vision vide.');
  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens || 0,
    },
    modelUsed: EXPAND_MODEL,
  };
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

// ============================================================
// VOLS RÉELS (Travelpayouts / Aviasales Data API)
// ============================================================
//
// Pour les voyages "avion-*", on tente de récupérer un vrai vol (prix,
// compagnie, horaires) AVANT d'appeler le LLM. Les infos sont :
// 1) injectées dans le prompt pour info,
// 2) puis ré-injectées physiquement dans l'itinéraire (trips J1 + J_final)
//    après génération, pour garantir qu'elles apparaissent dans le budget.

const AIR_TRIP_TYPES = new Set([
  'avion-voiture',
  'avion-citybreak',
  'avion-itinerant',
]);

/**
 * Cherche-t-on un vol pour ce voyage ? On agrège plusieurs signaux pour
 * couvrir le cas "Itinérant / Trek / Circuit train Marseille → Pékin" où
 * l'utilisateur n'a pas choisi un tripType explicitement aérien mais a
 * quand même besoin d'un vol pour rejoindre la destination.
 *
 * Retourne true si :
 *  - tripType ∈ AIR_TRIP_TYPES (cas historique)
 *  - OU scheduledTransport commence par 'avion' (l'utilisateur a déclaré
 *    voler dans le wizard "horaires/transport")
 *  - OU manualFlight contient des données (airline, n°, ou prix)
 */
function tripExpectsFlight(p: any): boolean {
  if (!p) return false;
  if (AIR_TRIP_TYPES.has(p.tripType)) return true;
  if (
    typeof p.scheduledTransport === 'string' &&
    p.scheduledTransport.toLowerCase().startsWith('avion')
  )
    return true;
  const mf = p.manualFlight;
  if (
    mf &&
    (mf.airline ||
      mf.flightNumber ||
      mf.outboundPriceEur ||
      mf.returnPriceEur)
  )
    return true;
  return false;
}

function shouldFetchFlight(p: any): boolean {
  if (!p) return false;
  if (!tripExpectsFlight(p)) return false;
  // Si l'utilisateur a déjà saisi son vol (prix) à la main, on ne tape
  // pas le fournisseur — sa saisie prime via manualFlightToData.
  if (p.manualFlight && (p.manualFlight.outboundPriceEur || p.manualFlight.returnPriceEur)) {
    return false;
  }
  return true;
}

function hasAnyFlightProviderConfigured(): boolean {
  return (
    !!(TRAVELPAYOUTS_TOKEN && TRAVELPAYOUTS_MARKER) || !!DUFFEL_API_TOKEN
  );
}

function manualFlightToData(p: any): FlightData | null {
  const mf = p?.manualFlight;
  if (!mf) return null;
  const adults = Number(p.adults) || 1;
  const childrenCount = Array.isArray(p.childrenAges) ? p.childrenAges.length : 0;
  const pax = adults + childrenCount;
  const outbound = Number(mf.outboundPriceEur) || 0;
  const ret = Number(mf.returnPriceEur) || 0;
  // outbound/return sont des prix PAR PERSONNE. Total famille = (a+r) * pax.
  const totalPerPax = outbound + ret;
  if (totalPerPax <= 0) return null;
  return {
    origin_iata: '',
    destination_iata: '',
    price_eur: Math.round(totalPerPax * pax),
    airline: mf.airline || 'N/A',
    flight_number: mf.flightNumber || null,
    // arrivalTime saisi par l'utilisateur = heure d'ARRIVÉE locale à
    // destination J1, et departureTime = heure de DÉPART locale du retour
    // depuis la destination. departure_at "aller" (depuis l'origine) n'est
    // pas saisi côté UI manuelle, on le laisse null.
    departure_at: null,
    arrival_at:
      p.startDate && p.arrivalTime
        ? `${p.startDate}T${p.arrivalTime}:00`
        : null,
    return_at:
      p.endDate && p.departureTime
        ? `${p.endDate}T${p.departureTime}:00`
        : null,
    return_arrival_at: null,
    deeplink: '',
    source: 'travelpayouts-cheap',
  };
}

/**
 * Filet de sécurité : si l'IA a placé un trip "Avion" dans l'itinéraire
 * MAIS qu'on n'a pas réussi à récupérer un vrai vol en amont (cas typique :
 * tripType "Itinérant" Marseille → Pékin — l'IA réalise qu'un vol est
 * nécessaire mais nos heuristiques tripExpectsFlight ne l'avaient pas
 * anticipé), on retape le fournisseur après génération pour remplacer le
 * prix halluciné par un prix réel.
 *
 * Renvoie un FlightData ou null si rien à corriger / pas de vol détecté.
 */
/**
 * Détecte un vol "implicite" dans l'itinéraire : l'IA n'a pas créé de trip
 * de mode "Avion" mais a clairement supposé qu'un vol existait (mention
 * d'atterrissage / aéroport / arrivée à destination, transfert taxi depuis
 * un aéroport, etc.). Sans ça on rate les cas où la destination est lointaine
 * mais le tripType n'est pas "avion-*" (cas typique : "Itinérant" Marseille
 * → Canada — vu en prod, l'IA décrit "Arrivée à Montréal" + transfer YUL
 * → hôtel sans créer le moindre trip Avion).
 */
function hasImplicitFlightHint(itinerary: any): boolean {
  if (!itinerary?.days?.length) return false;
  const airportRe = /aéroport|aeroport|airport|terminal/i;
  const flightWordsRe = /\b(atterrissage|atterriss|en\s+vol|prise?\s+du\s+vol|vol\s+aller|vol\s+retour|décollage|decollage|arrivée\s+(à|au|aux|en)\s+|landing|takeoff)/i;
  for (const day of itinerary.days) {
    // 1) Trip avec aéroport mentionné dans from / to
    for (const t of day.trips || []) {
      if (airportRe.test(`${t.from || ''} ${t.to || ''}`)) return true;
    }
    // 2) Mentions de vol/atterrissage dans les moments
    for (const key of ['morning', 'noon', 'afternoon', 'evening']) {
      const m = day[key];
      if (!m) continue;
      const text = `${m.title || ''} ${m.description || ''}`;
      if (flightWordsRe.test(text)) return true;
    }
  }
  return false;
}

async function recoverFlightDataIfNeeded(
  itinerary: any,
  preferences: any
): Promise<AnyFlightData | null> {
  if (!itinerary?.days?.length) return null;
  if (!hasAnyFlightProviderConfigured()) return null;
  // Cherche un trip de mode "Avion" dans n'importe quelle journée
  let hasFlightTrip = false;
  outer: for (const d of itinerary.days) {
    for (const t of d.trips || []) {
      if (/avion|vol|flight|plane/i.test(t?.mode || '')) {
        hasFlightTrip = true;
        break outer;
      }
    }
  }
  // Si pas de trip Avion explicite, on cherche des indices implicites
  // (mention d'aéroport dans un transfert, "Arrivée à Montréal" en J1, etc.)
  if (!hasFlightTrip && !hasImplicitFlightHint(itinerary)) return null;
  // L'IA a inventé un vol — on essaie de récupérer une vraie cotation
  console.log(
    '[flight-recovery] L\'IA a ajouté un vol sans nos données, fetch fallback…'
  );
  const adults = Number(preferences.adults) || 1;
  const childrenCount = Array.isArray(preferences.childrenAges)
    ? preferences.childrenAges.length
    : 0;
  const arrivalCity = preferences.arrivalGateway || preferences.destinations;
  const departureCity =
    preferences.departureGateway || preferences.departureLocation;
  if (!arrivalCity || !departureCity) return null;
  try {
    return await searchFlightAny(
      {
        originCity: departureCity,
        destinationCity: arrivalCity,
        departDate: preferences.startDate,
        returnDate:
          preferences.returnLocation &&
          preferences.returnLocation !== preferences.departureLocation
            ? null
            : preferences.endDate,
        adults,
        children: childrenCount,
      },
      {
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        travelpayoutsToken: TRAVELPAYOUTS_TOKEN,
        travelpayoutsMarker: TRAVELPAYOUTS_MARKER,
        duffelApiToken: DUFFEL_API_TOKEN,
      }
    );
  } catch (e) {
    console.warn('[flight-recovery] failed:', e);
    return null;
  }
}

async function resolveFlightData(p: any): Promise<AnyFlightData | null> {
  // 1) Saisie manuelle prioritaire
  const manual = manualFlightToData(p);
  if (manual) return manual;

  // 2) Recherche via le fournisseur actif (Travelpayouts ou Duffel) si
  // tripType compatible et qu'au moins un fournisseur a ses secrets.
  if (!shouldFetchFlight(p)) return null;
  if (!hasAnyFlightProviderConfigured()) {
    console.warn('[flights] Aucun fournisseur configuré, skip.');
    return null;
  }
  try {
    const adults = Number(p.adults) || 1;
    const childrenCount = Array.isArray(p.childrenAges) ? p.childrenAges.length : 0;
    // Si l'utilisateur a précisé une ville/aéroport d'arrivée exacte, on
    // l'utilise (utile quand destinations = pays type "Norvège").
    const arrivalCity = p.arrivalGateway || p.destinations;
    const departureCity = p.departureGateway || p.departureLocation;
    return await searchFlightAny(
      {
        originCity: departureCity,
        destinationCity: arrivalCity,
        departDate: p.startDate,
        returnDate:
          p.returnLocation && p.returnLocation !== p.departureLocation
            ? null // aller simple
            : p.endDate,
        adults,
        children: childrenCount,
      },
      {
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        travelpayoutsToken: TRAVELPAYOUTS_TOKEN,
        travelpayoutsMarker: TRAVELPAYOUTS_MARKER,
        duffelApiToken: DUFFEL_API_TOKEN,
      }
    );
  } catch (e) {
    console.warn('[flights] searchFlightAny failed:', e);
    return null;
  }
}

function flightSourceLabel(source: string | undefined): string {
  if (!source) return 'fournisseur de vols';
  if (source.startsWith('duffel')) return 'Duffel';
  if (source.startsWith('travelpayouts')) return 'Aviasales / Travelpayouts';
  return source;
}

/**
 * Bloc anti-hallucination injecté dans le prompt quand on n'a PAS récupéré
 * de vol réel auprès du fournisseur. Sans ce garde-fou, l'IA "imagine" un
 * prix totalement irréaliste (vu : 5 400 € pour un Marseille-Pékin par
 * personne au lieu de ~700 € → utilisateur ridiculisé devant ses prospects).
 */
function buildNoFlightDataNotice(): string {
  return `
INSTRUCTIONS VOLS — AUCUNE DONNÉE DE VOL FOURNIE :
  Nous n'avons PAS pu récupérer de données réelles de vol auprès de notre fournisseur partenaire.
  - Si tu juges utile d'ajouter un trip de mode "Avion" dans l'itinéraire, TU NE DOIS PAS inventer de prix.
    → Mets "estimated_cost_eur": null  (et NON un chiffre que tu imagines).
    → Mets dans "cost_note" : "Prix à confirmer après réservation — nos données fournisseur n'étaient pas disponibles pour cette route."
  - Tu PEUX en revanche estimer un horaire de départ et d'arrivée plausible.
  - Tu PEUX ajouter dans la description du jour une mention "Réservation du vol à faire de votre côté".
  - NE FABRIQUE PAS de numéro de vol — laisse "_flight" absent.
  ⚠️ Tu seras ÉVALUÉ sur la crédibilité du chiffrage : un prix de vol inventé est PIRE qu'un prix manquant.`;
}

function formatFlightBlockForPrompt(flight: AnyFlightData, p: any): string {
  if (!flight) return '';
  const adults = Number(p.adults) || 1;
  const childrenCount = Array.isArray(p.childrenAges) ? p.childrenAges.length : 0;
  const pax = adults + childrenCount;
  const pricePerPax = pax > 0 ? Math.round(flight.price_eur / pax) : flight.price_eur;
  const isRoundTrip =
    !p.returnLocation || p.returnLocation === p.departureLocation;
  const providerLabel = flightSourceLabel(flight.source);
  const arrival = flight.arrival_at
    ? flight.arrival_at.substring(11, 16)
    : null;
  const returnArrival = flight.return_arrival_at
    ? flight.return_arrival_at.substring(11, 16)
    : null;
  const depTime = flight.departure_at
    ? flight.departure_at.substring(11, 16)
    : null;
  const retTime = flight.return_at
    ? flight.return_at.substring(11, 16)
    : null;

  return `
VOL RÉEL (récupéré via ${providerLabel} — DOIS être utilisé tel quel) :
  - Trajet : ${p.departureLocation} (${flight.origin_iata || '?'}) → ${p.destinations} (${flight.destination_iata || '?'})${
    isRoundTrip ? ' aller-retour' : ' aller simple'
  }
  - Compagnie : ${flight.airline}${flight.flight_number ? ` (vol ${flight.airline}${flight.flight_number})` : ''}
  - Prix total famille : ${flight.price_eur} € (≈ ${pricePerPax} € par personne)
  - Heure de départ aller (heure locale ${flight.origin_iata || 'origine'}) : ${depTime || '(non précisée)'}
  - Heure d'arrivée à destination (HEURE LOCALE ${flight.destination_iata || 'destination'}) : ${arrival || '(non précisée — estime selon la durée typique de vol et le décalage horaire)'}
  ${isRoundTrip ? `- Heure de départ retour (heure locale destination) : ${retTime || '(non précisée)'}\n  - Heure d'arrivée retour (HEURE LOCALE ${flight.origin_iata || 'origine'}) : ${returnArrival || '(non précisée)'}` : ''}

⇒ Tu DOIS créer un trip de mode "Avion" dans le J1 (vol aller) et ${isRoundTrip ? 'dans le dernier jour (vol retour) ' : ''}avec EXACTEMENT ce prix et ces horaires.

RÈGLES STRICTES À RESPECTER pour caler le J1 — sans EXCEPTION :
  1. L'heure d'arrivée à destination est en HEURE LOCALE. Tu DOIS utiliser EXACTEMENT cette heure pour caler le programme.
  2. Après atterrissage, prévois MINIMUM 2 h avant l'installation à l'hôtel (récupération bagages, transfert aéroport → centre, check-in).
     → Heure d'installation hôtel minimum = heure d'arrivée + 2 h.
  3. Après installation, prévois MINIMUM 1 h 30 avant toute activité programmée (déballage, douche, repos après vol).
     → Heure de 1ʳᵉ activité minimum = heure d'installation hôtel + 1 h 30.
  4. Si l'heure de 1ʳᵉ activité tomberait après 19 h, ou s'il reste moins de 2 h d'activité avant 22 h, alors le J1 NE DOIT CONTENIR QUE :
     - le vol
     - le transfert aéroport → hôtel
     - l'installation
     - ÉVENTUELLEMENT un dîner simple à proximité de l'hôtel (à pied)
     → AUCUNE excursion, AUCUNE visite, AUCUN trajet long ne doit figurer ce jour-là.
  5. Le bloc "morning" / "noon" / "afternoon" / "evening" de J1 doit refléter ces contraintes :
     - Les blocs antérieurs à l'arrivée doivent dire "Vol vers ${p.destinations} (départ ${depTime || 'matin'} de ${p.departureLocation || 'origine'})" ou "En vol".
     - Le bloc d'arrivée doit dire "Atterrissage ${arrival ? `vers ${arrival}` : ''} (heure locale)".
     - Le(s) bloc(s) après installation doivent rester légers (repos, dîner proche).
  6. Pour le JOUR FINAL (retour) : appliquer le miroir — prévoir minimum 2 h pour rejoindre l'aéroport avant l'heure de départ retour. AUCUNE activité ne doit démarrer moins de 2 h avant cette heure cible aéroport.`;
}

/**
 * Ajoute physiquement les trips "Vol" dans l'itinéraire généré (J1 + dernier
 * jour) et recalcule les totaux du budget. Garantit que le vol apparaît
 * toujours dans "Trajets (total)" et "Détail par mode" même si le LLM l'a
 * oublié ou mis un prix différent.
 */
function enrichItineraryWithFlight(itinerary: any, flight: AnyFlightData, p: any) {
  if (!itinerary || !Array.isArray(itinerary.days) || itinerary.days.length === 0) {
    return itinerary;
  }
  if (!flight || !flight.price_eur || flight.price_eur <= 0) {
    return itinerary;
  }

  const isRoundTrip =
    !p.returnLocation || p.returnLocation === p.departureLocation;
  const total = flight.price_eur;
  // Si aller-retour, on split 50/50 ; sinon tout sur l'aller
  const outboundCost = isRoundTrip ? Math.round(total / 2) : total;
  const returnCost = isRoundTrip ? total - outboundCost : 0;

  const airlineLabel = flight.airline && flight.airline !== 'N/A' ? flight.airline : 'compagnie';
  const flightNumberLabel = flight.flight_number
    ? ` ${flight.airline || ''}${flight.flight_number}`.trim()
    : '';

  const buildTrip = (
    from: string,
    to: string,
    cost: number,
    departureIso: string | null,
    arrivalIso: string | null,
    label: 'aller' | 'retour'
  ) => {
    const time = departureIso ? departureIso.substring(11, 16) : null;
    return {
      from,
      to,
      distance_km: null,
      duration: null,
      mode: 'Avion',
      estimated_cost_eur: cost,
      fuel_cost_eur: null,
      toll_cost_eur: null,
      ferry_cost_eur: null,
      cost_note: `Vol ${label} ${airlineLabel}${flightNumberLabel}${time ? `, départ ${time}` : ''} — prix ${flightSourceLabel(flight.source)}`,
      road_warning: null,
      _flight: {
        airline: flight.airline,
        flight_number: flight.flight_number,
        departure_at: departureIso,
        arrival_at: arrivalIso,
        deeplink: flight.deeplink || null,
        source: flight.source,
      },
    };
  };

  // --- J1 : ajoute le vol aller en TÊTE des trips ---
  const firstDay = itinerary.days[0];
  if (firstDay) {
    if (!Array.isArray(firstDay.trips)) firstDay.trips = [];
    // Supprime un éventuel trip "Avion" hallucinant placé par le LLM
    firstDay.trips = firstDay.trips.filter(
      (t: any) => !/avion|vol|flight|plane/i.test(t?.mode || '')
    );
    firstDay.trips.unshift(
      buildTrip(
        p.departureLocation || 'Domicile',
        p.destinations || flight.destination_iata,
        outboundCost,
        flight.departure_at,
        flight.arrival_at,
        'aller'
      )
    );
    firstDay.day_total_eur =
      (firstDay.day_total_eur || 0) + outboundCost;
  }

  // --- Dernier jour : vol retour si aller-retour ---
  if (isRoundTrip && returnCost > 0) {
    const lastDay = itinerary.days[itinerary.days.length - 1];
    if (lastDay) {
      if (!Array.isArray(lastDay.trips)) lastDay.trips = [];
      lastDay.trips = lastDay.trips.filter(
        (t: any) => !/avion|vol|flight|plane/i.test(t?.mode || '')
      );
      lastDay.trips.push(
        buildTrip(
          p.destinations || flight.origin_iata,
          p.returnLocation || p.departureLocation || 'Domicile',
          returnCost,
          flight.return_at,
          flight.return_arrival_at,
          'retour'
        )
      );
      lastDay.day_total_eur =
        (lastDay.day_total_eur || 0) + returnCost;
    }
  }

  // --- Recalcule les totaux du budget_summary ---
  if (itinerary.budget_summary) {
    itinerary.budget_summary.trips_eur =
      (itinerary.budget_summary.trips_eur || 0) + total;
    itinerary.budget_summary.grand_total_eur =
      (itinerary.budget_summary.grand_total_eur || 0) + total;
    const pax =
      (Number(p.adults) || 1) +
      (Array.isArray(p.childrenAges) ? p.childrenAges.length : 0);
    if (pax > 0) {
      itinerary.budget_summary.per_person_eur = Math.round(
        itinerary.budget_summary.grand_total_eur / pax
      );
    }
  }

  // --- Expose les données vol au niveau summary pour le frontend ---
  if (itinerary.summary) {
    itinerary.summary.flight_data = {
      airline: flight.airline,
      flight_number: flight.flight_number,
      origin_iata: flight.origin_iata,
      destination_iata: flight.destination_iata,
      total_price_eur: total,
      outbound_price_eur: outboundCost,
      return_price_eur: returnCost,
      departure_at: flight.departure_at,
      return_at: flight.return_at,
      deeplink: flight.deeplink || null,
      source: flight.source,
    };
  }

  return itinerary;
}

/**
 * Sépare une FlightData en deux "jambes" (aller / retour) avec leur propre
 * coût et horaire. Utile pour le mode long (plan-trip + expand-day) où chaque
 * jambe est attachée à un day_plan distinct.
 */
function splitFlightForLegs(flight: AnyFlightData, isRoundTrip: boolean, p: any) {
  const total = flight.price_eur;
  const outboundCost = isRoundTrip ? Math.round(total / 2) : total;
  const returnCost = isRoundTrip ? total - outboundCost : 0;
  const airlineLabel =
    flight.airline && flight.airline !== 'N/A' ? flight.airline : 'compagnie';
  const flightNumberLabel = flight.flight_number
    ? ` ${flight.airline || ''}${flight.flight_number}`.trim()
    : '';

  return {
    isRoundTrip,
    total,
    outbound: {
      from: p.departureLocation || 'Domicile',
      to: p.destinations || flight.destination_iata,
      cost: outboundCost,
      departure_at: flight.departure_at,
      arrival_at: flight.arrival_at,
      airlineLabel,
      flightNumberLabel,
      airline: flight.airline,
      flight_number: flight.flight_number,
      deeplink: flight.deeplink || null,
      source: flight.source,
    },
    returnLeg:
      isRoundTrip && returnCost > 0
        ? {
            from: p.destinations || flight.origin_iata,
            to: p.returnLocation || p.departureLocation || 'Domicile',
            cost: returnCost,
            departure_at: flight.return_at,
            arrival_at: flight.return_arrival_at,
            airlineLabel,
            flightNumberLabel,
            airline: flight.airline,
            flight_number: flight.flight_number,
            deeplink: flight.deeplink || null,
            source: flight.source,
          }
        : null,
  };
}

type FlightLeg = ReturnType<typeof splitFlightForLegs>['outbound'];

function buildFlightTrip(leg: FlightLeg, legLabel: 'aller' | 'retour') {
  const time = leg.departure_at ? leg.departure_at.substring(11, 16) : null;
  return {
    from: leg.from,
    to: leg.to,
    distance_km: null,
    duration: null,
    mode: 'Avion',
    estimated_cost_eur: leg.cost,
    fuel_cost_eur: null,
    toll_cost_eur: null,
    ferry_cost_eur: null,
    cost_note: `Vol ${legLabel} ${leg.airlineLabel}${leg.flightNumberLabel}${time ? `, départ ${time}` : ''} — prix ${flightSourceLabel(leg.source)}`,
    road_warning: null,
    _flight: {
      airline: leg.airline,
      flight_number: leg.flight_number,
      departure_at: leg.departure_at,
      arrival_at: leg.arrival_at,
      deeplink: leg.deeplink,
      source: leg.source,
    },
  };
}

function formatFlightLegForPrompt(leg: FlightLeg, legLabel: 'aller' | 'retour'): string {
  const time = leg.departure_at ? leg.departure_at.substring(11, 16) : null;
  return `
VOL ${legLabel.toUpperCase()} RÉEL — à intégrer impérativement dans cette journée :
  - Trajet : ${leg.from} → ${leg.to}
  - Compagnie : ${leg.airlineLabel}${leg.flightNumberLabel}
  - ${legLabel === 'aller' ? 'Heure de départ' : 'Heure de départ retour'} : ${time || '(non précisée)'}
  - Coût total famille pour cette jambe : ${leg.cost} €
  ⇒ Crée un trip de mode "Avion" avec EXACTEMENT ce coût et cale les activités de la journée autour de cet horaire (transfert aéroport, marges, check-in/out, jet lag éventuel).`;
}

/**
 * Ajoute le trip "Avion" à UN jour expand. Utilisé en mode long quand
 * day_plan._flight_outbound ou _flight_return est présent.
 */
function enrichDayWithFlightLeg(day: any, leg: FlightLeg, legLabel: 'aller' | 'retour') {
  if (!day || !leg || !leg.cost) return day;
  if (!Array.isArray(day.trips)) day.trips = [];
  // Supprime tout trip "Avion" inventé par le LLM
  day.trips = day.trips.filter(
    (t: any) => !/avion|vol|flight|plane/i.test(t?.mode || '')
  );
  const trip = buildFlightTrip(leg, legLabel);
  if (legLabel === 'aller') {
    day.trips.unshift(trip);
  } else {
    day.trips.push(trip);
  }
  day.day_total_eur = (day.day_total_eur || 0) + leg.cost;
  return day;
}

// ============================================================
// FALLBACK : deeplink Aviasales SANS prix
// ============================================================
//
// Quand Travelpayouts ne renvoie pas de prix dans son cache (routes
// long-courrier, dates très lointaines, etc.), on peut quand même
// générer un lien de réservation Aviasales pré-rempli. L'utilisateur
// clique, atterrit sur Aviasales avec sa recherche, et voit les vrais
// prix/horaires en direct.

interface DeeplinkPair {
  origin_iata: string;
  destination_iata: string;
  outbound_deeplink: string;
  return_deeplink: string | null;
}

async function resolveDeeplinkPair(p: any): Promise<DeeplinkPair | null> {
  if (!tripExpectsFlight(p)) return null;
  const adults = Number(p.adults) || 1;
  const childrenCount = Array.isArray(p.childrenAges) ? p.childrenAges.length : 0;
  // Préfère arrivalGateway/departureGateway si saisis (cas pays).
  const arrivalCity = p.arrivalGateway || p.destinations;
  const departureCity = p.departureGateway || p.departureLocation;
  const origin = await cityToIata(departureCity);
  const destination = await cityToIata(arrivalCity);
  if (!origin || !destination || origin === destination) return null;
  const isRoundTrip =
    !p.returnLocation || p.returnLocation === p.departureLocation;

  // Choix du fournisseur de deeplinks selon la config admin :
  //  - 'duffel'        → Google Flights (Duffel n'a pas de site consommateur)
  //  - 'travelpayouts' → Aviasales avec marker affilié
  const provider = await getActiveFlightProvider(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );

  let outbound: string;
  let ret: string | null;

  if (provider === 'duffel') {
    outbound = buildGoogleFlightsDeeplink({
      origin,
      destination,
      departDate: p.startDate,
      returnDate: isRoundTrip ? p.endDate : null,
      adults,
      children: childrenCount,
      currency: 'EUR',
      locale: 'fr',
    });
    ret = isRoundTrip
      ? buildGoogleFlightsDeeplink({
          origin: destination,
          destination: origin,
          departDate: p.endDate,
          returnDate: null,
          adults,
          children: childrenCount,
          currency: 'EUR',
          locale: 'fr',
        })
      : null;
  } else {
    // Travelpayouts / Aviasales — nécessite le marker pour l'affiliation
    if (!TRAVELPAYOUTS_MARKER) return null;
    outbound = buildAviasalesDeeplink({
      origin,
      destination,
      departDate: p.startDate,
      returnDate: isRoundTrip ? p.endDate : null,
      adults,
      children: childrenCount,
      marker: TRAVELPAYOUTS_MARKER,
    });
    ret = isRoundTrip
      ? buildAviasalesDeeplink({
          origin: destination,
          destination: origin,
          departDate: p.endDate,
          returnDate: null,
          adults,
          children: childrenCount,
          marker: TRAVELPAYOUTS_MARKER,
        })
      : null;
  }

  return {
    origin_iata: origin,
    destination_iata: destination,
    outbound_deeplink: outbound,
    return_deeplink: ret,
  };
}

/**
 * Attache un deeplink Aviasales aux trips "Avion" qui n'en ont pas encore
 * (cas typique : le LLM a inventé un trip "Vol direct" sans nos données).
 * Garantit que l'utilisateur a TOUJOURS un bouton "Réserver" cliquable.
 */
function attachDeeplinksToTrips(itinerary: any, dl: DeeplinkPair) {
  if (!itinerary?.days?.length || !dl) return itinerary;
  const isFlightMode = (m: string) =>
    /avion|vol|flight|plane/i.test(m || '');
  // J1 : aller
  const firstDay = itinerary.days[0];
  if (firstDay?.trips) {
    for (const t of firstDay.trips) {
      if (isFlightMode(t.mode) && !t._flight?.deeplink) {
        t._flight = { ...(t._flight || {}), deeplink: dl.outbound_deeplink };
      }
    }
  }
  // Dernier jour : retour
  if (dl.return_deeplink && itinerary.days.length > 1) {
    const lastDay = itinerary.days[itinerary.days.length - 1];
    if (lastDay?.trips) {
      for (const t of lastDay.trips) {
        if (isFlightMode(t.mode) && !t._flight?.deeplink) {
          t._flight = { ...(t._flight || {}), deeplink: dl.return_deeplink };
        }
      }
    }
  }
  // Expose au niveau summary pour affichage hero/budget
  if (itinerary.summary) {
    itinerary.summary.flight_data = {
      ...(itinerary.summary.flight_data || {}),
      origin_iata:
        itinerary.summary.flight_data?.origin_iata || dl.origin_iata,
      destination_iata:
        itinerary.summary.flight_data?.destination_iata || dl.destination_iata,
      outbound_deeplink:
        itinerary.summary.flight_data?.deeplink || dl.outbound_deeplink,
      return_deeplink:
        itinerary.summary.flight_data?.return_deeplink || dl.return_deeplink,
      deeplink: itinerary.summary.flight_data?.deeplink || dl.outbound_deeplink,
    };
  }
  return itinerary;
}

/**
 * Garde-fou : le LLM met parfois le prix PAR PERSONNE dans
 * estimated_cost_eur d'un trip vol au lieu du total famille (typiquement
 * il écrit "600 €/pers" dans cost_note ET "estimated_cost_eur": 600 alors
 * que la famille compte 3 personnes).
 *
 * On détecte ce cas via cost_note (ou mode) et on multiplie par le pax.
 * Uniquement appliqué aux trips "Avion" qui n'ont PAS de source
 * Travelpayouts (les nôtres sont déjà corrects).
 */
function fixPerPersonFlightCosts(itinerary: any, p: any) {
  if (!itinerary?.days?.length) return itinerary;
  const adults = Number(p.adults) || 1;
  const children = Array.isArray(p.childrenAges) ? p.childrenAges.length : 0;
  const pax = adults + children;
  if (pax <= 1) return itinerary; // 1 personne : "par personne" == "total"

  const isFlightMode = (m: string) =>
    /avion|vol|flight|plane/i.test(m || '');
  // Patterns FR/EN/abréviations qui trahissent un prix unitaire
  const perPaxPattern =
    /(par\s+personne|\/\s*pers(\.|onne)?|\/\s*pax|per\s+person|each|p\.p\.|chacun)/i;

  let totalDelta = 0;

  for (const day of itinerary.days) {
    if (!Array.isArray(day.trips)) continue;
    for (const t of day.trips) {
      if (!isFlightMode(t.mode)) continue;
      // Skip si c'est un de nos trips enrichis (déjà calculé en total famille)
      if (isRealFlightSource(t._flight?.source)) continue;
      const cost = Number(t.estimated_cost_eur) || 0;
      if (cost <= 0) continue;
      const note = `${t.cost_note || ''} ${t.mode || ''}`;
      if (!perPaxPattern.test(note)) continue;
      // Sanity check : le coût × pax doit rester plausible (< 50000 € par jambe)
      const corrected = cost * pax;
      if (corrected > 50000) continue;
      console.log(
        `[flight-fix] Vol "${t.from}→${t.to}" : ${cost} €/pers × ${pax} pax = ${corrected} €`
      );
      const oldCost = cost;
      t.estimated_cost_eur = corrected;
      // Met à jour la note pour rester cohérent
      t.cost_note = `Total famille (${pax} pers × ${oldCost} €/pers)`;
      day.day_total_eur = (day.day_total_eur || 0) + (corrected - oldCost);
      totalDelta += corrected - oldCost;
    }
  }

  if (totalDelta > 0 && itinerary.budget_summary) {
    itinerary.budget_summary.trips_eur =
      (itinerary.budget_summary.trips_eur || 0) + totalDelta;
    itinerary.budget_summary.grand_total_eur =
      (itinerary.budget_summary.grand_total_eur || 0) + totalDelta;
    if (pax > 0) {
      itinerary.budget_summary.per_person_eur = Math.round(
        itinerary.budget_summary.grand_total_eur / pax
      );
    }
  }
  return itinerary;
}

/**
 * Enrichit TOUS les trips "Avion" de l'itinéraire (pas seulement J1 et
 * dernier jour) en appelant le fournisseur configuré pour chaque vol
 * interne. Utile pour les voyages avec plusieurs étapes aériennes (ex :
 * Tour d'Asie : Paris → Tokyo, puis Tokyo → Séoul à J5, puis Séoul → Paris).
 *
 * Stratégie :
 *  - On saute les trips déjà enrichis par enrichItineraryWithFlight
 *    (J1 outbound + dernier jour return) — leur _flight.source est déjà set.
 *  - Pour chaque autre trip Avion, on lit t.from / t.to / day.date
 *  - On appelle searchFlightAny en aller simple (vol interne ≠ A/R)
 *  - On REMPLACE le prix halluciné par le prix réel et on recalcule les
 *    totaux du jour + du budget global.
 */
async function enrichInternalFlights(
  itinerary: any,
  preferences: any
): Promise<any> {
  if (!itinerary?.days?.length) return itinerary;
  if (!hasAnyFlightProviderConfigured()) return itinerary;

  const adults = Number(preferences.adults) || 1;
  const childrenCount = Array.isArray(preferences.childrenAges)
    ? preferences.childrenAges.length
    : 0;
  const pax = adults + childrenCount;
  const secrets = {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    travelpayoutsToken: TRAVELPAYOUTS_TOKEN,
    travelpayoutsMarker: TRAVELPAYOUTS_MARKER,
    duffelApiToken: DUFFEL_API_TOKEN,
  };
  const isFlightMode = (m: string) => /avion|vol|flight|plane/i.test(m || '');

  let totalDelta = 0;

  for (const day of itinerary.days) {
    if (!Array.isArray(day.trips)) continue;
    for (const t of day.trips) {
      if (!isFlightMode(t.mode)) continue;
      // Skip ceux déjà enrichis avec vraies données (J1 + dernier jour, ou
      // un précédent passage de cette fonction)
      if (isRealFlightSource(t._flight?.source)) continue;
      if (!t.from || !t.to || !day.date) continue;
      try {
        console.log(
          `[internal-flight] fetch ${t.from} → ${t.to} le ${day.date}…`
        );
        const flight = await searchFlightAny(
          {
            originCity: String(t.from),
            destinationCity: String(t.to),
            departDate: String(day.date),
            returnDate: null, // vols internes = aller simple
            adults,
            children: childrenCount,
          },
          secrets
        );
        if (!flight) {
          console.log(
            `[internal-flight] pas de cotation pour ${t.from} → ${t.to}`
          );
          continue;
        }
        // Remplace le prix halluciné par le vrai prix
        const oldCost = Number(t.estimated_cost_eur) || 0;
        const newCost = flight.price_eur;
        const delta = newCost - oldCost;

        t.estimated_cost_eur = newCost;
        const airlineLabel =
          flight.airline && flight.airline !== 'N/A'
            ? flight.airline
            : 'compagnie';
        const flightNumberLabel = flight.flight_number
          ? ` ${flight.airline || ''}${flight.flight_number}`.trim()
          : '';
        const time = flight.departure_at
          ? flight.departure_at.substring(11, 16)
          : null;
        t.cost_note = `Vol interne ${airlineLabel}${flightNumberLabel}${
          time ? `, départ ${time}` : ''
        } — prix ${flightSourceLabel(flight.source)}`;
        t._flight = {
          airline: flight.airline,
          flight_number: flight.flight_number,
          departure_at: flight.departure_at,
          arrival_at: flight.arrival_at,
          deeplink: flight.deeplink || null,
          source: flight.source,
        };
        // Recalibrage des totaux journaliers
        day.day_total_eur = (day.day_total_eur || 0) + delta;
        totalDelta += delta;
      } catch (e) {
        console.warn(
          `[internal-flight] erreur pour ${t.from} → ${t.to}:`,
          e
        );
      }
    }
  }

  // Recalibrage du budget global si on a modifié au moins un prix
  if (totalDelta !== 0 && itinerary.budget_summary) {
    itinerary.budget_summary.trips_eur =
      (itinerary.budget_summary.trips_eur || 0) + totalDelta;
    itinerary.budget_summary.grand_total_eur =
      (itinerary.budget_summary.grand_total_eur || 0) + totalDelta;
    if (pax > 0) {
      itinerary.budget_summary.per_person_eur = Math.round(
        itinerary.budget_summary.grand_total_eur / pax
      );
    }
  }

  return itinerary;
}

/**
 * Variante pour UN jour expand : attache le deeplink correspondant
 * (aller ou retour selon `leg`) aux trips "Avion" du jour.
 */
function attachDeeplinkToDayTrips(
  day: any,
  deeplink: string,
  leg: 'outbound' | 'return'
) {
  if (!day?.trips || !deeplink) return day;
  const isFlightMode = (m: string) =>
    /avion|vol|flight|plane/i.test(m || '');
  for (const t of day.trips) {
    if (isFlightMode(t.mode) && !t._flight?.deeplink) {
      t._flight = { ...(t._flight || {}), deeplink, _leg: leg };
    }
  }
  return day;
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
      let day = await parseOrRepair(text, callMainSafe);
      // Si la journée régénérée contient un trip Avion (ex : régénération qui
      // ajoute un vol interne), on enrichit avec vraies données fournisseur.
      const preferences = itinerary?.summary
        ? {
            adults: itinerary.summary.travellers?.adults || 1,
            childrenAges: itinerary.summary.travellers?.children_ages || [],
            destinations: itinerary.summary.destinations,
            departureLocation: itinerary.summary.departure_location,
          }
        : {};
      const wrapped = { days: [day], budget_summary: {} };
      await enrichInternalFlights(wrapped, preferences);
      day = wrapped.days[0];
      return jsonResponse({ day, usage, model: modelUsed });
    }

    if (mode === 'suggest-moment-alternatives') {
      // Body : { day, moment_key, day_index, total_days }
      // day   = la journée complète (objet) — pour conserver la cohérence
      // moment_key ∈ 'morning' | 'noon' | 'afternoon' | 'evening'
      const { day, moment_key, day_index, total_days } = body;
      if (!day || typeof moment_key !== 'string') {
        return jsonResponse(
          { error: 'Body invalide : day + moment_key requis.' },
          400
        );
      }
      const labelMap: Record<string, string> = {
        morning: 'Matin',
        noon: 'Midi',
        afternoon: 'Après-midi',
        evening: 'Soir',
      };
      const slotLabel = labelMap[moment_key] || moment_key;
      const current = day[moment_key] || { title: '', description: '' };
      const flightTrip = (day.trips || []).find((t: any) =>
        /avion|vol|flight|plane/i.test(t?.mode || '')
      );
      const flightConstraintsLine = flightTrip?._flight
        ? `\n⚠️ Cette journée comporte un vol (${flightTrip.from} → ${flightTrip.to}, départ ${
            flightTrip._flight.departure_at
              ? flightTrip._flight.departure_at.substring(11, 16)
              : '?'
          }, arrivée ${
            flightTrip._flight.arrival_at
              ? flightTrip._flight.arrival_at.substring(11, 16)
              : '?'
          }, heure locale). Les alternatives doivent respecter : 2 h entre atterrissage et hôtel + 1 h 30 avant activités.`
        : '';

      const prompt = `Tu es un planificateur de voyage. L'utilisateur veut REMPLACER un moment de sa journée par une autre option. Propose 5 alternatives variées, cohérentes avec le reste de la journée.

LIEU : ${day.location}
DATE : ${day.date}${day.weather ? `\nMÉTÉO : ${day.weather.emoji} ${day.weather.temperature_c}°C — ${day.weather.description || ''}` : ''}
JOUR ${typeof day_index === 'number' ? day_index + 1 : '?'} / ${total_days || '?'}

MOMENT À REMPLACER : ${slotLabel}
Titre actuel : "${current.title || '(vide)'}"
Description actuelle : "${current.description || '(vide)'}"

CONTEXTE DE LA JOURNÉE (pour rester cohérent) :
- Matin : ${day.morning?.title || '(vide)'}
- Midi : ${day.noon?.title || '(vide)'}
- Après-midi : ${day.afternoon?.title || '(vide)'}
- Soir : ${day.evening?.title || '(vide)'}
- Hôtel ce soir : ${day.accommodation?.name || '(non précisé)'}${flightConstraintsLine}

CONSIGNES — TRÈS IMPORTANT :
- Propose EXACTEMENT 5 alternatives DIFFÉRENTES entre elles.
- VARIE les profils — au moins : 1 option "REPOS / DÉTENTE", 1 option "CULTURE", 1 option "GASTRONOMIE / MARCHÉ", 1 option "NATURE / EXTÉRIEUR", 1 option "GRATUIT OU TRÈS PEU CHER".
- Chaque alternative doit être RÉALISABLE depuis "${day.accommodation?.name || day.location}" et compatible avec les moments adjacents (pas de téléportation à l'autre bout de la ville quand le moment d'après doit être à proximité).
- Garde la durée raisonnable pour le slot (Matin ≈ 3 h max, Midi ≈ 1h30, Après-midi ≈ 4 h max, Soir ≈ 3 h max).
- Ne propose JAMAIS de répéter ce qui est déjà prévu dans un autre moment du jour.
- Titre : court, accrocheur, 4-8 mots.
- Description : 1-2 phrases concrètes (où précisément, quoi faire, pourquoi c'est sympa pour ce slot).

Renvoie UNIQUEMENT du JSON valide selon ce schéma (rien autour) :

{
  "alternatives": [
    {
      "type": "repos | culture | gastronomie | nature | gratuit",
      "title": "...",
      "description": "...",
      "estimated_duration": "1h30"
    }
  ]
}`;
      const { text, usage, modelUsed } = await callExpansion(prompt, 2500);
      const parsed = await parseOrRepair(text, callExpansionSafe);
      return jsonResponse({
        alternatives: parsed?.alternatives || [],
        usage,
        model: modelUsed,
      });
    }

    if (mode === 'extract-flight-from-image') {
      // Body :
      //   image_base64    base64 de la capture (sans préfixe data:)
      //   mime_type       'image/png' | 'image/jpeg' | 'image/webp'
      //   context         { adults?, children?, origin_hint?, destination_hint?,
      //                     expected_outbound_date?, expected_return_date?,
      //                     leg_hint? }
      const { image_base64, mime_type, context } = body;
      if (!image_base64 || typeof image_base64 !== 'string') {
        return jsonResponse(
          { error: 'image_base64 requis (base64 de la capture)' },
          400
        );
      }
      const mime = typeof mime_type === 'string' ? mime_type : 'image/png';
      const ctxAdults = Number(context?.adults) || 0;
      const ctxChildren = Number(context?.children) || 0;
      const expectedPax = ctxAdults + ctxChildren;
      const originHint = context?.origin_hint || '(inconnu)';
      const destHint = context?.destination_hint || '(inconnu)';
      const expOutDate = context?.expected_outbound_date || '';
      const expRetDate = context?.expected_return_date || '';
      const legHint = context?.leg_hint || '';

      const datesBlock =
        expOutDate || expRetDate
          ? `\n- Dates prévues du voyage par l'utilisateur :\n` +
            (expOutDate ? `    * ALLER prévu le ${expOutDate}\n` : '') +
            (expRetDate ? `    * RETOUR prévu le ${expRetDate}\n` : '') +
            `  → Si les dates ne sont PAS visibles sur la capture (cas fréquent sur Skyscanner : la date est dans la barre de recherche en haut, pas sur chaque vignette de vol), utilise ces dates prévues pour remplir departure_at / arrival_at.`
          : '';
      const legBlock = legHint
        ? `\n- Cette capture concerne probablement le vol ${legHint === 'return' ? 'RETOUR' : 'ALLER'} (l'utilisateur l'a explicitement signalé).`
        : '';

      const prompt = `Tu es un extracteur d'informations de vols à partir d'une capture d'écran de comparateur de vols (Google Flights, Skyscanner, Kayak, Booking flights, etc.).

CONTEXTE :
- Voyage probable depuis "${originHint}" vers "${destHint}".
- Nombre de voyageurs prévus dans l'itinéraire : ${expectedPax > 0 ? `${expectedPax} (${ctxAdults} adulte(s) + ${ctxChildren} enfant(s))` : '(non précisé)'}.${datesBlock}${legBlock}

INSTRUCTIONS — extrais avec PRÉCISION depuis l'image :

- "is_round_trip" : true si la capture montre un vol aller-retour (présence de deux segments distincts dans des sens opposés), false si aller simple.
- "passengers_total" : nombre total de voyageurs visible sur la capture (souvent affiché en haut, ex : "3 voyageurs"). Si absent, mets ${expectedPax || 1}.
- "total_price_eur" : prix TOTAL pour TOUS les voyageurs ET TOUS les segments du vol. EN EUROS.
  * Si la capture affiche un prix PAR PERSONNE, multiplie par passengers_total et signale-le dans extraction_note.
  * Si la devise n'est pas l'euro, convertis grossièrement (1 USD ≈ 0,92 €, 1 GBP ≈ 1,17 €, 1 CAD ≈ 0,68 €, 1 CHF ≈ 1,05 €, 1 JPY ≈ 0,006 €) et précise dans extraction_note.
- "currency_detected" : devise détectée sur la capture (ex : "EUR", "USD", "CAD").
- "outbound" : objet pour le vol ALLER avec :
    * "airline" : nom complet de la compagnie (ex : "Air Canada", "Air France")
    * "airline_code" : code IATA 2 lettres (ex : "AC", "AF")
    * "flight_number" : numéro de vol (sans le code compagnie, ex : "871")
    * "origin_iata" : code IATA 3 lettres de l'aéroport de départ (ex : "MRS", "CDG", "JFK")
    * "destination_iata" : code IATA 3 lettres de l'aéroport d'arrivée
    * "departure_at" : date + heure LOCALE de départ au format "YYYY-MM-DDTHH:MM:SS". Si la date n'est PAS visible sur la capture, utilise la date prévue par l'utilisateur (voir CONTEXTE ci-dessus). N'invente JAMAIS une date arbitraire (1970, aujourd'hui, etc.).
    * "arrival_at" : date + heure LOCALE d'arrivée au format "YYYY-MM-DDTHH:MM:SS". Pareil : si pas visible, utilise la date prévue + ajoute la durée du vol si tu peux la lire (ex : 13h40 affiché → arrivée = départ + 13h40). Si vol >12h, peut tomber le lendemain (utilise YYYY-MM-DD du lendemain).
    * "stops" : nombre d'escales (0 si vol direct)
- "return" : même structure que outbound pour le vol RETOUR. null si is_round_trip = false.
- "extraction_note" : notes/warnings (1-2 phrases) si tu as fait des conversions de devise, dû deviner certaines infos, ou si la capture est ambiguë.

Règles spéciales :
- Si plusieurs vols sont visibles sur la capture (liste de résultats), prends le PREMIER (le moins cher / mis en avant).
- Si les codes IATA ne sont pas affichés mais que les noms de ville le sont, déduis le code (Marseille → MRS, Paris (CDG/ORY) → préfère CDG, New York (JFK/EWR/LGA) → préfère JFK, Montréal → YUL, Toronto → YYZ, Vancouver → YVR, Tokyo → HND ou NRT selon ce qui est marqué).
- Les heures sont en HEURE LOCALE de l'aéroport correspondant (par convention universelle des comparateurs).
- Si vol multi-segments avec escales, "departure_at" = heure du PREMIER segment, "arrival_at" = heure du DERNIER segment (arrivée finale).

Renvoie UNIQUEMENT du JSON valide (rien autour) selon ce schéma :

{
  "is_round_trip": true,
  "passengers_total": 3,
  "total_price_eur": 2120,
  "currency_detected": "EUR",
  "outbound": {
    "airline": "Air Canada",
    "airline_code": "AC",
    "flight_number": "871",
    "origin_iata": "MRS",
    "destination_iata": "YUL",
    "departure_at": "2026-09-07T13:15:00",
    "arrival_at": "2026-09-07T15:30:00",
    "stops": 1
  },
  "return": null,
  "extraction_note": ""
}

Si tu ne reconnais PAS un vol exploitable (capture floue, écran d'erreur, page non-liée), renvoie :
{ "outbound": null, "extraction_note": "L'image ne contient pas d'informations de vol exploitables." }`;

      try {
        const { text, usage, modelUsed } = await callVisionLLM(
          prompt,
          image_base64,
          mime,
          2500
        );
        const parsed = await parseOrRepair(text, async (p, t) => {
          return await callExpansion(p, t);
        });
        return jsonResponse({ flight: parsed, usage, model: modelUsed });
      } catch (e) {
        console.error('[extract-flight-from-image] error:', e);
        return jsonResponse(
          { error: (e as Error).message || 'Extraction échouée' },
          500
        );
      }
    }

    if (mode === 'extract-hotel-from-image') {
      // Body :
      //   image_base64    base64 sans préfixe data: (juste les caractères)
      //   mime_type       'image/png' | 'image/jpeg' | 'image/webp'
      //   context         { day_location?, current_hotel_name?, currency? }
      const { image_base64, mime_type, context } = body;
      if (!image_base64 || typeof image_base64 !== 'string') {
        return jsonResponse(
          { error: 'image_base64 requis (base64 de la capture)' },
          400
        );
      }
      const mime = typeof mime_type === 'string' ? mime_type : 'image/png';
      const ctxLocation = context?.day_location || '(lieu non précisé)';
      const ctxCurrent = context?.current_hotel_name || '(non spécifié)';
      const isVoucher = context?.is_voucher === true;

      const prompt = `Tu es un extracteur d'informations hôtel à partir d'${isVoucher ? 'un voucher / une confirmation de réservation (PDF converti en image)' : "une capture d'écran d'un site de réservation (Booking, Hotels.com, Airbnb, etc.)"}.

CONTEXTE :
- Le voyageur cherche un hébergement à ${ctxLocation}.
- L'hôtel actuellement proposé dans l'itinéraire est : "${ctxCurrent}" (sera remplacé par celui que tu extrais).${
        isVoucher
          ? `\n- Ce document est une CONFIRMATION DÉJÀ RÉSERVÉE : le prix indiqué est le prix RÉEL PAYÉ. Si c'est un total pour plusieurs nuits, repère les dates d'arrivée et de départ pour calculer le nombre de nuits et diviser → price_per_night_eur. Indique le total et le nb de nuits dans extraction_note.`
          : ''
      }

INSTRUCTIONS — extrais avec PRÉCISION depuis l'image :
- "name" : nom EXACT de l'hôtel tel qu'écrit (sans abréviation).
- "type" : type d'hébergement et catégorie ★ si visible (ex : "Hôtel 4★", "Appart-hôtel 3★", "Auberge", "Maison d'hôtes").
- "price_per_night_eur" : prix par nuit EN EUROS. Si la devise affichée n'est pas l'euro, convertis grossièrement (1 USD ≈ 0,92 €, 1 GBP ≈ 1,17 €, 1 CAD ≈ 0,68 €, 1 CHF ≈ 1,05 €, 1 JPY ≈ 0,006 €). Si le prix affiché est un total séjour, divise par le nombre de nuits si tu peux le déduire de l'image, sinon laisse null et précise dans extraction_note.
- "currency_detected" : devise détectée sur la capture (ex : "EUR", "USD", "CAD"…).
- "rating" : note sur 10 ou sur 5 (si sur 5, multiplie par 2 pour la mettre sur 10). Sinon null.
- "rating_count" : nombre d'avis si visible. Sinon null.
- "services" : tableau des équipements/services majeurs visibles (ex : ["WiFi gratuit", "Petit-déjeuner inclus", "Climatisation", "Piscine", "Parking", "Animaux acceptés", "Accessible PMR"]). Maximum 8, en français.
- "address_hint" : indication de quartier / adresse / repère géographique si visible (ex : "Centre-ville", "Près de la Sagrada Familia", "À 5 min du métro"). Sinon null.
- "booking_url" : URL visible ou identifiant de l'annonce si présent (ex : nom de domaine "booking.com"). Sinon null.
- "extraction_note" : courte note (1-2 phrases) si certaines infos n'ont pas pu être extraites avec certitude (ex : "Prix affiché en USD converti à 0.92, vérifiez le taux du jour"). Sinon chaîne vide.

Renvoie UNIQUEMENT du JSON valide selon ce schéma (rien d'autre, pas de markdown, pas de texte autour) :
{
  "name": "...",
  "type": "...",
  "price_per_night_eur": 165,
  "currency_detected": "EUR",
  "rating": 8.4,
  "rating_count": 2228,
  "services": ["..."],
  "address_hint": "...",
  "booking_url": null,
  "extraction_note": ""
}

Si tu ne reconnais PAS un hôtel dans l'image (capture floue, page d'erreur, photo non liée), renvoie :
{ "name": null, "extraction_note": "L'image ne contient pas d'informations d'hôtel exploitables." }`;

      try {
        const { text, usage, modelUsed } = await callVisionLLM(
          prompt,
          image_base64,
          mime,
          2000
        );
        const parsed = await parseOrRepair(text, async (p, t) => {
          // pas de retry vision pour la réparation : on garde l'appel texte
          return await callExpansion(p, t);
        });
        return jsonResponse({ hotel: parsed, usage, model: modelUsed });
      } catch (e) {
        console.error('[extract-hotel-from-image] error:', e);
        return jsonResponse(
          { error: (e as Error).message || 'Extraction échouée' },
          500
        );
      }
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

    if (mode === 'check-gyg-availability') {
      const { activityTitle, location } = body;
      if (!activityTitle || typeof activityTitle !== 'string') {
        return jsonResponse(
          { error: 'Paramètre "activityTitle" requis.' },
          400
        );
      }
      try {
        const query = `${activityTitle}${location ? ' ' + location : ''}`;
        const url = `https://www.getyourguide.fr/s/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: {
            // User-Agent classique pour ne pas être bloqué
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
          },
          // Pas de redirect manuel — Cloudflare/GYG peut renvoyer 301/302
          redirect: 'follow',
        });
        if (!res.ok) {
          // En cas d'erreur réseau / blocage, on retourne null pour que
          // le frontend retombe sur l'heuristique (mieux vaut afficher
          // qu'un faux négatif).
          console.warn(`[gyg-availability] "${query}" HTTP ${res.status}`);
          return jsonResponse({ available: null });
        }
        const html = await res.text();
        // Indicateurs de "pas de résultats" :
        // - GYG affiche "no result", "aucun résultat" selon la langue
        // - Bloc spécifique "data-track-id="no-results"" ou similaire
        // - Page redirigée vers l'accueil (très peu de contenu activité)
        const lowered = html.toLowerCase();
        const noResultsIndicators = [
          'aucun résultat',
          'aucun resultat',
          'no results',
          "we couldn't find",
          'nous n\'avons trouvé aucune',
          'data-track-id="no-results"',
        ];
        const hasNoResults = noResultsIndicators.some((p) =>
          lowered.includes(p)
        );
        if (hasNoResults) {
          return jsonResponse({ available: false });
        }
        // Indicateur positif : présence de cartes d'activités.
        // GYG utilise différentes classes selon les versions ; on en
        // teste plusieurs pour rester robuste.
        const resultIndicators = [
          'activity-card',
          'tour-card',
          'data-test-id="search-result"',
          'data-test-id="activity-card"',
          'class="activity-tile',
          'href="/-/t', // les pages d'activités ont des URL "/-/t<ID>"
          '/activity/',
        ];
        const hasResults = resultIndicators.some((p) => lowered.includes(p));
        return jsonResponse({ available: hasResults });
      } catch (e) {
        console.error('[gyg-availability] crash', e);
        return jsonResponse({ available: null });
      }
    }

    if (mode === 'fetch-hotel-rating') {
      const { hotelName, location } = body;
      if (!hotelName || typeof hotelName !== 'string') {
        return jsonResponse({ error: 'Paramètre "hotelName" requis.' }, 400);
      }
      if (!GOOGLE_PLACES_API_KEY) {
        return jsonResponse({ rating: null, reason: 'no_google_key' });
      }
      try {
        const textQuery = `${hotelName}${location ? ' ' + location : ''}`;
        const res = await fetch(
          'https://places.googleapis.com/v1/places:searchText',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
              'X-Goog-FieldMask':
                'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel',
            },
            body: JSON.stringify({
              textQuery,
              languageCode: 'fr',
              maxResultCount: 1,
              includedType: 'lodging',
            }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          console.warn(
            `[hotel-rating] "${textQuery}" ${res.status} ${txt.slice(0, 200)}`
          );
          return jsonResponse({ rating: null });
        }
        const data = await res.json();
        const place = data?.places?.[0];
        if (!place) {
          return jsonResponse({ rating: null });
        }
        return jsonResponse({
          rating: place.rating || null,
          userRatingCount: place.userRatingCount || 0,
          googleMapsUri: place.googleMapsUri || null,
          matchedName: place.displayName?.text || null,
        });
      } catch (e) {
        console.error('[hotel-rating] crash', e);
        return jsonResponse({ rating: null });
      }
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
      // Tokens augmentés (2500) pour pouvoir aussi régénérer les moments impactés.
      const { text, usage, modelUsed } = await callExpansion(prompt, 2500);
      const parsed = await parseOrRepair(text, callExpansionSafe);
      // Le schéma renvoie maintenant { activity, moments_update }. Robustesse :
      // si l'IA renvoie directement l'activité (cas legacy), on l'enveloppe.
      const activity = parsed?.activity || parsed;
      const momentsUpdate = parsed?.moments_update || null;
      return jsonResponse({
        activity,
        moments_update: momentsUpdate,
        usage,
        model: modelUsed,
      });
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

    if (mode === 'autocomplete-place') {
      const { query, session_token } = body;
      if (!query || typeof query !== 'string' || query.trim().length < 3) {
        return jsonResponse({ predictions: [] });
      }

      // === Tentative 1 : Google Places Autocomplete ===
      let predictions: any[] = [];
      if (GOOGLE_PLACES_API_KEY) {
        try {
          const res = await fetch(
            'https://places.googleapis.com/v1/places:autocomplete',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
              },
              body: JSON.stringify({
                input: query,
                languageCode: 'fr',
                sessionToken: session_token || undefined,
              }),
            }
          );
          if (res.ok) {
            const data = await res.json();
            predictions = (data?.suggestions || [])
              .filter((s: any) => s.placePrediction)
              .slice(0, 6)
              .map((s: any) => ({
                place_id: s.placePrediction.placeId,
                text: s.placePrediction.text?.text || '',
                main_text:
                  s.placePrediction.structuredFormat?.mainText?.text || '',
                secondary_text:
                  s.placePrediction.structuredFormat?.secondaryText?.text || '',
                source: 'google',
              }));
          } else {
            const txt = await res.text();
            console.warn(`[autocomplete google] ${res.status} ${txt.slice(0, 200)}`);
          }
        } catch (e) {
          console.warn('[autocomplete google] crash', e);
        }
      }

      // === Tentative 2 : Nominatim fallback (gratuit, sans clé) ===
      if (predictions.length === 0) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
            query
          )}&format=json&limit=6&accept-language=fr&addressdetails=1`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'TravelO/1.0 (travelo.app)' },
          });
          if (res.ok) {
            const data = await res.json();
            predictions = (Array.isArray(data) ? data : [])
              .slice(0, 6)
              .map((r: any) => {
                const a = r.address || {};
                const main =
                  a.city || a.town || a.village || a.municipality ||
                  a.county || r.name || (r.display_name || '').split(',')[0];
                const secondaryParts = [
                  a.state || a.region,
                  a.country,
                ].filter(Boolean);
                return {
                  place_id: r.place_id ? String(r.place_id) : null,
                  text: r.display_name || main,
                  main_text: main,
                  secondary_text: secondaryParts.join(', '),
                  source: 'nominatim',
                };
              });
          } else {
            console.warn(`[autocomplete nominatim] ${res.status}`);
          }
        } catch (e) {
          console.warn('[autocomplete nominatim] crash', e);
        }
      }

      return jsonResponse({ predictions });
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

      // Pipeline anti-hallucination : Google Places source de vérité,
      // LLM seulement pour enrichir (interdit d'inventer).
      if (!GOOGLE_PLACES_API_KEY) {
        return jsonResponse(
          {
            error:
              'GOOGLE_PLACES_API_KEY non configuré côté serveur (requis pour ne pas inventer de lieux).',
          },
          500
        );
      }

      // 1) Géocodage du lieu (texte → lat/lng)
      const coords = await geocodePlace(location);
      if (!coords) {
        return jsonResponse(
          {
            error: `Impossible de trouver "${location}" sur la carte. Essaie un format comme "13122 Ventabren", "Aix-en-Provence", ou ajoute le pays (ex: "Ventabren France").`,
          },
          400
        );
      }

      // 2) Recherche de lieux RÉELS dans le rayon, filtrés par types
      const radiusKm = Number(radius_km) || 30;
      const places = await searchRealPlaces({
        centerLat: coords.lat,
        centerLng: coords.lng,
        radiusKm,
        types: Array.isArray(types) ? types : [],
        excludeIds: Array.isArray(exclude) ? exclude : [],
        withKids: !!with_kids,
      });

      // 3) Si rien trouvé : on renvoie vide (préférable aux hallucinations)
      if (places.length === 0) {
        return jsonResponse({ activities: [], usage: null, model: null });
      }

      // 4) Enrichissement LLM (hook + description) — il ne peut RIEN inventer
      const prompt = buildEnrichRealActivitiesPrompt({
        places,
        location,
        rainyOnly: !!rainy_only,
        withKids: !!with_kids,
      });
      const { text, usage, modelUsed } = await callMain(prompt, 4000);
      const parsed = await parseOrRepair(text, callMainSafe);
      const enrichments = Array.isArray(parsed?.activities)
        ? parsed.activities
        : [];

      // 5) Fusion : on combine les données Google (sûres) + enrichissement LLM
      const activities = places.map((p, i) => {
        const enrich =
          enrichments.find((e: any) => e.index === i) || enrichments[i] || {};
        return {
          id: p.id, // Place ID Google, stable et unique
          title: p.displayName?.text || 'Lieu sans nom',
          type: enrich.type || 'culture',
          hook: enrich.hook || '',
          description:
            enrich.description ||
            p.editorialSummary?.text ||
            'Lieu référencé sur Google Maps.',
          address: p.formattedAddress || '',
          distance_km: p._distance_km,
          coordinates: {
            lat: p.location?.latitude,
            lng: p.location?.longitude,
          },
          indoor: enrich.indoor ?? false,
          duration: enrich.duration || '1-2h',
          price_eur_per_person: 0,
          price_note: enrich.price_note || '',
          best_time: enrich.best_time || 'toute la journée',
          booking_hint: null,
          photo_query: p.displayName?.text || '',
          // Données Google enrichies (vraies sources)
          rating: p.rating || null,
          user_ratings_count: p.userRatingCount || null,
          website_url: p.websiteUri || null,
          google_maps_url: p.googleMapsUri || null,
        };
      });

      return jsonResponse({
        activities,
        usage,
        model: modelUsed,
        geocoded: coords.formattedAddress,
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
      // Récupère le vol réel pour caler J1 et J_final et le transmettre
      // ensuite via day_plans[..]._flight_outbound / _flight_return.
      let flightData = await resolveFlightData(preferences);
      let prompt = buildPlanPrompt(preferences);
      if (flightData) {
        prompt += `\n\n${formatFlightBlockForPrompt(flightData, preferences)}`;
      } else {
        // Anti-hallucination : l'IA ne doit PAS inventer de prix de vol.
        prompt += `\n\n${buildNoFlightDataNotice()}`;
      }
      // 32000 tokens : Gemini "thinking" peut en consommer une partie,
      // le reste doit suffire pour summary + 30+ day_plans + notes complètes
      // (packing list + phrases + tips). Gemini Flash supporte jusqu'à 65k.
      const { text, usage, modelUsed } = await callMain(prompt, 32000);
      const plan = await parseOrRepair(text, callMainSafe);
      // Filet de sécurité : si l'IA a quand même ajouté une jambe de vol
      // dans day_plans (typique sur "Itinérant" longue distance), on retape
      // le fournisseur pour récupérer une vraie cotation.
      if (!flightData && plan?.day_plans?.length) {
        // On construit un faux "itinerary" en synthèse pour réutiliser
        // recoverFlightDataIfNeeded — chaque day_plan a peut-être un trip avion.
        const fakeItinerary = {
          days: plan.day_plans.map((dp: any) => ({
            trips: dp.transport_summary?.toLowerCase().includes('avion')
              ? [{ mode: 'Avion' }]
              : [],
          })),
        };
        flightData = await recoverFlightDataIfNeeded(fakeItinerary, preferences);
      }
      // Injecte les données vol dans le plan : summary (pour le frontend)
      // ET dans day_plans[0]/last (pour expand-day, qui les recevra via dayPlan)
      if (flightData && plan && Array.isArray(plan.day_plans) && plan.day_plans.length) {
        const isRoundTrip =
          !preferences.returnLocation ||
          preferences.returnLocation === preferences.departureLocation;
        const legs = splitFlightForLegs(flightData, isRoundTrip, preferences);
        if (!plan.summary) plan.summary = {};
        const pax =
          (Number(preferences.adults) || 1) +
          (Array.isArray(preferences.childrenAges) ? preferences.childrenAges.length : 0);
        plan.summary.flight_data = {
          airline: flightData.airline,
          flight_number: flightData.flight_number,
          origin_iata: flightData.origin_iata,
          destination_iata: flightData.destination_iata,
          total_price_eur: legs.total,
          outbound_price_eur: legs.outbound.cost,
          return_price_eur: legs.returnLeg?.cost || 0,
          departure_at: flightData.departure_at,
          return_at: flightData.return_at,
          deeplink: flightData.deeplink || null,
          source: flightData.source,
          per_person_eur: pax > 0 ? Math.round(legs.total / pax) : legs.total,
        };
        plan.day_plans[0]._flight_outbound = legs.outbound;
        if (legs.returnLeg) {
          plan.day_plans[plan.day_plans.length - 1]._flight_return =
            legs.returnLeg;
        }
      }
      // Fallback : si pas de prix Travelpayouts, on génère au moins les
      // deeplinks et on les attache aux day_plans (transmis ensuite à
      // expand-day, qui les posera sur les trips "Avion" du jour).
      const dlPair = await resolveDeeplinkPair(preferences);
      if (dlPair && Array.isArray(plan?.day_plans) && plan.day_plans.length) {
        if (!plan.summary) plan.summary = {};
        plan.summary.flight_data = {
          ...(plan.summary.flight_data || {}),
          origin_iata:
            plan.summary.flight_data?.origin_iata || dlPair.origin_iata,
          destination_iata:
            plan.summary.flight_data?.destination_iata ||
            dlPair.destination_iata,
          deeplink:
            plan.summary.flight_data?.deeplink || dlPair.outbound_deeplink,
          outbound_deeplink: dlPair.outbound_deeplink,
          return_deeplink: dlPair.return_deeplink,
        };
        plan.day_plans[0]._aviasales_outbound_deeplink = dlPair.outbound_deeplink;
        if (dlPair.return_deeplink) {
          plan.day_plans[plan.day_plans.length - 1]._aviasales_return_deeplink =
            dlPair.return_deeplink;
        }
      }
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
      let prompt = buildExpandPrompt(
        preferences,
        day_plan,
        previous_plan,
        next_plan
      );
      // Si ce jour porte une jambe de vol (transmise via plan-trip),
      // on l'injecte dans le prompt pour caler les horaires.
      if (day_plan._flight_outbound) {
        prompt += `\n\n${formatFlightLegForPrompt(day_plan._flight_outbound, 'aller')}`;
      }
      if (day_plan._flight_return) {
        prompt += `\n\n${formatFlightLegForPrompt(day_plan._flight_return, 'retour')}`;
      }
      // Expansion backend : Gemini 2.5 Flash si configuré, sinon Haiku
      const { text, usage, modelUsed } = await callExpansion(prompt, 6000);
      let day = await parseOrRepair(text, callExpansionSafe);
      // Post-traitement : injecte physiquement le trip "Avion" et ajuste
      // day_total_eur pour qu'il apparaisse dans le budget (le frontend
      // recalcule trips_eur en sommant les trips de chaque jour).
      if (day_plan._flight_outbound) {
        day = enrichDayWithFlightLeg(day, day_plan._flight_outbound, 'aller');
      }
      if (day_plan._flight_return) {
        day = enrichDayWithFlightLeg(day, day_plan._flight_return, 'retour');
      }
      // Fallback deeplink : attache le lien Aviasales aux trips "Avion" du
      // jour même si on n'a pas pu enrichir avec un prix (transmis depuis
      // plan-trip via day_plan._aviasales_*_deeplink).
      if (day_plan._aviasales_outbound_deeplink) {
        day = attachDeeplinkToDayTrips(
          day,
          day_plan._aviasales_outbound_deeplink,
          'outbound'
        );
      }
      if (day_plan._aviasales_return_deeplink) {
        day = attachDeeplinkToDayTrips(
          day,
          day_plan._aviasales_return_deeplink,
          'return'
        );
      }
      // Vols INTERNES sur cette journée : si l'IA a placé un trip Avion
      // qui n'est ni l'aller J1 ni le retour J_final (cas typique : vol
      // interne dans un tour multi-villes), on retape le fournisseur.
      const wrapped = { days: [day], budget_summary: {} };
      await enrichInternalFlights(wrapped, preferences);
      day = wrapped.days[0];
      // Garde-fou prix unitaire / total famille (s'applique aussi à un jour seul)
      fixPerPersonFlightCosts({ days: [day] }, preferences);
      return jsonResponse({ day, usage, model: modelUsed });
    }

    // Default : full single-call generation (small trips ≤ 8 days)
    const preferences = body?.preferences;
    if (!preferences?.destinations || !preferences?.startDate) {
      return jsonResponse({ error: 'preferences invalides' }, 400);
    }
    // Récupère le vol réel (Travelpayouts ou Duffel, selon app_config) avant
    // d'appeler le LLM, pour le briefer dans le prompt avec des horaires/prix exacts.
    let flightData = await resolveFlightData(preferences);
    let userPrompt = buildFullPrompt(preferences);
    if (flightData) {
      userPrompt += `\n\n${formatFlightBlockForPrompt(flightData, preferences)}`;
    } else {
      // Anti-hallucination : l'IA ne doit PAS inventer de prix de vol.
      userPrompt += `\n\n${buildNoFlightDataNotice()}`;
    }
    // Budget large : un voyage 8 jours détaillé peut atteindre 20k tokens.
    const { text, usage, modelUsed } = await callMain(userPrompt, 24000);
    let itinerary = await parseOrRepair(text, callMainSafe);
    // Filet de sécurité : si l'IA a quand même placé un vol dans l'itinéraire
    // (cas typique : tripType "Itinérant" avec destination lointaine), on
    // retape le fournisseur pour remplacer le prix halluciné.
    if (!flightData) {
      flightData = await recoverFlightDataIfNeeded(itinerary, preferences);
    }
    // Post-traitement : injecte physiquement les trips "Vol" et recalcule
    // les totaux, pour garantir l'affichage côté frontend.
    if (flightData) {
      itinerary = enrichItineraryWithFlight(itinerary, flightData, preferences);
    }
    // Vols INTERNES : si l'IA a posé d'autres trips Avion au milieu de
    // l'itinéraire (ex : tour d'Asie Tokyo → Séoul à J5), on retape le
    // fournisseur pour chacun et on remplace les prix hallucinés.
    itinerary = await enrichInternalFlights(itinerary, preferences);
    // Fallback : attache un deeplink Aviasales aux trips "Avion" même si
    // on n'a pas trouvé de prix (le bouton "Réserver" reste utilisable).
    const deeplinkPair = await resolveDeeplinkPair(preferences);
    if (deeplinkPair) {
      itinerary = attachDeeplinksToTrips(itinerary, deeplinkPair);
    }
    // Garde-fou : corrige les vols dont le LLM aurait mis le prix par
    // personne au lieu du total famille.
    itinerary = fixPerPersonFlightCosts(itinerary, preferences);
    return jsonResponse({ itinerary, usage, model: modelUsed });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || String(err) },
      500
    );
  }
});
