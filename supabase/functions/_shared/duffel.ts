// Module partagé Duffel (API moderne de réservation de vols).
// Fournisseur alternatif à Travelpayouts pour la recherche de vols réels
// (prix, compagnies, numéros de vol, horaires).
//
// Doc : https://duffel.com/docs/api/v2
// Endpoint principal : POST https://api.duffel.com/air/offer_requests?return_offers=true
// Auth : header "Authorization: Bearer <DUFFEL_API_TOKEN>"
// Header de version obligatoire : "Duffel-Version: v2"
//
// Secret requis dans Supabase Edge Functions :
//   - DUFFEL_API_TOKEN (token "duffel_test_..." en sandbox, "duffel_live_..." en prod)

// deno-lint-ignore-file no-explicit-any
import { cityToIata, type FlightData as TpFlightData } from './travelpayouts.ts';

export type DuffelFlightSource = 'duffel' | 'duffel-test';

export interface DuffelFlightData extends Omit<TpFlightData, 'source'> {
  source: DuffelFlightSource;
}

const DUFFEL_API_BASE = 'https://api.duffel.com';

/**
 * Construit un deeplink Google Flights PRÉ-REMPLI avec tous les paramètres
 * utiles pour que l'utilisateur retrouve son vol en un clic :
 *   - aéroport d'origine / destination (codes IATA)
 *   - date de départ (et éventuellement date de retour)
 *   - aller simple ou aller-retour
 *   - nombre d'adultes + enfants
 *   - devise EUR et interface française
 *
 * On utilise le parser "natural language" de Google Flights via le
 * paramètre q= : c'est la méthode la plus stable (le format binaire tfs=
 * change régulièrement et nécessite du protobuf).
 *
 * Exemples produits :
 *   - A/R 2A + 1E :
 *     "Flights from MRS to YUL on 2026-09-07 returning 2026-09-15 for 2 adults and 1 child"
 *   - Aller simple 1A :
 *     "Flights from MRS to YUL on 2026-09-07 for 1 adult"
 */
export function buildGoogleFlightsDeeplink(params: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string | null;
  adults?: number;
  children?: number;
  currency?: 'EUR' | 'USD' | 'GBP';
  locale?: 'fr' | 'en';
}): string {
  const adults = Math.max(1, Number(params.adults) || 1);
  const children = Math.max(0, Number(params.children) || 0);
  const currency = params.currency || 'EUR';
  const locale = params.locale || 'fr';

  let q = `Flights from ${params.origin} to ${params.destination} on ${params.departDate}`;
  if (params.returnDate) {
    q += ` returning ${params.returnDate}`;
  } else {
    q += ` one-way`;
  }
  // Passagers — formule en anglais, mieux comprise par le parser Google.
  const paxParts: string[] = [];
  paxParts.push(`${adults} adult${adults > 1 ? 's' : ''}`);
  if (children > 0) {
    paxParts.push(`${children} child${children > 1 ? 'ren' : ''}`);
  }
  q += ` for ${paxParts.join(' and ')}`;

  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${currency}&hl=${locale}`;
}

/**
 * Recherche le vol le moins cher pour une route donnée via Duffel.
 *
 * Stratégie :
 *  - On crée une offer_request en mode return_offers=true → les offres
 *    arrivent dans la même réponse (un seul appel HTTP).
 *  - On trie par prix croissant et on prend la 1ʳᵉ.
 *  - Si la devise renvoyée n'est pas EUR, on rejette le résultat (la
 *    cohérence des budgets TravelO impose des prix en €).
 */
export async function searchFlightDuffel(opts: {
  originCity: string;
  destinationCity: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string | null;
  adults: number;
  children?: number;
  apiToken: string;
}): Promise<DuffelFlightData | null> {
  const origin = await cityToIata(opts.originCity);
  const destination = await cityToIata(opts.destinationCity);
  if (!origin || !destination) {
    console.warn(
      `[duffel] IATA introuvable: ${opts.originCity} → ${opts.destinationCity}`
    );
    return null;
  }
  if (origin === destination) return null;

  // Construction des slices : un par jambe
  const slices: Array<Record<string, string>> = [
    { origin, destination, departure_date: opts.departDate },
  ];
  if (opts.returnDate) {
    slices.push({
      origin: destination,
      destination: origin,
      departure_date: opts.returnDate,
    });
  }

  // Construction des passagers : "adult" pour adultes, "age": X pour enfants
  // (Duffel attend des âges précis pour les < 18 ans, on prend 10 par défaut
  // si l'âge exact n'est pas connu — c'est juste indicatif côté tarif).
  const passengers: Array<Record<string, any>> = [];
  for (let i = 0; i < Math.max(1, opts.adults); i++) {
    passengers.push({ type: 'adult' });
  }
  for (let i = 0; i < (opts.children || 0); i++) {
    passengers.push({ age: 10 });
  }

  const body = {
    data: {
      slices,
      passengers,
      cabin_class: 'economy',
    },
  };

  const isTestToken = opts.apiToken.startsWith('duffel_test_');

  try {
    const url = `${DUFFEL_API_BASE}/air/offer_requests?return_offers=true`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[duffel] HTTP', res.status, txt.substring(0, 300));
      return null;
    }
    const json = await res.json();
    const offers: any[] = json?.data?.offers || [];
    if (offers.length === 0) return null;

    // Filtre les offres en EUR (TravelO travaille exclusivement en €)
    const eurOffers = offers.filter(
      (o) => (o.total_currency || '').toUpperCase() === 'EUR'
    );
    const pool = eurOffers.length > 0 ? eurOffers : offers;

    // Tri par prix croissant
    pool.sort(
      (a, b) => parseFloat(a.total_amount || '0') - parseFloat(b.total_amount || '0')
    );
    const best = pool[0];

    if ((best.total_currency || '').toUpperCase() !== 'EUR') {
      console.warn(
        `[duffel] devise ${best.total_currency} non gérée, skip.`
      );
      return null;
    }

    // Extraction du segment aller (1ʳᵉ slice → 1ᵉʳ segment pour départ ;
    // dernier segment de la slice pour l'arrivée finale, en cas d'escales).
    const outboundSlice = best.slices?.[0];
    const outboundSegs: any[] = Array.isArray(outboundSlice?.segments)
      ? outboundSlice.segments
      : [];
    const outboundSeg = outboundSegs[0];
    const outboundLastSeg = outboundSegs[outboundSegs.length - 1];
    const returnSlice = best.slices?.[1];
    const returnSegs: any[] = Array.isArray(returnSlice?.segments)
      ? returnSlice.segments
      : [];
    const returnSeg = returnSegs[0];
    const returnLastSeg = returnSegs[returnSegs.length - 1];

    const carrier =
      outboundSeg?.marketing_carrier ||
      outboundSeg?.operating_carrier ||
      best.owner;
    const airlineCode = carrier?.iata_code || carrier?.name || 'N/A';
    const flightNo = outboundSeg?.marketing_carrier_flight_number
      ? String(outboundSeg.marketing_carrier_flight_number)
      : null;

    // Toutes les heures Duffel sont en HEURE LOCALE de l'aéroport
    // correspondant (cf. doc Duffel API). Format "YYYY-MM-DDTHH:MM:SS".
    const departureAt: string | null = outboundSeg?.departing_at || null;
    const arrivalAt: string | null = outboundLastSeg?.arriving_at || null;
    const returnAt: string | null = returnSeg?.departing_at || null;
    const returnArrivalAt: string | null =
      returnLastSeg?.arriving_at || null;

    // Pas de site consommateur Duffel → on fallback sur Google Flights pour
    // que le bouton "Voir & comparer" reste utile à l'utilisateur.
    // On passe TOUS les paramètres (pax + dates + devise + locale) pour que
    // la recherche Google Flights soit complètement pré-remplie au clic.
    const deeplink = buildGoogleFlightsDeeplink({
      origin,
      destination,
      departDate: opts.departDate,
      returnDate: opts.returnDate,
      adults: opts.adults,
      children: opts.children,
      currency: 'EUR',
      locale: 'fr',
    });

    return {
      origin_iata: origin,
      destination_iata: destination,
      price_eur: Math.round(parseFloat(best.total_amount) || 0),
      airline: airlineCode,
      flight_number: flightNo,
      departure_at: departureAt,
      arrival_at: arrivalAt,
      return_at: returnAt,
      return_arrival_at: returnArrivalAt,
      deeplink,
      source: isTestToken ? 'duffel-test' : 'duffel',
    };
  } catch (e) {
    console.warn('[duffel] search failed:', e);
    return null;
  }
}
