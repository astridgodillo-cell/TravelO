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

export async function fetchPhotosFor(query, perPage = 5, source = 'auto') {
  if (!query) return [];
  const key = `${source}|${query}|${perPage}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: { mode: 'fetch-photos', query, per_page: perPage, source },
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
