// Module partagé Travelpayouts (Aviasales Data API)
// Utilisé par : travelpayouts-flights (Edge Function autonome) et
// generate-itinerary (enrichissement automatique des itinéraires avion-*).
//
// Secrets requis dans Supabase Edge Functions :
//   - TRAVELPAYOUTS_TOKEN  (token API personnel)
//   - TRAVELPAYOUTS_MARKER (identifiant affilié, pour les deeplinks Aviasales)

// deno-lint-ignore-file no-explicit-any

export interface FlightData {
  origin_iata: string;
  destination_iata: string;
  price_eur: number;
  airline: string;
  flight_number: string | null;
  // Heures TOUJOURS exprimées en HEURE LOCALE de l'aéroport correspondant :
  //  - departure_at / arrival_at : aller (départ origine / arrivée destination)
  //  - return_at / return_arrival_at : retour (départ destination / arrivée origine)
  departure_at: string | null;
  arrival_at: string | null;
  return_at: string | null;
  return_arrival_at: string | null;
  deeplink: string;
  // 'user-confirmed' = vol fourni par l'utilisateur (capture d'écran / saisie),
  // avec vraies heures et codes IATA.
  source: 'travelpayouts-cheap' | 'travelpayouts-latest' | 'user-confirmed';
}

// Table de codes IATA "city" (métropolitains quand possible : PAR couvre
// CDG+ORY, NYC couvre JFK+EWR+LGA, etc.). Permet d'éviter un appel à
// l'autocomplete pour les destinations courantes.
const CITY_TO_IATA: Record<string, string> = {
  // France
  paris: 'PAR', marseille: 'MRS', lyon: 'LYS', nice: 'NCE', toulouse: 'TLS',
  bordeaux: 'BOD', nantes: 'NTE', strasbourg: 'SXB', montpellier: 'MPL',
  lille: 'LIL', brest: 'BES', rennes: 'RNS', biarritz: 'BIQ',
  perpignan: 'PGF', clermont: 'CFE', 'clermont-ferrand': 'CFE',
  ajaccio: 'AJA', bastia: 'BIA', figari: 'FSC', calvi: 'CLY',
  'la rochelle': 'LRH', tours: 'TUF', limoges: 'LIG', metz: 'ETZ',
  // Europe (codes city quand existant, sinon code aéroport principal)
  londres: 'LON', london: 'LON',
  madrid: 'MAD', barcelone: 'BCN', barcelona: 'BCN',
  seville: 'SVQ', séville: 'SVQ', valence: 'VLC', bilbao: 'BIO', malaga: 'AGP',
  palma: 'PMI', 'palma de majorque': 'PMI', ibiza: 'IBZ',
  rome: 'ROM', milan: 'MIL', venise: 'VCE', venice: 'VCE',
  florence: 'FLR', naples: 'NAP', palerme: 'PMO', catane: 'CTA',
  athenes: 'ATH', athènes: 'ATH', mykonos: 'JMK', santorin: 'JTR',
  heraklion: 'HER', héraklion: 'HER', thessalonique: 'SKG',
  berlin: 'BER', munich: 'MUC', francfort: 'FRA', hambourg: 'HAM',
  cologne: 'CGN', düsseldorf: 'DUS', dusseldorf: 'DUS',
  amsterdam: 'AMS', rotterdam: 'RTM', eindhoven: 'EIN',
  vienne: 'VIE', vienna: 'VIE',
  lisbonne: 'LIS', lisbon: 'LIS', porto: 'OPO', faro: 'FAO', funchal: 'FNC',
  dublin: 'DUB', cork: 'ORK',
  copenhague: 'CPH', copenhagen: 'CPH',
  stockholm: 'STO', oslo: 'OSL', helsinki: 'HEL',
  prague: 'PRG', budapest: 'BUD', varsovie: 'WAW', warsaw: 'WAW',
  cracovie: 'KRK', krakow: 'KRK',
  zurich: 'ZRH', geneve: 'GVA', genève: 'GVA',
  bruxelles: 'BRU', brussels: 'BRU',
  reykjavik: 'KEF', reykjavík: 'KEF',
  edinburgh: 'EDI', edimbourg: 'EDI', glasgow: 'GLA', manchester: 'MAN',
  // Amérique du Nord
  'new york': 'NYC', 'new-york': 'NYC', newyork: 'NYC',
  'los angeles': 'LAX', 'san francisco': 'SFO',
  chicago: 'CHI', boston: 'BOS', miami: 'MIA', orlando: 'MCO',
  washington: 'WAS', seattle: 'SEA', denver: 'DEN', 'las vegas': 'LAS',
  philadelphie: 'PHL', philadelphia: 'PHL', dallas: 'DFW', atlanta: 'ATL',
  houston: 'HOU', phoenix: 'PHX', portland: 'PDX',
  montreal: 'YMQ', montréal: 'YMQ', toronto: 'YTO',
  vancouver: 'YVR', quebec: 'YQB', québec: 'YQB', calgary: 'YYC',
  mexico: 'MEX', 'mexico city': 'MEX', cancun: 'CUN', cancún: 'CUN',
  'la havane': 'HAV', havana: 'HAV', varadero: 'VRA',
  // Amérique du Sud
  'buenos aires': 'BUE', rio: 'RIO', 'rio de janeiro': 'RIO',
  'sao paulo': 'SAO', 'são paulo': 'SAO',
  lima: 'LIM', bogota: 'BOG', bogotá: 'BOG', santiago: 'SCL',
  quito: 'UIO', cusco: 'CUZ', 'la paz': 'LPB',
  // Asie
  tokyo: 'TYO', osaka: 'OSA', kyoto: 'UKY', sapporo: 'SPK',
  bangkok: 'BKK', phuket: 'HKT', krabi: 'KBV', 'chiang mai': 'CNX',
  singapour: 'SIN', singapore: 'SIN',
  'hong kong': 'HKG', 'hong-kong': 'HKG', hongkong: 'HKG',
  pekin: 'BJS', pékin: 'BJS', beijing: 'BJS',
  shanghai: 'SHA', shanghaï: 'SHA', canton: 'CAN', guangzhou: 'CAN',
  seoul: 'SEL', séoul: 'SEL', busan: 'PUS',
  bali: 'DPS', denpasar: 'DPS', jakarta: 'JKT',
  hanoi: 'HAN', hanoï: 'HAN', 'ho chi minh': 'SGN', saigon: 'SGN',
  'ho-chi-minh-ville': 'SGN', 'da nang': 'DAD',
  bombay: 'BOM', mumbai: 'BOM', delhi: 'DEL', 'new delhi': 'DEL',
  bangalore: 'BLR', goa: 'GOI', kerala: 'COK', kochi: 'COK',
  doha: 'DOH', dubai: 'DXB', dubaï: 'DXB', 'abu dhabi': 'AUH',
  istanbul: 'IST', 'tel aviv': 'TLV', amman: 'AMM',
  katmandou: 'KTM', kathmandu: 'KTM', colombo: 'CMB',
  yangon: 'RGN', 'phnom penh': 'PNH', vientiane: 'VTE',
  // Afrique
  'le caire': 'CAI', cairo: 'CAI', louxor: 'LXR', luxor: 'LXR',
  hurghada: 'HRG', 'charm el cheikh': 'SSH', 'sharm el sheikh': 'SSH',
  marrakech: 'RAK', casablanca: 'CAS', agadir: 'AGA', fes: 'FEZ', fès: 'FEZ',
  tanger: 'TNG', rabat: 'RBA',
  tunis: 'TUN', djerba: 'DJE',
  'le cap': 'CPT', 'cape town': 'CPT', johannesburg: 'JNB',
  nairobi: 'NBO', mombasa: 'MBA', zanzibar: 'ZNZ',
  dakar: 'DSS', 'addis abeba': 'ADD', addis: 'ADD',
  antananarivo: 'TNR', tana: 'TNR', 'tananarive': 'TNR',
  alger: 'ALG', algiers: 'ALG', oran: 'ORN',
  'saint denis': 'RUN', 'saint-denis': 'RUN', reunion: 'RUN', réunion: 'RUN',
  mauritius: 'MRU', maurice: 'MRU', 'ile maurice': 'MRU', 'île maurice': 'MRU',
  'point a pitre': 'PTP', 'pointe-à-pitre': 'PTP', guadeloupe: 'PTP',
  'fort de france': 'FDF', 'fort-de-france': 'FDF', martinique: 'FDF',
  // Océanie
  sydney: 'SYD', melbourne: 'MEL', brisbane: 'BNE',
  auckland: 'AKL', wellington: 'WLG', christchurch: 'CHC',
  papeete: 'PPT', tahiti: 'PPT', noumea: 'NOU', nouméa: 'NOU',
};

/**
 * Convertit un nom de ville en code IATA (priorité table locale, fallback
 * autocomplete Travelpayouts). Renvoie null si introuvable.
 */
export async function cityToIata(name: string): Promise<string | null> {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics for the lookup key
    .replace(/\s+/g, ' ');

  // 1. Lookup direct (avec et sans accents)
  if (CITY_TO_IATA[name.toLowerCase().trim()]) {
    return CITY_TO_IATA[name.toLowerCase().trim()];
  }
  if (CITY_TO_IATA[normalized]) {
    return CITY_TO_IATA[normalized];
  }

  // 2. Première partie avant virgule ("Paris, France" → "Paris")
  const firstPart = normalized.split(',')[0].trim();
  if (CITY_TO_IATA[firstPart]) return CITY_TO_IATA[firstPart];

  // 3. Fallback : autocomplete Travelpayouts (public, pas de token requis)
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(name)}&locale=fr&types[]=city&types[]=airport`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // On préfère un résultat de type "city" si dispo
    const city = arr.find((p: any) => p.type === 'city');
    const pick = city || arr[0];
    return pick?.code || null;
  } catch (e) {
    console.warn('[travelpayouts] autocomplete failed:', e);
    return null;
  }
}

/**
 * Construit le deeplink Aviasales (recherche front, avec marker affilié).
 * Format : /search/{ORI}{DD}{MM}{DST}{DD2}{MM2}{passengers}
 * Ex : MRS1210JFK181012  →  Marseille 12/10 → JFK 18/10 — 1 adulte 2 enfants.
 *
 * On force currency=eur et locale=fr pour que les prix s'affichent en €
 * et l'interface en français côté utilisateur.
 */
export function buildAviasalesDeeplink(params: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string | null;
  adults: number;
  children?: number;
  marker: string;
}): string {
  const { origin, destination, departDate, returnDate, adults, children = 0, marker } = params;
  const dd1 = departDate.substring(8, 10); // DD
  const mm1 = departDate.substring(5, 7); // MM
  let segment = `${origin}${dd1}${mm1}${destination}`;
  if (returnDate) {
    const dd2 = returnDate.substring(8, 10);
    const mm2 = returnDate.substring(5, 7);
    segment += `${dd2}${mm2}`;
  }
  // Passagers : adultes / enfants(2-11) / bébés (on simplifie : tout enfant compté en "enfant")
  const pax = `${Math.max(1, adults)}${children > 0 ? children : ''}`;
  return `https://www.aviasales.com/search/${segment}${pax}?marker=${marker}&currency=eur&locale=fr`;
}

/**
 * Calcule l'heure d'arrivée locale destination à partir de l'heure de départ
 * + durée du vol (en minutes côté Travelpayouts cheap).
 * Travelpayouts renvoie des durées qui sont déjà "perçues" du point de vue
 * passager — on les ajoute directement sans correction fuseau.
 */
function computeArrival(
  departureAt: string | null | undefined,
  durationMinutes: number | null | undefined
): string | null {
  if (!departureAt) return null;
  const mins = Number(durationMinutes);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  try {
    const d = new Date(departureAt);
    if (isNaN(d.getTime())) return null;
    d.setMinutes(d.getMinutes() + mins);
    // Format ISO sans fuseau ("YYYY-MM-DDTHH:MM:SS")
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mn = String(d.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mn}:00`;
  } catch {
    return null;
  }
}

/**
 * Recherche le vol le moins cher pour une route donnée.
 *
 * Stratégie : on tente d'abord /v1/prices/cheap (renvoie compagnie + n° vol +
 * heures + prix), puis fallback /v2/prices/latest si le premier ne donne rien.
 */
export async function searchFlight(opts: {
  originCity: string;
  destinationCity: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string | null;
  adults: number;
  children?: number;
  token: string;
  marker: string;
}): Promise<FlightData | null> {
  const origin = await cityToIata(opts.originCity);
  const destination = await cityToIata(opts.destinationCity);
  if (!origin || !destination) {
    console.warn(
      `[travelpayouts] IATA introuvable: ${opts.originCity} → ${opts.destinationCity}`
    );
    return null;
  }
  if (origin === destination) {
    return null; // pas de vol si origine == destination
  }

  const deeplink = buildAviasalesDeeplink({
    origin,
    destination,
    departDate: opts.departDate,
    returnDate: opts.returnDate,
    adults: opts.adults,
    children: opts.children,
    marker: opts.marker,
  });

  // --- 1) Cheap prices (le plus complet) ---
  try {
    const url = new URL('https://api.travelpayouts.com/v1/prices/cheap');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('depart_date', opts.departDate);
    if (opts.returnDate) url.searchParams.set('return_date', opts.returnDate);
    url.searchParams.set('currency', 'eur');
    url.searchParams.set('token', opts.token);

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const destBlock = json?.data?.[destination];
      if (destBlock && typeof destBlock === 'object') {
        const offers = Object.values(destBlock) as any[];
        if (offers.length > 0) {
          // Tri par prix croissant et prise du plus pertinent
          offers.sort((a, b) => (a.price || 0) - (b.price || 0));
          const best = offers[0];
          const pricePerPax = Number(best.price) || 0;
          const totalPax = Math.max(1, opts.adults) + (opts.children || 0);
          // Travelpayouts ne renvoie pas arrival_at directement → on le
          // calcule à partir de duration_to (durée aller en minutes).
          // best.duration peut être en minutes ou secondes selon endpoint —
          // on tente d'inférer (un vol >24h = secondes).
          const arrivalAt = computeArrival(best.departure_at, best.duration_to ?? best.duration);
          const returnArrivalAt = best.return_at
            ? computeArrival(best.return_at, best.duration_back ?? best.duration)
            : null;
          return {
            origin_iata: origin,
            destination_iata: destination,
            price_eur: Math.round(pricePerPax * totalPax),
            airline: best.airline || 'N/A',
            flight_number: best.flight_number ? String(best.flight_number) : null,
            departure_at: best.departure_at || null,
            arrival_at: arrivalAt,
            return_at: best.return_at || null,
            return_arrival_at: returnArrivalAt,
            deeplink,
            source: 'travelpayouts-cheap',
          };
        }
      }
    }
  } catch (e) {
    console.warn('[travelpayouts] cheap endpoint failed:', e);
  }

  // --- 2) Fallback : latest prices ---
  try {
    const url = new URL('https://api.travelpayouts.com/v2/prices/latest');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('currency', 'eur');
    url.searchParams.set('one_way', opts.returnDate ? 'false' : 'true');
    url.searchParams.set('limit', '5');
    url.searchParams.set('token', opts.token);

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const arr = Array.isArray(json?.data) ? json.data : [];
      if (arr.length > 0) {
        arr.sort((a: any, b: any) => (a.value || 0) - (b.value || 0));
        const best = arr[0];
        const pricePerPax = Number(best.value) || 0;
        const totalPax = Math.max(1, opts.adults) + (opts.children || 0);
        return {
          origin_iata: origin,
          destination_iata: destination,
          price_eur: Math.round(pricePerPax * totalPax),
          airline: best.gate || best.airline || 'N/A',
          flight_number: null,
          departure_at: best.depart_date || null,
          arrival_at: null, // endpoint latest ne donne pas la durée → arrivée inconnue
          return_at: best.return_date || null,
          return_arrival_at: null,
          deeplink,
          source: 'travelpayouts-latest',
        };
      }
    }
  } catch (e) {
    console.warn('[travelpayouts] latest endpoint failed:', e);
  }

  return null;
}
