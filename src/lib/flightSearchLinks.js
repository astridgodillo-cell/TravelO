// Constructeurs d'URL pré-remplies vers les comparateurs de vols.
// Skyscanner = provider prioritaire (objectif partenariat).
// Google Flights et Aviasales restent supportés en alternative.
//
// Toutes les fonctions prennent le même contrat :
//   { originIata, destIata, departDate (YYYY-MM-DD),
//     returnDate (YYYY-MM-DD|null), adults, childrenCount,
//     infantsCount, directOnly }
// et retournent une URL absolue.

function toYYMMDD(iso) {
  if (!iso || iso.length < 10) return '';
  return iso.substring(2, 4) + iso.substring(5, 7) + iso.substring(8, 10);
}

// Skyscanner FR — URL de recherche directe avec dates pré-remplies.
// Format moderne (paramètres v2) observé sur skyscanner.fr :
//   /transport/vols/{ori}/{dst}/{yymmdd-aller}/{yymmdd-retour}/
//     ?adultsv2=N&childrenv2=AGE1,AGE2&infantsv2=&cabinclass=economy&rtn=1
// Codes IATA en minuscules. Si returnDate vide → one-way + rtn=0.
// childrenAges = tableau d'âges (Skyscanner exige les âges, pas un compte).
export function buildSkyscannerUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenAges,
  infantsAges,
  directOnly,
}) {
  const ori = String(originIata || '').toLowerCase();
  const dst = String(destIata || '').toLowerCase();
  if (!ori || !dst || !departDate) return null;
  const a = Math.max(1, Number(adults) || 1);
  const ages = Array.isArray(childrenAges) ? childrenAges.filter((x) => Number.isFinite(Number(x))) : [];
  const infants = Array.isArray(infantsAges) ? infantsAges.filter((x) => Number.isFinite(Number(x))) : [];
  const dep = toYYMMDD(departDate);
  let path = `/transport/vols/${ori}/${dst}/${dep}/`;
  if (returnDate) {
    path += `${toYYMMDD(returnDate)}/`;
  }
  const params = new URLSearchParams();
  params.set('adultsv2', String(a));
  params.set('childrenv2', ages.length > 0 ? ages.map(String).join(',') : '');
  params.set('infantsv2', infants.length > 0 ? infants.map(String).join(',') : '');
  params.set('cabinclass', 'economy');
  params.set('preferdirects', directOnly ? 'true' : 'false');
  params.set('rtn', returnDate ? '1' : '0');
  return `https://www.skyscanner.fr${path}?${params.toString()}`;
}

// Skyscanner — page "route" SANS dates fixes : Skyscanner affiche alors un
// CALENDRIER des prix par jour (idéal pour trouver les dates les moins chères).
// Origine/destination/voyageurs sont pré-remplis ; l'utilisateur explore les
// dates. Codes IATA en minuscules.
export function buildSkyscannerExploreUrl({
  originIata,
  destIata,
  adults,
  childrenAges,
}) {
  const ori = String(originIata || '').toLowerCase();
  const dst = String(destIata || '').toLowerCase();
  if (!ori || !dst) return null;
  const a = Math.max(1, Number(adults) || 1);
  const ages = Array.isArray(childrenAges)
    ? childrenAges.filter((x) => Number.isFinite(Number(x)))
    : [];
  const params = new URLSearchParams();
  params.set('adultsv2', String(a));
  params.set('childrenv2', ages.length > 0 ? ages.map(String).join(',') : '');
  params.set('cabinclass', 'economy');
  params.set('rtn', '1');
  return `https://www.skyscanner.fr/transport/vols/${ori}/${dst}/?${params.toString()}`;
}

// Skyscanner multi-villes (open-jaw) — IMPORTANT : Skyscanner n'expose pas
// d'URL deep-link fiable pour la recherche multi-villes (testé : la page
// renvoie "Cette page n'existe pas"). On retourne null pour signaler aux
// callers qu'ils doivent utiliser une stratégie de fallback : ouvrir
// chaque segment comme aller-simple et instruire l'utilisateur de
// combiner manuellement dans l'UI Skyscanner.
export function buildSkyscannerMultiCityUrl() {
  return null;
}

// Google Flights — IMPORTANT : les formats d'URL deep-link de Google
// Flights changent fréquemment et ne sont pas documentés. Les formats
// historiquement utilisés (q=langage naturel, #flt=ORI.DST.DATE…) ne
// pré-remplissent plus la recherche (testé en live 2026).
//
// On ouvre donc la page d'accueil Google Flights en EUR/FR — l'utilisateur
// devra recopier ses critères. Un panneau d'instructions dans le wizard
// affiche les infos prêtes à recopier (origine, destination, dates, pax).
function buildGoogleFlightsHomepageUrl() {
  return 'https://www.google.com/travel/flights?hl=fr&curr=EUR&gl=FR';
}

export function buildGoogleFlightsUrl({
  originIata,
  destIata,
  departDate,
}) {
  if (!originIata || !destIata || !departDate) return null;
  return buildGoogleFlightsHomepageUrl();
}

export function buildGoogleFlightsMultiCityUrl({ segments }) {
  if (!Array.isArray(segments) || segments.length < 2) return null;
  return buildGoogleFlightsHomepageUrl();
}

// Aviasales (deeplink natif Travelpayouts) — format compact :
//   /search/{ORI}{DD}{MM}{DST}{DD2}{MM2}{pax}
export function buildAviasalesUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenAges,
}) {
  if (!originIata || !destIata || !departDate) return null;
  const ori = String(originIata).toUpperCase();
  const dst = String(destIata).toUpperCase();
  const dd1 = departDate.substring(8, 10);
  const mm1 = departDate.substring(5, 7);
  let segment = `${ori}${dd1}${mm1}${dst}`;
  if (returnDate) {
    const dd2 = returnDate.substring(8, 10);
    const mm2 = returnDate.substring(5, 7);
    segment += `${dd2}${mm2}`;
  }
  const a = Math.max(1, Number(adults) || 1);
  const c = Array.isArray(childrenAges) ? childrenAges.length : 0;
  const pax = `${a}${c > 0 ? c : ''}`;
  return `https://www.aviasales.com/search/${segment}${pax}?currency=eur&locale=fr`;
}

// Méta des providers — Skyscanner en premier (priorité partenariat).
// buildMultiCityUrl peut être null si le provider ne supporte pas (fallback
// vers une recherche aller simple sur le premier segment côté UI).
export const FLIGHT_SEARCH_PROVIDERS = [
  {
    id: 'skyscanner',
    label: 'Skyscanner',
    short: 'Skyscanner',
    buildUrl: buildSkyscannerUrl,
    buildMultiCityUrl: buildSkyscannerMultiCityUrl,
    btnClass: 'bg-blue-600 hover:bg-blue-700',
    accent: 'sky',
  },
  {
    id: 'google',
    label: 'Google Flights',
    short: 'Google Flights',
    buildUrl: buildGoogleFlightsUrl,
    buildMultiCityUrl: buildGoogleFlightsMultiCityUrl,
    btnClass: 'bg-slate-700 hover:bg-slate-800',
    accent: 'slate',
  },
  {
    id: 'aviasales',
    label: 'Aviasales',
    short: 'Aviasales',
    buildUrl: buildAviasalesUrl,
    buildMultiCityUrl: null,
    btnClass: 'bg-emerald-600 hover:bg-emerald-700',
    accent: 'emerald',
  },
];

export function getProvider(id) {
  return (
    FLIGHT_SEARCH_PROVIDERS.find((p) => p.id === id) ||
    FLIGHT_SEARCH_PROVIDERS[0]
  );
}

// Si le texte contient un code IATA à 3 lettres MAJ entre parenthèses
// (ex: "Montréal (YUL)" ou "Marseille (MRS)"), on l'extrait directement.
// Pratique quand l'utilisateur clique sur une vignette ville-aéroport ou
// quand il copie-colle une suggestion de l'app.
function extractParensIata(text) {
  if (!text) return null;
  const m = String(text).match(/\(([A-Z]{3})\)/);
  if (!m) return null;
  const code = m[1];
  // Nom = ce qui précède la parenthèse, trimé
  const name = String(text).replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
  return { code, name: name || code, type: 'airport' };
}

// Helper sync (pas d'appel API) pour extraire un code IATA depuis un texte
// de type "Bogotá (BOG)" ou "BOG" directement. Renvoie '' si rien de
// reconnaissable. Insensible à la casse pour les parenthèses.
export function extractIataSync(text) {
  if (!text) return '';
  const s = String(text).trim();
  // 1. Code à 3 lettres entre parenthèses (insensible casse)
  const m = s.match(/\(([A-Za-z]{3})\)/);
  if (m) return m[1].toUpperCase();
  // 2. La chaîne est déjà un code IATA à 3 lettres seul
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  return '';
}

// Résolution ville → code IATA via l'autocomplete Travelpayouts (public,
// pas de token). On préfère "city" pour avoir le code metropolitan qui
// regroupe tous les aéroports d'une ville.
export async function resolveIata(query) {
  if (!query || !query.trim()) return null;
  // Short-circuit : code IATA déjà présent entre parenthèses
  const direct = extractParensIata(query);
  if (direct) return direct;
  // Sinon, on retire d'éventuelles parenthèses (notes du genre "Paris (CDG)")
  // pour ne garder que la partie ville, plus reconnaissable par l'autocomplete.
  const cleaned = String(query).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const term = cleaned || query;
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(
      term
    )}&locale=fr&types[]=city&types[]=airport&types[]=country`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    if (arr[0].type === 'country') {
      return { country: true, name: arr[0].name, code: arr[0].code };
    }
    const city = arr.find((p) => p.type === 'city');
    const pick = city || arr[0];
    return { code: pick.code, name: pick.name, type: pick.type };
  } catch (e) {
    console.warn('[flightSearchLinks] resolveIata failed', e);
    return null;
  }
}
