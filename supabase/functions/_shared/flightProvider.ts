// Dispatcher fournisseur de vols.
// Lit la clé `flight_provider` dans la table app_config (cache 15 s) et
// dispatche vers Travelpayouts (Aviasales) ou Duffel.
//
// Le superadmin peut basculer le provider en un clic depuis l'admin, sans
// redéploiement.

// deno-lint-ignore-file no-explicit-any
import { searchFlight, type FlightData } from './travelpayouts.ts';
import { searchFlightDuffel, type DuffelFlightData } from './duffel.ts';

export type AnyFlightData = FlightData | DuffelFlightData;
export type FlightProvider = 'travelpayouts' | 'duffel';

const DEFAULT_PROVIDER: FlightProvider = 'travelpayouts';

let cachedProvider: { value: FlightProvider; expires: number } | null = null;

/**
 * Lit le fournisseur actif depuis app_config. Cache 15 s.
 * Fallback : 'travelpayouts' si la table est inaccessible.
 */
export async function getActiveFlightProvider(
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<FlightProvider> {
  if (cachedProvider && Date.now() < cachedProvider.expires) {
    return cachedProvider.value;
  }
  if (!supabaseUrl || !serviceRoleKey) return DEFAULT_PROVIDER;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_config?key=eq.flight_provider&select=value`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    if (res.ok) {
      const rows = await res.json();
      const stored = rows?.[0]?.value;
      const value: FlightProvider =
        stored === 'duffel' ? 'duffel' : 'travelpayouts';
      cachedProvider = { value, expires: Date.now() + 15_000 };
      return value;
    }
  } catch (e) {
    console.warn('[config] failed to read flight_provider', e);
  }
  return DEFAULT_PROVIDER;
}

export interface FlightSearchOpts {
  originCity: string;
  destinationCity: string;
  departDate: string;
  returnDate?: string | null;
  adults: number;
  children?: number;
}

export interface ProviderSecrets {
  supabaseUrl: string;
  serviceRoleKey: string;
  travelpayoutsToken: string;
  travelpayoutsMarker: string;
  duffelApiToken: string;
}

/**
 * Cherche un vol via le fournisseur configuré dans app_config.
 *
 * Logique de fallback :
 *  - provider='duffel' mais DUFFEL_API_TOKEN manquant → bascule sur
 *    Travelpayouts si ses secrets sont là, sinon null.
 *  - provider='travelpayouts' mais secrets manquants → tente Duffel si dispo,
 *    sinon null.
 */
export async function searchFlightAny(
  opts: FlightSearchOpts,
  secrets: ProviderSecrets
): Promise<AnyFlightData | null> {
  const provider = await getActiveFlightProvider(
    secrets.supabaseUrl,
    secrets.serviceRoleKey
  );

  const hasTp = !!(secrets.travelpayoutsToken && secrets.travelpayoutsMarker);
  const hasDuffel = !!secrets.duffelApiToken;

  if (provider === 'duffel' && hasDuffel) {
    const r = await searchFlightDuffel({
      ...opts,
      apiToken: secrets.duffelApiToken,
    });
    if (r) return r;
    // Si Duffel ne trouve rien, on tente Travelpayouts en silencieux
    if (hasTp) {
      return await searchFlight({
        ...opts,
        token: secrets.travelpayoutsToken,
        marker: secrets.travelpayoutsMarker,
      });
    }
    return null;
  }

  if (provider === 'travelpayouts' && hasTp) {
    const r = await searchFlight({
      ...opts,
      token: secrets.travelpayoutsToken,
      marker: secrets.travelpayoutsMarker,
    });
    if (r) return r;
    if (hasDuffel) {
      return await searchFlightDuffel({
        ...opts,
        apiToken: secrets.duffelApiToken,
      });
    }
    return null;
  }

  // Provider demandé mais secrets manquants → on tente l'autre en fallback
  if (provider === 'duffel' && !hasDuffel && hasTp) {
    console.warn('[flights] DUFFEL_API_TOKEN manquant, fallback Travelpayouts');
    return await searchFlight({
      ...opts,
      token: secrets.travelpayoutsToken,
      marker: secrets.travelpayoutsMarker,
    });
  }
  if (provider === 'travelpayouts' && !hasTp && hasDuffel) {
    console.warn('[flights] Secrets Travelpayouts manquants, fallback Duffel');
    return await searchFlightDuffel({
      ...opts,
      apiToken: secrets.duffelApiToken,
    });
  }

  console.warn('[flights] aucun fournisseur disponible (secrets manquants).');
  return null;
}

/**
 * Helper : la source est-elle un "vrai prix" récupéré depuis un fournisseur
 * de vols (par opposition à une estimation IA) ?
 */
export function isRealFlightSource(source: string | undefined): boolean {
  if (!source) return false;
  return source.startsWith('travelpayouts') || source.startsWith('duffel');
}
