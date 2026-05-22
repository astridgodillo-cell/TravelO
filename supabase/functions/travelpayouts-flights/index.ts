// Supabase Edge Function — travelpayouts-flights
//
// Recherche un vol via l'Aviasales Data API (Travelpayouts) et renvoie
// prix, compagnie, horaires et deeplink affilié.
//
// Body POST :
//   {
//     "origin": "Marseille",
//     "destination": "New York",
//     "depart_date": "2026-10-12",
//     "return_date": "2026-10-18" | null,
//     "adults": 1,
//     "children": 2
//   }
//
// Secrets requis : TRAVELPAYOUTS_TOKEN, TRAVELPAYOUTS_MARKER

// deno-lint-ignore-file no-explicit-any
import { searchFlight } from '../_shared/travelpayouts.ts';

const TRAVELPAYOUTS_TOKEN = Deno.env.get('TRAVELPAYOUTS_TOKEN') || '';
const TRAVELPAYOUTS_MARKER = Deno.env.get('TRAVELPAYOUTS_MARKER') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non supportée (POST attendu).' }, 405);
  }

  if (!TRAVELPAYOUTS_TOKEN || !TRAVELPAYOUTS_MARKER) {
    return jsonResponse(
      { error: 'Secrets TRAVELPAYOUTS_TOKEN et/ou TRAVELPAYOUTS_MARKER manquants.' },
      500
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400);
  }

  const {
    origin,
    destination,
    depart_date,
    return_date,
    adults,
    children,
  } = body || {};

  if (!origin || !destination || !depart_date) {
    return jsonResponse(
      {
        error:
          'Paramètres requis : origin (string), destination (string), depart_date (YYYY-MM-DD).',
      },
      400
    );
  }

  try {
    const flight = await searchFlight({
      originCity: String(origin),
      destinationCity: String(destination),
      departDate: String(depart_date),
      returnDate: return_date ? String(return_date) : null,
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      token: TRAVELPAYOUTS_TOKEN,
      marker: TRAVELPAYOUTS_MARKER,
    });

    if (!flight) {
      return jsonResponse({ flight: null, message: 'Aucun vol trouvé.' });
    }
    return jsonResponse({ flight });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || String(err) },
      500
    );
  }
});
