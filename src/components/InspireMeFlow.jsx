import { useEffect, useMemo, useState } from 'react';
import { suggestPlaces } from '../lib/ai';
import { fetchPhotosFor } from '../lib/photos';
import Icon from './Icon';

const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant', icon: 'route' },
  { id: 'roadtrip-voiture', label: 'Road trip voiture', icon: 'car' },
  { id: 'roadtrip-van', label: 'Road trip van / camping-car', icon: 'van' },
  { id: 'avion-voiture', label: 'Avion + voiture', icon: 'plane-car' },
  { id: 'avion-citybreak', label: 'Avion + city break', icon: 'plane-walk' },
  { id: 'train-international', label: 'Train international', icon: 'train' },
  { id: 'circuit-train', label: 'Circuit train', icon: 'train-circle' },
  { id: 'velo', label: 'Vélo / cyclotourisme', icon: 'bike' },
  { id: 'trek', label: 'Trek itinérant', icon: 'hiking' },
  { id: 'croisiere', label: 'Croisière', icon: 'ship' },
  { id: 'sejour-fixe', label: 'Séjour fixe', icon: 'beach' },
];

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

const ROAD_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
]);

const DEFAULT_FORM = {
  destination: '',
  departureLocation: '',
  startDate: '',
  endDate: '',
  tripType: 'itinerant',
  adults: 2,
  childrenAges: [],
};

function computeTotalDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

const INITIAL_VISIBLE_PER_CATEGORY = 9;

export default function InspireMeFlow({ onSubmit, loading }) {
  const [phase, setPhase] = useState('form');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [cities, setCities] = useState([]);
  const [citiesReady, setCitiesReady] = useState(false);
  const [places, setPlaces] = useState([]);
  const [readyCategories, setReadyCategories] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [selectedCities, setSelectedCities] = useState(new Set());
  const [photoMap, setPhotoMap] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [error, setError] = useState(null);

  const totalDays = computeTotalDays(form.startDate, form.endDate);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function addChild() {
    setForm((f) => ({ ...f, childrenAges: [...f.childrenAges, 5] }));
  }
  function updateChildAge(index, age) {
    setForm((f) => ({
      ...f,
      childrenAges: f.childrenAges.map((a, i) =>
        i === index ? Number(age) : a
      ),
    }));
  }
  function removeChild(index) {
    setForm((f) => ({
      ...f,
      childrenAges: f.childrenAges.filter((_, i) => i !== index),
    }));
  }

  async function handleDiscover(e) {
    e?.preventDefault?.();
    if (
      form.startDate &&
      form.endDate &&
      form.endDate < form.startDate
    ) {
      alert('La date de fin doit être après la date de début.');
      return;
    }
    setError(null);
    setCities([]);
    setCitiesReady(false);
    setPlaces([]);
    setReadyCategories(new Set());
    setSelected(new Set());
    setSelectedCities(new Set());
    setPhotoMap({});
    setExpanded(new Set());
    setPhase('selecting');
    try {
      await suggestPlaces({
        destination: form.destination,
        tripType: form.tripType,
        startDate: form.startDate,
        endDate: form.endDate,
        adults: form.adults,
        childrenAges: form.childrenAges,
        // Streaming : chaque résultat s'affiche dès qu'il arrive
        onCitiesReady: (newCities) => {
          setCities(newCities);
          setCitiesReady(true);
          loadPhotosFor(newCities);
        },
        onCategoryReady: (category, newPlaces) => {
          setPlaces((prev) => [...prev, ...newPlaces]);
          setReadyCategories((prev) => new Set(prev).add(category));
          loadPhotosFor(newPlaces);
        },
      });
    } catch (err) {
      setError(err.message || 'Erreur lors de la recherche de lieux.');
      setPhase('form');
    }
  }

  async function loadPhotosFor(list) {
    const entries = await Promise.all(
      list.map(async (p) => {
        const query = p.photo_query || `${p.name} ${p.location || ''}`.trim();
        const photos = await fetchPhotosFor(query, 1);
        const photo = photos?.[0];
        const url =
          photo?.src?.medium ||
          photo?.src?.large ||
          photo?.src?.small ||
          null;
        return [p.id, url];
      })
    );
    setPhotoMap((prev) => ({
      ...prev,
      ...Object.fromEntries(entries),
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

  function toggleSelect(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function backToForm() {
    setPhase('form');
    setCities([]);
    setCitiesReady(false);
    setPlaces([]);
    setReadyCategories(new Set());
    setSelected(new Set());
    setSelectedCities(new Set());
    setPhotoMap({});
    setExpanded(new Set());
  }

  function toggleSelectCity(id) {
    setSelectedCities((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildPreferences() {
    const selectedPlaces = places.filter((p) => selected.has(p.id));
    const selectedCityList = cities.filter((c) => selectedCities.has(c.id));
    const cityChunk = selectedCityList
      .map(
        (c) =>
          `${c.name} (${c.suggested_days || 2} jour${(c.suggested_days || 2) > 1 ? 's' : ''})`
      )
      .join(', ');
    const placeChunk = selectedPlaces
      .map((p) => `${p.name}${p.location ? ` (${p.location})` : ''}`)
      .join(', ');
    const mustInclude = [cityChunk && `Villes : ${cityChunk}`, placeChunk]
      .filter(Boolean)
      .join(' — ');

    const isRoadTrip = ROAD_TRIP_TYPES.has(form.tripType);

    return {
      destinations: form.destination,
      startDate: form.startDate,
      endDate: form.endDate,
      departureLocation: form.departureLocation,
      returnLocation: form.departureLocation,
      adults: form.adults,
      childrenAges: form.childrenAges,
      tripType: form.tripType,
      interests: ['culture', 'gastronomie', 'nature'],
      specificActivities: [],
      budget: 'moyen',
      offDays: 0,
      mustInclude,
      toAvoid: '',
      vehicle: null,
      nightStayPreferences: isRoadTrip
        ? ['Hôtel', 'Aire de camping-car publique', 'Camping classique']
        : ['Hôtel'],
      cooking: isRoadTrip ? 'mix' : 'restaurants',
      needsServicePoints: false,
      okWithFerry: true,
      _generationMode: 'inspire-me',
      _selectedPlaces: selectedPlaces,
    };
  }

  function handleGenerate() {
    if (selected.size === 0 && selectedCities.size === 0) {
      alert(
        'Sélectionnez au moins une ville ou un lieu avant de générer l\'itinéraire.'
      );
      return;
    }
    onSubmit(buildPreferences());
  }

  const totalSelected = selected.size + selectedCities.size;

  const placesByCategory = useMemo(() => {
    const groups = { incontournable: [], insolite: [], 'hors-sentiers': [] };
    for (const p of places) {
      const cat = groups[p.category] ? p.category : 'incontournable';
      groups[cat].push(p);
    }
    return groups;
  }, [places]);

  // ─────────── PHASE FORM ───────────
  if (phase === 'form') {
    return (
      <form onSubmit={handleDiscover} className="card space-y-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            ✨ Inspire-moi
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Dites-nous juste où, quand et comment vous voulez voyager.
            Nous vous proposons ensuite une sélection de lieux à découvrir
            — vous choisissez ce qui vous plaît, et on construit
            l'itinéraire.
          </p>
        </div>

        <Section title="Où allez-vous ?">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="label">Destination</label>
              <input
                required
                className="input"
                placeholder="Ex : Lisbonne, Corse, Japon, Slovénie…"
                value={form.destination}
                onChange={(e) => update('destination', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Lieu de départ</label>
              <input
                required
                className="input"
                placeholder="Ex : Paris, France"
                value={form.departureLocation}
                onChange={(e) => update('departureLocation', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Date de début</label>
                <input
                  required
                  type="date"
                  className="input"
                  value={form.startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setForm((f) => ({
                      ...f,
                      startDate: newStart,
                      endDate:
                        f.endDate && newStart && f.endDate < newStart
                          ? newStart
                          : f.endDate,
                    }));
                  }}
                />
              </div>
              <div>
                <label className="label">Date de fin</label>
                <input
                  required
                  type="date"
                  className="input"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onChange={(e) => update('endDate', e.target.value)}
                />
              </div>
            </div>
          </div>
          {totalDays > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              Durée : {totalDays} jour{totalDays > 1 ? 's' : ''}
            </p>
          )}
        </Section>

        <Section title="Comment voyagez-vous ?">
          <div className="flex flex-wrap gap-2">
            {TRIP_TYPES.map((t) => {
              const active = form.tripType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update('tripType', t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {t.icon && <Icon name={t.icon} className="h-4 w-4" />}
                  {t.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Qui voyage ?">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nombre d'adultes</label>
              <input
                required
                type="number"
                min="1"
                className="input"
                value={form.adults}
                onChange={(e) => update('adults', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Enfants (avec âges)</label>
              <div className="space-y-2">
                {form.childrenAges.length === 0 && (
                  <p className="text-sm text-slate-400">Aucun enfant</p>
                )}
                {form.childrenAges.map((age, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="17"
                      className="input flex-1"
                      value={age}
                      onChange={(e) => updateChildAge(i, e.target.value)}
                    />
                    <span className="text-sm text-slate-500">ans</span>
                    <button
                      type="button"
                      onClick={() => removeChild(i)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Retirer
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addChild}
                  className="btn-secondary"
                >
                  + Ajouter un enfant
                </button>
              </div>
            </div>
          </div>
        </Section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={loading}
            className="btn-pop text-base px-6 py-3"
          >
            ✨ Découvrir des lieux à visiter
          </button>
        </div>
      </form>
    );
  }

  // ─────────── PHASE SELECTING ───────────
  const allReady = readyCategories.size === CATEGORIES.length;

  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Que voulez-vous voir à {form.destination} ?
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {allReady ? (
                <>
                  {places.length} lieux suggérés. Cliquez pour sélectionner
                  ce qui vous tente — l'itinéraire sera construit autour de
                  vos choix.
                </>
              ) : (
                <>
                  Nous explorons {form.destination} en 3 axes en parallèle…
                  ({readyCategories.size}/{CATEGORIES.length} catégories
                  prêtes — vous pouvez déjà sélectionner ce qui est affiché)
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={backToForm}
            className="btn-secondary text-sm"
          >
            ← Modifier la recherche
          </button>
        </div>
      </div>

      {/* Villes principales (en premier si destination = pays/région) */}
      {!citiesReady && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-xl font-semibold bg-gradient-to-r from-sky-500 to-brand-600 bg-clip-text text-transparent">
              🏙️ Villes principales
            </h3>
            <p className="text-xs text-slate-500">
              Les villes que les tour-opérateurs incluent presque toujours
            </p>
          </div>
          <CategorySkeleton color="from-sky-500 to-brand-600" />
        </section>
      )}

      {citiesReady && cities.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-xl font-semibold bg-gradient-to-r from-sky-500 to-brand-600 bg-clip-text text-transparent">
              🏙️ Villes principales
            </h3>
            <p className="text-xs text-slate-500">
              Les villes que les tour-opérateurs incluent presque toujours
            </p>
            <span className="text-xs text-slate-400 ml-auto">
              {cities.length} villes
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cities.map((city) => (
              <CityCard
                key={city.id}
                city={city}
                photoUrl={photoMap[city.id]}
                selected={selectedCities.has(city.id)}
                onToggle={() => toggleSelectCity(city.id)}
              />
            ))}
          </div>
        </section>
      )}

      {CATEGORIES.map((cat) => {
        const list = placesByCategory[cat.id] || [];
        const isReady = readyCategories.has(cat.id);
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
                      photoUrl={photoMap[place.id]}
                      selected={selected.has(place.id)}
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

      {/* Sticky bottom bar */}
      <div className="sticky bottom-2 sm:bottom-4 z-10">
        <div className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-glow border-brand-200">
          <div className="text-sm text-slate-700">
            <span className="font-semibold text-brand-700">
              {totalSelected}
            </span>{' '}
            sélection{totalSelected > 1 ? 's' : ''}
            {selectedCities.size > 0 && (
              <span className="text-slate-500">
                {' '}
                ({selectedCities.size} ville
                {selectedCities.size > 1 ? 's' : ''}, {selected.size} lieu
                {selected.size > 1 ? 'x' : ''})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || totalSelected === 0}
            className="btn-pop text-sm sm:text-base px-4 sm:px-6 py-2.5 sm:py-3 w-full sm:w-auto"
          >
            {loading
              ? 'Génération en cours…'
              : 'Générer mon itinéraire →'}
          </button>
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
      {/* Zone de sélection : photo + titre */}
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

      {/* Hook + description dépliable */}
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

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
