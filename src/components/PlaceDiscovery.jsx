import { useEffect, useMemo, useState } from 'react';
import { suggestPlaces } from '../lib/ai';
import { fetchPhotosFor } from '../lib/photos';

// Écran « Je choisis mes lieux » — extrait de l'ancien Inspire-moi, rendu
// RÉUTILISABLE et CONTRÔLÉ pour vivre comme une étape du wizard.
//
// L'état (villes/lieux récupérés, photos, sélection) est porté par le parent
// (le wizard) via `state` + `onState`, afin de SURVIVRE quand on change
// d'étape (le composant est démonté puis remonté).
//
// state = {
//   fetchedKey, citiesReady, readyCategories: string[],
//   cities: [], places: [], photoMap: {},
//   selectedCities: string[] (ids), selectedPlaces: string[] (ids),
//   error,
// }

const CATEGORIES = [
  {
    id: 'incontournable',
    label: 'Incontournables',
    emoji: '⭐',
    color: 'from-amber-400 to-orange-500',
    hint: 'Les must-see qu\'on regrette de manquer',
  },
  {
    id: 'insolite',
    label: 'Insolites',
    emoji: '✨',
    color: 'from-fuchsia-500 to-purple-600',
    hint: 'Expériences originales et inattendues',
  },
  {
    id: 'hors-sentiers',
    label: 'Hors des sentiers battus',
    emoji: '🌿',
    color: 'from-emerald-500 to-teal-600',
    hint: 'Pépites cachées, lieux confidentiels',
  },
];

const INITIAL_VISIBLE_PER_CATEGORY = 9;

function computeTotalDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

const EMPTY_DISCOVER = {
  fetchedKey: null,
  citiesReady: false,
  readyCategories: [],
  cities: [],
  places: [],
  photoMap: {},
  selectedCities: [],
  selectedPlaces: [],
  error: null,
};

// Construit le texte "Étapes impératives" (mustInclude) à partir de la sélection.
export function buildMustInclude(cities, places, selectedCities, selectedPlaces) {
  const selCity = cities.filter((c) => selectedCities.includes(c.id));
  const selPlace = places.filter((p) => selectedPlaces.includes(p.id));
  const cityChunk = selCity
    .map(
      (c) =>
        `${c.name} (${c.suggested_days || 2} jour${(c.suggested_days || 2) > 1 ? 's' : ''})`
    )
    .join(', ');
  const placeChunk = selPlace
    .map((p) => `${p.name}${p.location ? ` (${p.location})` : ''}`)
    .join(', ');
  return [cityChunk && `Villes : ${cityChunk}`, placeChunk]
    .filter(Boolean)
    .join(' — ');
}

export default function PlaceDiscovery({
  destination,
  startDate,
  endDate,
  tripType,
  adults,
  childrenAges,
  state,
  onState,
  onSelectionChange,
}) {
  const d = state || EMPTY_DISCOVER;
  const [expanded, setExpanded] = useState(new Set());

  const totalDays = computeTotalDays(startDate, endDate);
  const key = JSON.stringify({
    destination: (destination || '').trim().toLowerCase(),
    startDate,
    endDate,
    tripType,
    adults,
    childrenAges,
  });

  // patch immutable de l'état porté par le parent
  function patch(updater) {
    onState((prev) => {
      const base = prev || EMPTY_DISCOVER;
      const next = typeof updater === 'function' ? updater(base) : updater;
      return { ...base, ...next };
    });
  }

  // Lance la recherche de lieux quand les paramètres changent (1ʳᵉ venue ou
  // destination/dates modifiées). On évite de re-chercher si rien n'a bougé.
  useEffect(() => {
    if (!destination) return;
    if (d.fetchedKey === key) return;
    let cancelled = false;

    // Reset complet pour la nouvelle recherche
    onState({ ...EMPTY_DISCOVER, fetchedKey: key });

    async function loadPhotosFor(list) {
      const entries = await Promise.all(
        list.map(async (p) => {
          const q = p.photo_query || `${p.name} ${p.location || ''}`.trim();
          const photos = await fetchPhotosFor(q, 1);
          const photo = photos?.[0];
          const url =
            photo?.src?.medium ||
            photo?.src?.large ||
            photo?.src?.small ||
            null;
          return [p.id, url];
        })
      );
      if (cancelled) return;
      patch((prev) => ({
        photoMap: { ...prev.photoMap, ...Object.fromEntries(entries) },
      }));
    }

    suggestPlaces({
      destination,
      tripType,
      startDate,
      endDate,
      adults,
      childrenAges,
      onCitiesReady: (newCities) => {
        if (cancelled) return;
        patch({ cities: newCities, citiesReady: true });
        loadPhotosFor(newCities);
      },
      onCategoryReady: (category, newPlaces) => {
        if (cancelled) return;
        patch((prev) => ({
          places: [...prev.places, ...newPlaces],
          readyCategories: prev.readyCategories.includes(category)
            ? prev.readyCategories
            : [...prev.readyCategories, category],
        }));
        loadPhotosFor(newPlaces);
      },
    }).catch((err) => {
      if (cancelled) return;
      patch({ error: err.message || 'Erreur lors de la recherche de lieux.' });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, destination]);

  // Remonte la sélection (texte mustInclude + lieux) au parent à chaque changement.
  useEffect(() => {
    const mustInclude = buildMustInclude(
      d.cities,
      d.places,
      d.selectedCities,
      d.selectedPlaces
    );
    const selectedPlaceObjs = d.places.filter((p) =>
      d.selectedPlaces.includes(p.id)
    );
    onSelectionChange?.(mustInclude, selectedPlaceObjs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.selectedCities, d.selectedPlaces, d.cities, d.places]);

  function toggleSelectCity(id) {
    patch((prev) => ({
      selectedCities: prev.selectedCities.includes(id)
        ? prev.selectedCities.filter((x) => x !== id)
        : [...prev.selectedCities, id],
    }));
  }
  function toggleSelect(id) {
    patch((prev) => ({
      selectedPlaces: prev.selectedPlaces.includes(id)
        ? prev.selectedPlaces.filter((x) => x !== id)
        : [...prev.selectedPlaces, id],
    }));
  }
  function toggleExpand(catId) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  const placesByCategory = useMemo(() => {
    const groups = { incontournable: [], insolite: [], 'hors-sentiers': [] };
    for (const p of d.places) {
      const cat = groups[p.category] ? p.category : 'incontournable';
      groups[cat].push(p);
    }
    return groups;
  }, [d.places]);

  // Garde-fou de faisabilité (programme trop ambitieux pour la durée ?)
  const feasibility = useMemo(() => {
    if (!totalDays) return null;
    if (d.selectedCities.length === 0 && d.selectedPlaces.length === 0)
      return null;
    const norm = (s) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
    const selCities = d.cities.filter((c) => d.selectedCities.includes(c.id));
    const selPlaces = d.places.filter((p) => d.selectedPlaces.includes(p.id));
    const cityNames = new Set(selCities.map((c) => norm(c.name)));
    let daysNeeded = 0;
    for (const c of selCities) daysNeeded += Number(c.suggested_days) || 2;
    const extraBases = new Set();
    for (const p of selPlaces) {
      const loc = norm(p.location || p.name);
      if (loc && !cityNames.has(loc)) extraBases.add(loc);
    }
    daysNeeded += extraBases.size;
    const basesCount = cityNames.size + extraBases.size;
    if (basesCount > 1) daysNeeded += (basesCount - 1) * 0.5;
    return {
      over: daysNeeded > totalDays + 0.5,
      basesCount,
      totalDays,
      suggestedDays: Math.ceil(daysNeeded),
    };
  }, [d.cities, d.places, d.selectedCities, d.selectedPlaces, totalDays]);

  const selectedCitiesSet = new Set(d.selectedCities);
  const selectedPlacesSet = new Set(d.selectedPlaces);
  const totalSelected = d.selectedCities.length + d.selectedPlaces.length;
  const allReady = d.readyCategories.length === CATEGORIES.length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Que veux-tu voir à {destination} ?
        </h2>
        <p className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">
          {allReady ? (
            <>
              {d.places.length} lieux suggérés. Coche ce qui te tente —
              l'itinéraire sera construit autour de tes choix.
            </>
          ) : (
            <>
              Nous explorons {destination}… ({d.readyCategories.length}/
              {CATEGORIES.length} catégories prêtes — tu peux déjà sélectionner
              ce qui s'affiche.)
            </>
          )}
        </p>
      </div>

      {d.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {d.error}
        </div>
      )}

      {/* Villes principales */}
      {!d.citiesReady && (
        <section className="space-y-3">
          <h3 className="text-xl font-semibold bg-gradient-to-r from-sky-500 to-brand-600 bg-clip-text text-transparent">
            🏙️ Villes principales
          </h3>
          <CategorySkeleton color="from-sky-500 to-brand-600" />
        </section>
      )}

      {d.citiesReady && d.cities.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-xl font-semibold bg-gradient-to-r from-sky-500 to-brand-600 bg-clip-text text-transparent">
              🏙️ Villes principales
            </h3>
            <span className="text-xs text-slate-400 ml-auto">
              {d.cities.length} villes
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {d.cities.map((city) => (
              <CityCard
                key={city.id}
                city={city}
                photoUrl={d.photoMap[city.id]}
                selected={selectedCitiesSet.has(city.id)}
                onToggle={() => toggleSelectCity(city.id)}
              />
            ))}
          </div>
        </section>
      )}

      {CATEGORIES.map((cat) => {
        const list = placesByCategory[cat.id] || [];
        const isReady = d.readyCategories.includes(cat.id);
        const isExpanded = expanded.has(cat.id);
        const visibleCount = isExpanded
          ? list.length
          : Math.min(INITIAL_VISIBLE_PER_CATEGORY, list.length);
        const visible = list.slice(0, visibleCount);
        const hidden = list.length - visibleCount;

        return (
          <section key={cat.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3
                className={`text-xl font-semibold bg-gradient-to-r ${cat.color} bg-clip-text text-transparent`}
              >
                {cat.emoji} {cat.label}
              </h3>
              <p className="text-xs text-slate-500">{cat.hint}</p>
              {isReady && (
                <span className="text-xs text-slate-400 ml-auto">
                  {list.length} lieux
                </span>
              )}
            </div>

            {!isReady && list.length === 0 ? (
              <CategorySkeleton color={cat.color} />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visible.map((place) => (
                    <PlaceCard
                      key={place.id}
                      place={place}
                      photoUrl={d.photoMap[place.id]}
                      selected={selectedPlacesSet.has(place.id)}
                      onToggle={() => toggleSelect(place.id)}
                    />
                  ))}
                </div>
                {hidden > 0 && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => toggleExpand(cat.id)}
                      className="btn-secondary text-sm"
                    >
                      Voir {hidden} lieu{hidden > 1 ? 'x' : ''} de plus ↓
                    </button>
                  </div>
                )}
                {isExpanded && list.length > INITIAL_VISIBLE_PER_CATEGORY && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => toggleExpand(cat.id)}
                      className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
                    >
                      Réduire ↑
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      {/* Récap sélection + alerte faisabilité */}
      <div className="space-y-2">
        {feasibility?.over && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <div>
                <span className="font-semibold">Programme un peu ambitieux</span>{' '}
                — {feasibility.basesCount} étapes assez dispersées pour{' '}
                {feasibility.totalDays} jour
                {feasibility.totalDays > 1 ? 's' : ''}. Idéalement, il faudrait
                environ <strong>{feasibility.suggestedDays} jours</strong>.
                <div className="text-xs text-amber-800 mt-1">
                  Tu peux <strong>retirer quelques lieux</strong> (reclique
                  dessus), ou <strong>continuer quand même</strong> : l'IA fera
                  un choix réaliste et t'indiquera ce qu'elle a écarté.
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="text-sm text-slate-600 text-center">
          <span className="font-semibold text-brand-700">{totalSelected}</span>{' '}
          sélection{totalSelected > 1 ? 's' : ''}
          {totalSelected === 0 && ' — coche au moins une ville ou un lieu'}
        </div>
      </div>
    </div>
  );
}

function CityCard({ city, photoUrl, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`text-left w-full overflow-hidden rounded-2xl border bg-white transition-all flex flex-col ${
        selected
          ? 'border-brand-600 ring-2 ring-brand-500 shadow-glow'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="relative h-44 bg-slate-100">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={city.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 text-3xl animate-pulse">
            🏙️
          </div>
        )}
        <div className="absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center text-base shadow-pop transition-colors bg-white/80 backdrop-blur text-slate-400">
          {selected ? (
            <span className="h-8 w-8 -m-px rounded-full bg-brand-600 text-white flex items-center justify-center">
              ✓
            </span>
          ) : (
            <span>+</span>
          )}
        </div>
        {city.suggested_days && (
          <span className="absolute top-2 left-2 chip bg-black/60 text-white backdrop-blur">
            {city.suggested_days} jour{city.suggested_days > 1 ? 's' : ''}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent pointer-events-none" />
        <div className="absolute bottom-2 left-3 right-3 text-white">
          <h4 className="font-bold leading-tight drop-shadow text-lg">
            {city.name}
          </h4>
        </div>
      </div>
      <div className="p-4 space-y-2 flex-1 flex flex-col">
        <p className="text-sm font-semibold text-slate-900 leading-snug">
          {city.hook}
        </p>
        {city.why && (
          <p className="text-xs text-slate-500 italic leading-relaxed">
            {city.why}
          </p>
        )}
      </div>
    </button>
  );
}

function CategorySkeleton({ color }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <div
          className={`h-4 w-4 rounded-full bg-gradient-to-r ${color} animate-pulse`}
        />
        <span>Nous rédigeons les descriptions…</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            <div className="h-48 bg-slate-100 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 bg-slate-100 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-slate-100 rounded animate-pulse" />
              <div className="h-3 w-full bg-slate-100 rounded animate-pulse" />
              <div className="h-3 w-5/6 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceCard({ place, photoUrl, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const hook = place.hook || place.short_description;
  const hasDetail =
    place.short_description &&
    place.short_description.trim() !== (place.hook || '').trim();

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white transition-all flex flex-col ${
        selected
          ? 'border-brand-600 ring-2 ring-brand-500 shadow-glow'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="text-left w-full"
        aria-pressed={selected}
      >
        <div className="relative h-44 bg-slate-100">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={place.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300 text-3xl animate-pulse">
              📷
            </div>
          )}
          <div className="absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center text-base shadow-pop transition-colors bg-white/80 backdrop-blur text-slate-400">
            {selected ? (
              <span className="h-8 w-8 -m-px rounded-full bg-brand-600 text-white flex items-center justify-center">
                ✓
              </span>
            ) : (
              <span>+</span>
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent pointer-events-none" />
          <div className="absolute bottom-2 left-3 right-3 text-white">
            <h4 className="font-bold leading-tight drop-shadow text-base">
              {place.name}
            </h4>
            {place.location && (
              <p className="text-xs text-white/85 drop-shadow">
                📍 {place.location}
              </p>
            )}
          </div>
        </div>
      </button>

      <div className="p-4 space-y-3 flex-1 flex flex-col">
        <p className="text-sm font-semibold text-slate-900 leading-snug">
          {hook}
        </p>

        {expanded && hasDetail && (
          <p className="text-sm text-slate-600 leading-relaxed">
            {place.short_description}
          </p>
        )}

        {hasDetail && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium self-start hover:underline"
          >
            {expanded ? '↑ Réduire' : '↓ Lire la suite'}
          </button>
        )}

        <div className="flex flex-wrap gap-1.5 pt-2 mt-auto border-t border-slate-100">
          {place.suggested_duration && (
            <span className="chip bg-slate-100 text-slate-700">
              ⏱ {place.suggested_duration}
            </span>
          )}
          {place.best_season && place.best_season !== 'Toute l\'année' && (
            <span className="chip bg-amber-50 text-amber-700">
              {place.best_season}
            </span>
          )}
          {place.type && (
            <span className="chip bg-brand-50 text-brand-700">
              {place.type}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
