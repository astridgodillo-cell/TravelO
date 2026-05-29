import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

// Cache mémoire simple (vivace pendant la session) pour éviter de réinterroger Pexels
const cache = new Map();

export async function fetchSpecialties(location, count = 4) {
  if (!location) return [];
  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: { mode: 'fetch-specialties', location, count },
    });
    if (error || data?.error) {
      console.warn('[specialties] fetch failed', error || data.error);
      return [];
    }
    return data?.specialties || [];
  } catch (e) {
    console.error('[specialties] exception', e);
    return [];
  }
}

// Cache persistant (sessionStorage) : on évite de réinterroger Google
// Places à chaque rafraîchissement de page pour le même hôtel.
const HOTEL_RATING_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hotelCacheKey(hotelName, location) {
  return `travelo:hotel-rating:${(hotelName || '').toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`;
}

function readHotelCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > HOTEL_RATING_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeHotelCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota dépassé, on ignore */
  }
}

// Cache 7 jours : on évite de spammer GetYourGuide à chaque rafraîchissement.
const GYG_AVAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function gygCacheKey(title, location) {
  const norm = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  return `travelo:gyg-avail:${norm(title)}|${norm(location)}`;
}

function readGygCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > GYG_AVAIL_TTL_MS) return undefined;
    return parsed.available;
  } catch {
    return undefined;
  }
}

function writeGygCache(key, available) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ts: Date.now(), available })
    );
  } catch {
    /* quota dépassé */
  }
}

// Retourne :
//   true   → GYG a des résultats pour cette activité
//   false  → GYG n'a aucun résultat (cacher le bouton)
//   null   → vérification impossible (réseau, blocage) → laisser
//            l'heuristique décider
export async function checkActivityBookable(activityTitle, location) {
  if (!activityTitle) return null;
  const key = gygCacheKey(activityTitle, location);
  const cached = readGygCache(key);
  if (cached !== undefined) return cached;
  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: {
        mode: 'check-gyg-availability',
        activityTitle,
        location,
      },
    });
    if (error || data?.error) {
      console.warn('[gyg-availability] fetch failed', error || data?.error);
      return null;
    }
    const available = data?.available ?? null;
    // On ne cache que les réponses définitives (true ou false),
    // pas les null (qui peuvent être des erreurs transitoires).
    if (available !== null) writeGygCache(key, available);
    return available;
  } catch (e) {
    console.error('[gyg-availability] exception', e);
    return null;
  }
}

export async function fetchHotelRating(hotelName, location) {
  if (!hotelName) return null;
  const key = hotelCacheKey(hotelName, location);
  const cached = readHotelCache(key);
  if (cached) return cached;
  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: { mode: 'fetch-hotel-rating', hotelName, location },
    });
    if (error || data?.error) {
      console.warn('[hotel-rating] fetch failed', error || data?.error);
      return null;
    }
    const result = {
      rating: data?.rating ?? null,
      userRatingCount: data?.userRatingCount ?? 0,
      googleMapsUri: data?.googleMapsUri ?? null,
      matchedName: data?.matchedName ?? null,
    };
    writeHotelCache(key, result);
    return result;
  } catch (e) {
    console.error('[hotel-rating] exception', e);
    return null;
  }
}

// kind (optionnel) : type de destination ("ville", "plage", "montagne"…). Il
// enrichit la requête Unsplash avec des termes cinématiques (golden hour, aerial
// view…) côté serveur, avec repli automatique sur le nom seul.
export async function fetchPhotosFor(query, perPage = 5, source = 'auto', kind = '') {
  if (!query) return [];
  const key = `${source}|${kind}|${query}|${perPage}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: { mode: 'fetch-photos', query, per_page: perPage, source, kind },
    });
    if (error || data?.error) {
      console.warn('[photos] fetch failed', error || data.error);
      cache.set(key, []);
      return [];
    }
    const photos = data?.photos || [];
    cache.set(key, photos);
    return photos;
  } catch (e) {
    console.error('[photos] exception', e);
    return [];
  }
}
