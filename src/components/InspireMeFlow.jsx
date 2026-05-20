import { useEffect, useMemo, useState } from 'react';
import { suggestPlaces } from '../lib/ai';
import { fetchPhotosFor } from '../lib/photos';

const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant' },
  { id: 'roadtrip-voiture', label: '🚗 Road trip voiture' },
  { id: 'roadtrip-van', label: '🚐 Road trip van' },
  { id: 'roadtrip-camping-car', label: '🚍 Road trip camping-car' },
  { id: 'avion-voiture', label: '✈️ Avion + voiture' },
  { id: 'avion-citybreak', label: '✈️ Avion + city break' },
  { id: 'train-international', label: '🚄 Train international' },
  { id: 'circuit-train', label: '🚉 Circuit train' },
  { id: 'velo', label: '🚴 Vélo / cyclotourisme' },
  { id: 'trek', label: '🥾 Trek itinérant' },
  { id: 'croisiere', label: '🛳️ Croisière' },
  { id: 'sejour-fixe', label: '🏖️ Séjour fixe' },
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

export default function InspireMeFlow({ onSubmit, loading }) {
  const [phase, setPhase] = useState('form');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [places, setPlaces] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [photoMap, setPhotoMap] = useState({});
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
    setPhase('fetching');
    try {
      const list = await suggestPlaces({
        destination: form.destination,
        tripType: form.tripType,
        startDate: form.startDate,
        endDate: form.endDate,
        adults: form.adults,
        childrenAges: form.childrenAges,
      });
      setPlaces(list);
      setSelected(new Set());
      setPhase('selecting');
    } catch (err) {
      setError(err.message || 'Erreur lors de la recherche de lieux.');
      setPhase('form');
    }
  }

  useEffect(() => {
    if (phase !== 'selecting' || places.length === 0) return;
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        places.map(async (p) => {
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
      if (!cancelled) {
        setPhotoMap(Object.fromEntries(entries));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [phase, places]);

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
    setPlaces([]);
    setSelected(new Set());
    setPhotoMap({});
  }

  function buildPreferences() {
    const selectedPlaces = places.filter((p) => selected.has(p.id));
    const mustInclude = selectedPlaces
      .map((p) => `${p.name}${p.location ? ` (${p.location})` : ''}`)
      .join(', ');

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
    if (selected.size === 0) {
      alert('Sélectionnez au moins un lieu avant de générer l\'itinéraire.');
      return;
    }
    onSubmit(buildPreferences());
  }

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
            L'IA vous propose ensuite une sélection de lieux à découvrir
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
                  className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
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

  // ─────────── PHASE FETCHING ───────────
  if (phase === 'fetching') {
    return (
      <div className="card text-center py-16 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
        <h2 className="text-lg font-semibold text-slate-900">
          L'IA explore {form.destination}…
        </h2>
        <p className="text-slate-600 text-sm max-w-md mx-auto">
          On rassemble pour vous une sélection d'incontournables,
          d'insolites et de pépites cachées. ~15 secondes.
        </p>
      </div>
    );
  }

  // ─────────── PHASE SELECTING ───────────
  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Que voulez-vous voir à {form.destination} ?
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Cliquez pour sélectionner les lieux qui vous tentent.
              L'itinéraire sera construit autour de vos choix.
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

      {CATEGORIES.map((cat) => {
        const list = placesByCategory[cat.id] || [];
        if (list.length === 0) return null;
        return (
          <section key={cat.id} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3
                className={`text-lg font-semibold bg-gradient-to-r ${cat.color} bg-clip-text text-transparent`}
              >
                {cat.emoji} {cat.label}
              </h3>
              <p className="text-xs text-slate-500">{cat.hint}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  photoUrl={photoMap[place.id]}
                  selected={selected.has(place.id)}
                  onToggle={() => toggleSelect(place.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Sticky bottom bar */}
      <div className="sticky bottom-4 z-10">
        <div className="card flex flex-wrap items-center justify-between gap-3 shadow-glow border-brand-200">
          <div className="text-sm">
            <span className="font-semibold text-brand-700">
              {selected.size}
            </span>{' '}
            lieu{selected.size > 1 ? 'x' : ''} sélectionné
            {selected.size > 1 ? 's' : ''} sur {places.length}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || selected.size === 0}
            className="btn-pop text-base px-6 py-3"
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

function PlaceCard({ place, photoUrl, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-left w-full overflow-hidden rounded-2xl border bg-white transition-all ${
        selected
          ? 'border-brand-600 ring-2 ring-brand-500 shadow-glow'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="relative h-40 bg-slate-100">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={place.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 text-3xl">
            📷
          </div>
        )}
        {selected && (
          <div className="absolute top-2 right-2 h-7 w-7 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm shadow-pop">
            ✓
          </div>
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold text-slate-900 leading-tight">
            {place.name}
          </h4>
        </div>
        {place.location && (
          <p className="text-xs text-slate-500">📍 {place.location}</p>
        )}
        <p className="text-sm text-slate-600 line-clamp-3">
          {place.short_description}
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {place.suggested_duration && (
            <span className="chip bg-slate-100 text-slate-600">
              ⏱ {place.suggested_duration}
            </span>
          )}
          {place.type && (
            <span className="chip bg-brand-50 text-brand-700">
              {place.type}
            </span>
          )}
        </div>
      </div>
    </button>
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
