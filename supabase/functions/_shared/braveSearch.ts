// Helper d'appel à l'API Brave Search.
// Doc : https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
//
// Variable d'env requise : BRAVE_SEARCH_API_KEY (token gratuit dispo sur
// api-dashboard.search.brave.com, plan "Search" → 5 $/1000 requêtes avec
// 5 $ de crédits gratuits par mois = ~1000 recherches/mois sans frais).

const BRAVE_API_KEY = Deno.env.get('BRAVE_SEARCH_API_KEY') || '';
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface BraveResult {
  url: string;
  title: string;
  description: string;
}

export interface BraveSearchOptions {
  count?: number; // nombre de résultats à renvoyer (défaut : 5, max 20)
  country?: string; // 'fr', 'us', etc. — biais géographique du classement
  freshness?: 'pd' | 'pw' | 'pm' | 'py'; // past day/week/month/year
}

/**
 * Recherche web via Brave. Renvoie au plus `count` résultats (URL, titre,
 * description). Retourne [] en cas d'erreur (jamais throw — la vérification
 * de prix doit pouvoir échouer en douceur pour un hôtel sans casser tout
 * l'itinéraire).
 */
export async function braveSearch(
  query: string,
  options: BraveSearchOptions = {}
): Promise<BraveResult[]> {
  if (!BRAVE_API_KEY) {
    console.warn('[brave] BRAVE_SEARCH_API_KEY non configuré, recherche désactivée');
    return [];
  }
  if (!query || !query.trim()) return [];

  const params = new URLSearchParams();
  params.set('q', query.trim());
  params.set('count', String(Math.min(Math.max(options.count || 5, 1), 20)));
  if (options.country) params.set('country', options.country);
  if (options.freshness) params.set('freshness', options.freshness);
  // Strict false : on accepte des résultats de toutes natures (pas seulement
  // family-safe — on est sur de la recherche de prix d'hôtels et activités).
  params.set('safesearch', 'moderate');
  // Pas besoin de spellcheck / suggestions pour notre usage
  params.set('spellcheck', '0');

  try {
    const res = await fetch(`${BRAVE_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`[brave] ${res.status} pour "${query}": ${txt.slice(0, 200)}`);
      return [];
    }
    const data = await res.json();
    const results = data?.web?.results || [];
    return results.slice(0, options.count || 5).map((r: any) => ({
      url: r.url || '',
      title: r.title || '',
      description: (r.description || '').replace(/<[^>]+>/g, ''), // strip <strong> tags
    }));
  } catch (e) {
    console.warn(`[brave] exception pour "${query}":`, (e as Error).message);
    return [];
  }
}
