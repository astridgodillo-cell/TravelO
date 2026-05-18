import { useState } from 'react';

const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant' },
  { id: 'roadtrip-voiture', label: 'Road trip voiture' },
  { id: 'roadtrip-van', label: 'Road trip van' },
  { id: 'circuit-train', label: 'Circuit train' },
  { id: 'sejour-fixe', label: 'Séjour fixe' },
];

const INTERESTS = [
  'nature',
  'culture',
  'gastronomie',
  'plage',
  'sport',
  'randonnée',
  'modernité',
  'hors des sentiers battus',
];

const BUDGET_LEVELS = [
  { id: 'economique', label: 'Économique' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'confort', label: 'Confort' },
  { id: 'haut-de-gamme', label: 'Haut de gamme' },
];

const DEFAULTS = {
  destinations: '',
  startDate: '',
  endDate: '',
  departureLocation: '',
  returnLocation: '',
  adults: 2,
  childrenAges: [],
  tripType: 'itinerant',
  interests: ['culture', 'gastronomie'],
  budget: 'moyen',
  mustInclude: '',
  toAvoid: '',
};

export default function PreferencesForm({ onSubmit, loading }) {
  const [values, setValues] = useState(DEFAULTS);

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function toggle(field, value) {
    setValues((v) => ({
      ...v,
      [field]: v[field].includes(value)
        ? v[field].filter((x) => x !== value)
        : [...v[field], value],
    }));
  }

  function addChild() {
    setValues((v) => ({ ...v, childrenAges: [...v.childrenAges, 5] }));
  }

  function updateChildAge(index, age) {
    setValues((v) => ({
      ...v,
      childrenAges: v.childrenAges.map((a, i) => (i === index ? Number(age) : a)),
    }));
  }

  function removeChild(index) {
    setValues((v) => ({
      ...v,
      childrenAges: v.childrenAges.filter((_, i) => i !== index),
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!values.returnLocation) {
      update('returnLocation', values.departureLocation);
      onSubmit({ ...values, returnLocation: values.departureLocation });
    } else {
      onSubmit(values);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">
          Planifions votre voyage
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Remplissez les champs ci-dessous — Claude rédige ensuite votre itinéraire
          jour-par-jour comme un tour-opérateur.
        </p>
      </div>

      <Section title="Destination & dates">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="label">Destination(s)</label>
            <input
              required
              className="input"
              placeholder="Ex : Sicile, ou Lisbonne + Porto + Sintra"
              value={values.destinations}
              onChange={(e) => update('destinations', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date de début</label>
            <input
              required
              type="date"
              className="input"
              value={values.startDate}
              onChange={(e) => update('startDate', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date de fin</label>
            <input
              required
              type="date"
              className="input"
              value={values.endDate}
              onChange={(e) => update('endDate', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Lieu de départ</label>
            <input
              required
              className="input"
              placeholder="Ex : Paris, France"
              value={values.departureLocation}
              onChange={(e) => update('departureLocation', e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Lieu de retour
              <span className="text-slate-400 font-normal"> (vide = identique)</span>
            </label>
            <input
              className="input"
              placeholder="Identique au lieu de départ"
              value={values.returnLocation}
              onChange={(e) => update('returnLocation', e.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section title="Participants">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nombre d'adultes</label>
            <input
              required
              type="number"
              min="1"
              className="input"
              value={values.adults}
              onChange={(e) => update('adults', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Enfants (avec âges)</label>
            <div className="space-y-2">
              {values.childrenAges.length === 0 && (
                <p className="text-sm text-slate-400">Aucun enfant</p>
              )}
              {values.childrenAges.map((age, i) => (
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

      <Section title="Type de voyage">
        <div className="flex flex-wrap gap-2">
          {TRIP_TYPES.map((t) => {
            const active = values.tripType === t.id;
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

      <Section title="Centres d'intérêt">
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const active = values.interests.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle('interests', i)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors capitalize ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {i}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Budget">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BUDGET_LEVELS.map((b) => {
            const active = values.budget === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => update('budget', b.id)}
                className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Préférences spécifiques">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Lieux impératifs à inclure</label>
            <textarea
              rows="3"
              className="input"
              placeholder="Ex : Mont Saint-Michel, dîner à La Mère Poulard"
              value={values.mustInclude}
              onChange={(e) => update('mustInclude', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Lieux ou choses à éviter</label>
            <textarea
              rows="3"
              className="input"
              placeholder="Ex : foules touristiques, vols intérieurs"
              value={values.toAvoid}
              onChange={(e) => update('toAvoid', e.target.value)}
            />
          </div>
        </div>
      </Section>

      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary text-base px-6 py-3"
        >
          {loading ? 'Génération en cours…' : 'Générer mon itinéraire'}
        </button>
      </div>
    </form>
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
