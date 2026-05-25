// Module partagé Kiwi.com (Tequila API v2)
// Fournisseur alternatif à Travelpayouts pour la recherche de vols.
//
// Endpoint principal : https://api.tequila.kiwi.com/v2/search
// Auth : header "apikey: <KIWI_API_KEY>"
// Format de date attendu côté API : dd/mm/yyyy
//
// Secret requis dans Supabase Edge Functions :
//   - KIWI_API_KEY (clé personnelle obtenue sur tequila.kiwi.com)

// deno-lint-ignore-file no-explicit-any
import { cityToIata, type FlightData as TpFlightData } from './travelpayouts.ts';

// On partage le type FlightData (même forme dans tout le code) mais on
// distingue les sources via le champ `source`.
export type KiwiFlightSource = 'kiwi' | 'kiwi-fallback';

export interface KiwiFlightData extends Omit<TpFlightData, 'source'> {
  source: KiwiFlightSource;
}

/**
 * Convertit "YYYY-MM-DD" → "DD/MM/YYYY" (format Tequila).
 */
function isoToKiwiDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const y = iso.substring(0, 4);
  const m = iso.substring(5, 7);
  const d = iso.substring(8, 10);
  return `${d}/${m}/${y}`;
}

/**
 * Recherche le vol le moins cher pour une route donnée via Tequila API.
 *
 * Stratégie :
 *  - Si returnDate fourni → flight_type=round avec fenêtre 0 jour (date exacte)
 *  - Sinon → flight_type=oneway
 *  - On trie côté API par prix croissant et on prend le premier résultat.
 *  - On garde le deep_link tel quel : Kiwi y inclut déjà la session/booking.
 */
export async function searchFlightKiwi(opts: {
  originCity: string;
  destinationCity: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string | null;
  adults: number;
  children?: number;
  apiKey: string;
}): Promise<KiwiFlightData | null> {
  const origin = await cityToIata(opts.originCity);
  const destination = await cityToIata(opts.destinationCity);
  if (!origin || !destination) {
    console.warn(
      `[kiwi] IATA introuvable: ${opts.originCity} → ${opts.destinationCity}`
    );
    return null;
  }
  if (origin === destination) return null;

  const dateFrom = isoToKiwiDate(opts.departDate);
  const dateTo = dateFrom; // recherche sur la date exacte
  const isRound = !!opts.returnDate;
  const params = new URLSearchParams({
    fly_from: origin,
    fly_to: destination,
    date_from: dateFrom,
    date_to: dateTo,
    flight_type: isRound ? 'round' : 'oneway',
    adults: String(Math.max(1, opts.adults)),
    children: String(opts.children || 0),
    curr: 'EUR',
    locale: 'fr',
    limit: '5',
    sort: 'price',
    one_for_city: '0',
  });
  if (isRound && opts.returnDate) {
    const ret = isoToKiwiDate(opts.returnDate);
    params.set('return_from', ret);
    params.set('return_to', ret);
  }

  try {
    const url = `https://api.tequila.kiwi.com/v2/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        apikey: opts.apiKey,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[kiwi] HTTP', res.status, txt.substring(0, 200));
      return null;
    }
    const json = await res.json();
    const arr = Array.isArray(json?.data) ? json.data : [];
    if (arr.length === 0) return null;

    // Tri par sécurité (sort=price côté serveur n'est pas garanti à 100%)
    arr.sort((a: any, b: any) => (a.price || 0) - (b.price || 0));
    const best = arr[0];

    // route[] contient tous les segments aller+retour. On prend le 1er
    // segment de l'aller (return=0) pour airline / flight_no / departure.
    const segments: any[] = Array.isArray(best.route) ? best.route : [];
    const outboundLeg = segments.find((s) => s.return === 0) || segments[0] || {};
    const returnLeg = segments.find((s) => s.return === 1) || null;

    // Compagnie : on préfère le 1er code IATA de "airlines", sinon segment
    const airlineCode =
      outboundLeg.airline ||
      (Array.isArray(best.airlines) && best.airlines[0]) ||
      'N/A';
    const flightNo = outboundLeg.flight_no
      ? String(outboundLeg.flight_no)
      : null;

    // local_departure : "YYYY-MM-DDTHH:MM:SS.sssZ" — on garde l'ISO complet,
    // les consommateurs (formatFlightBlockForPrompt / ItineraryView) en
    // extraient HH:MM via substring(11,16).
    const departureAt: string | null = outboundLeg.local_departure || null;
    const returnAt: string | null = returnLeg?.local_departure || null;

    return {
      origin_iata: origin,
      destination_iata: destination,
      price_eur: Math.round(Number(best.price) || 0),
      airline: airlineCode,
      flight_number: flightNo,
      departure_at: departureAt,
      return_at: returnAt,
      deeplink: best.deep_link || '',
      source: 'kiwi',
    };
  } catch (e) {
    console.warn('[kiwi] search failed:', e);
    return null;
  }
}

/**
 * Construit un deeplink Kiwi de secours (page de recherche, sans réservation
 * pré-remplie). Utilisé quand on a juste besoin d'un bouton "Voir les vols"
 * sans avoir effectué la recherche backend.
 *
 * Format Kiwi : /fr/search/results/{ori}/{dst}/{depart}/{retour|no-return}
 */
export function buildKiwiSearchDeeplink(params: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string | null;
  adults: number;
  children?: number;
}): string {
  const { origin, destination, departDate, returnDate, adults, children = 0 } = params;
  const retSegment = returnDate ? `/${returnDate}` : '/no-return';
  const pax = `${Math.max(1, adults)}-${children}-0`; // adults-children-infants
  return `https://www.kiwi.com/fr/search/results/${origin}/${destination}/${departDate}${retSegment}?adults=${Math.max(1, adults)}&children=${children}&currency=eur`;
}
