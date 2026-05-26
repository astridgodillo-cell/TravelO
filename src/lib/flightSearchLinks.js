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
// Format documenté (observé sur skyscanner.fr/transport/vols/) :
//   /transport/vols/{ori}/{dst}/{yymmdd-aller}/{yymmdd-retour}/?adults=N&children=N&...
// Codes IATA en minuscules. Si returnDate vide → one-way (pas de 2e date).
export function buildSkyscannerUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenCount,
  infantsCount,
  directOnly,
}) {
  const ori = String(originIata || '').toLowerCase();
  const dst = String(destIata || '').toLowerCase();
  if (!ori || !dst || !departDate) return null;
  const a = Math.max(1, Number(adults) || 1);
  const c = Math.max(0, Number(childrenCount) || 0);
  const inf = Math.max(0, Number(infantsCount) || 0);
  const dep = toYYMMDD(departDate);
  let path = `/transport/vols/${ori}/${dst}/${dep}/`;
  if (returnDate) {
    path += `${toYYMMDD(returnDate)}/`;
  }
  const params = new URLSearchParams();
  params.set('adults', String(a));
  if (c > 0) params.set('children', String(c));
  if (inf > 0) params.set('infants', String(inf));
  params.set('cabinclass', 'economy');
  params.set('preferdirects', directOnly ? 'true' : 'false');
  params.set('rtn', returnDate ? '1' : '0');
  return `https://www.skyscanner.fr${path}?${params.toString()}`;
}

// Google Flights — parser langage naturel via q=. Plus stable que le
// format binaire tfs= qui change régulièrement.
export function buildGoogleFlightsUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenCount,
}) {
  if (!originIata || !destIata || !departDate) return null;
  const a = Math.max(1, Number(adults) || 1);
  const c = Math.max(0, Number(childrenCount) || 0);
  let q = `Flights from ${originIata} to ${destIata} on ${departDate}`;
  if (returnDate) {
    q += ` returning ${returnDate}`;
  } else {
    q += ` one-way`;
  }
  const paxParts = [`${a} adult${a > 1 ? 's' : ''}`];
  if (c > 0) paxParts.push(`${c} child${c > 1 ? 'ren' : ''}`);
  q += ` for ${paxParts.join(' and ')}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=fr&curr=EUR`;
}

// Aviasales (deeplink natif Travelpayouts) — format compact :
//   /search/{ORI}{DD}{MM}{DST}{DD2}{MM2}{pax}
export function buildAviasalesUrl({
  originIata,
  destIata,
  departDate,
  returnDate,
  adults,
  childrenCount,
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
  const c = Math.max(0, Number(childrenCount) || 0);
  const pax = `${a}${c > 0 ? c : ''}`;
  return `https://www.aviasales.com/search/${segment}${pax}?currency=eur&locale=fr`;
}

// Méta des providers — Skyscanner en premier (priorité partenariat).
export const FLIGHT_SEARCH_PROVIDERS = [
  {
    id: 'skyscanner',
    label: 'Skyscanner',
    short: 'Skyscanner',
    buildUrl: buildSkyscannerUrl,
    btnClass: 'bg-blue-600 hover:bg-blue-700',
    accent: 'sky',
  },
  {
    id: 'google',
    label: 'Google Flights',
    short: 'Google Flights',
    buildUrl: buildGoogleFlightsUrl,
    btnClass: 'bg-slate-700 hover:bg-slate-800',
    accent: 'slate',
  },
  {
    id: 'aviasales',
    label: 'Aviasales',
    short: 'Aviasales',
    buildUrl: buildAviasalesUrl,
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

// Résolution ville → code IATA via l'autocomplete Travelpayouts (public,
// pas de token). On préfère "city" pour avoir le code metropolitan qui
// regroupe tous les aéroports d'une ville.
export async function resolveIata(query) {
  if (!query || !query.trim()) return null;
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(
      query
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
