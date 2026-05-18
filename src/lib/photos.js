import { supabase } from './supabase';

const FN_NAME = 'generate-itinerary';

// Cache mémoire simple (vivace pendant la session) pour éviter de réinterroger Pexels
const cache = new Map();

export async function fetchPhotosFor(query, perPage = 5) {
  if (!query) return [];
  const key = `${query}|${perPage}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const { data, error } = await supabase.functions.invoke(FN_NAME, {
      body: { mode: 'fetch-photos', query, per_page: perPage },
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
