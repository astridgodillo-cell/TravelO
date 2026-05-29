import { useEffect, useMemo, useState } from 'react';
import { suggestCities, suggestActivities } from '../lib/ai';
import { fetchPhotosFor } from '../lib/photos';

// Écran "Je choisis mes lieux" en DEUX temps (prop `phase`) :
//   phase = 'cities'     → 10-15 villes / régions / lieux incontournables.
//   phase = 'activities' → activités (incontournables / insolites /
//                          hors-sentiers) ASSOCIÉES aux villes choisies.
//
// L'état est porté par le parent (le wizard) via `state` + `onState`, pour
// survivre quand on change d'étape (le composant est démonté/remonté).

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

const norm = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const EMPTY_DISCOVER = {
  citiesKey: null,
  citiesReady: false,
  cities: [],
  selectedCities: [],
  activitiesKey: null,
  readyCategories: [],
  places: [],
  selectedPlaces: [],
  photoMap: {},
  error: null,
};

// Construit le texte "Étapes impératives" (mustInclude) depuis la sélection.
export function buildMustInclude(cities, places, selectedCities, selectedPlaces) {
  const selCity = (cities || []).filter((c) => (selectedCities || []).includes(c.id));
  const selPlace = (places || []).filter((p) => (selectedPlaces || []).includes(p.id));
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
  phase = 'cities',
  state,
  onState,
  onSelectionChange,
}) {
  const d = state || EMPTY_DISCOVER;
  const [expanded, setExpanded] = useState(new Set());

  const totalDays = computeTotalDays(startDate, endDate);
  const citiesKey = JSON.stringify({
    d: norm(destination),
    startDate,
    endDate,
    tripType,
    adults,
    childrenAges,
  });
  const focus = useMemo(
    () =>
      (d.cities || [])
        .filter((c) => (d.selectedCities || []).includes(c.id))
        .map((c) => c.name),
    [d.cities, d.selectedCities]
  );
  const activitiesKey = JSON.stringify({ base: citiesKey, focus: [...focus].sort() });

  function patch(updater) {
    onState((prev) => {
      const base = prev || EMPTY_DISCOVER;
      const next = typeof updater === 'function' ? updater(base) : updater;
      return { ...base, ...next };
    });
  }

  async function loadPhotosFor(list) {
    const entries = await Promise.all(
      (list || []).map(async (p) => {
        const q = p.photo_query || `${p.name} ${p.location || ''}`.trim();
        const photos = await fetchPhotosFor(q, 1);
        const photo = photos?.[0];
        const url =
          photo?.src?.medium || photo?.src?.large || photo?.src?.small || null;
        return [p.id, url];
      })
    );
    patch((prev) => ({
      photoMap: { ...prev.photoMap, ...Object.fromEntries(entries) },
    }));
  }

  // ── Phase VILLES : on récupère les villes/régions de la destination ──
  useEffect(() => {
    if (phase !== 'cities' || !destination) return;
    if (d.citiesKey === citiesKey) return;
    let cancelled = false;
    onState((prev) => ({
      ...(prev || EMPTY_DISCOVER),
      citiesKey,
      citiesReady: false,
      cities: [],
      selectedCities: [],
      error: null,
    }));
    suggestCities({ destination, tripType, startDate, endDate, adults, childrenAges })
      .then((cities) => {
        if (cancelled) return;
        patch({ cities, citiesReady: true });
        loadPhotosFor(cities);
      })
      .catch((err) => {
        if (cancelled) return;
        patch({ citiesReady: true, error: err.message || 'Erreur lors de la recherche de villes.' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, citiesKey, destination]);

  // ── Phase ACTIVITÉS : activités liées aux villes choisies ──
  useEffect(() => {
    if (phase !== 'activities' || focus.length === 0) return;
    if (d.activitiesKey === activitiesKey) return;
    let cancelled = false;
    onState((prev) => ({
      ...(prev || EMPTY_DISCOVER),
      activitiesKey,
      readyCategories: [],
      places: [],
      selectedPlaces: [],
      error: null,
    }));
    suggestActivities({
      destination,
      tripType,
      startDate,
      endDate,
      adults,
      childrenAges,
      focus,
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
      patch({ error: err.message || 'Erreur lors de la recherche d\'activités.' });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activitiesKey]);

  // Remonte la sélection (mustInclude + lieux) au parent.
  useEffect(() => {
    const mustInclude = buildMustInclude(
      d.cities,
      d.places,
      d.selectedCities,
      d.selectedPlaces
    );
    const selectedPlaceObjs = (d.places || []).filter((p) =>
      (d.selectedPlaces || []).includes(p.id)
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
    for (const p of d.places || []) {
      const cat = groups[p.category] ? p.category : 'incontournable';
      groups[cat].push(p);
    }
    return groups;
  }, [d.places]);

  const selectedCitiesSet = new Set(d.selectedCities || []);
  const selectedPlacesSet = new Set(d.selectedPlaces || []);

  // ════════════ PHASE VILLES ════════════
  if (phase === 'cities') {
    const feasibility = computeFeasibility(d, totalDays);
    return (
      <div className="space-y-5">
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Où veux-tu aller à {destination} ?
          </h2>
          <p className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">
            Choisis les villes / régions qui te tentent. À l'étape suivante, on
            te proposera des activités UNIQUEMENT dans ces endroits.
          </p>
        </div>

        {d.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {d.error}
          </div>
        )}

        {!d.citiesReady ? (
          <CategorySkeleton color="from-sky-500 to-brand-600" />
        ) : (
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
        )}

        {feasibility?.over && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <div>
                <span className="font-semibold">Programme un peu ambitieux</span>{' '}
                — {feasibility.basesCount} étapes pour {feasibility.totalDays} jour
                {feasibility.totalDays > 1 ? 's' : ''}. Idéalement ~
                <strong>{feasibility.suggestedDays} jours</strong>. Tu peux en
                retirer, ou continuer (l'IA fera un programme réaliste et
                t'indiquera ce qu'elle a écarté).
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-slate-600">
          <span className="font-semibold text-brand-700">
            {d.selectedCities?.length || 0}
          </span>{' '}
          étape{(d.selectedCities?.length || 0) > 1 ? 's' : ''} choisie
          {(d.selectedCities?.length || 0) > 1 ? 's' : ''}
          {(d.selectedCities?.length || 0) === 0 && ' — coche au moins une étape'}
        </p>
      </div>
    );
  }

  // ════════════ PHASE ACTIVITÉS ════════════
  const allReady = d.readyCategories?.length === CATEGORIES.length;
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Quoi faire dans tes étapes ?
        </h2>
        <p className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">
          Des activités proposées UNIQUEMENT dans les étapes que tu as choisies.
          Coche ce qui te tente (optionnel) — l'IA bâtira le voyage autour.
        </p>
        {focus.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {focus.map((name) => (
              <span
                key={name}
                className="chip bg-brand-50 text-brand-700 border border-brand-200"
              >
                📍 {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {d.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {d.error}
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const list = placesByCategory[cat.id] || [];
        const isReady = (d.readyCategories || []).includes(cat.id);
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
                  {list.length} activités
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
                      Voir {hidden} de plus ↓
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

      <p className="text-center text-sm text-slate-600">
        <span className="font-semibold text-brand-700">
          {d.selectedPlaces?.length || 0}
        </span>{' '}
        activité{(d.selectedPlaces?.length || 0) > 1 ? 's' : ''} choisie
        {(d.selectedPlaces?.length || 0) > 1 ? 's' : ''}
        {allReady && (d.selectedPlaces?.length || 0) === 0 && ' (optionnel)'}
      </p>
    </div>
  );
}

// Estimation de faisabilité (trop d'étapes dispersées pour la durée ?).
function computeFeasibility(d, totalDays) {
  if (!totalDays) return null;
  const sel = (d.cities || []).filter((c) =>
    (d.selectedCities || []).includes(c.id)
  );
  if (sel.length === 0) return null;
  let daysNeeded = 0;
  for (const c of sel) daysNeeded += Number(c.suggested_days) || 2;
  if (sel.length > 1) daysNeeded += (sel.length - 1) * 0.5;
  return {
    over: daysNeeded > totalDays + 0.5,
    basesCount: sel.length,
    totalDays,
    suggestedDays: Math.ceil(daysNeeded),
  };
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
        <span>Nous préparons les suggestions…</span>
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
            <span className="chip bg-brand-50 text-brand-700">{place.type}</span>
          )}
        </div>
      </div>
    </div>
  );
}
