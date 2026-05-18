import { useState } from 'react';

const TRANSPORT_OPTIONS = ['avion', 'train', 'voiture', 'bateau', 'bus'];
const ACCOMMODATION_OPTIONS = ['Hôtel', 'Airbnb', 'Camping', 'Auberge', 'Resort'];
const ACTIVITY_OPTIONS = [
  'culture',
  'plage',
  'sport',
  'nature',
  'gastronomie',
  'shopping',
  'vie nocturne',
  'bien-être',
];

const DEFAULT_VALUES = {
  destinations: '',
  startDate: '',
  endDate: '',
  adults: 2,
  children: 0,
  transport: 'avion',
  accommodation: 'Hôtel',
  activities: ['culture', 'gastronomie'],
  budget: 1500,
  notes: '',
};

export default function PreferencesForm({ onSubmit, loading }) {
  const [values, setValues] = useState(DEFAULT_VALUES);

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function toggleActivity(act) {
    setValues((v) => ({
      ...v,
      activities: v.activities.includes(act)
        ? v.activities.filter((a) => a !== act)
        : [...v.activities, act],
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Vos préférences de voyage
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Renseignez quelques informations pour générer un itinéraire complet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label">Destination(s)</label>
          <input
            required
            className="input"
            placeholder="Ex : Lisbonne, Porto"
            value={values.destinations}
            onChange={(e) => update('destinations', e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">
            Séparez plusieurs lieux par des virgules.
          </p>
        </div>

        <div>
          <label className="label">Date de début</label>
          <input
            type="date"
            required
            className="input"
            value={values.startDate}
            onChange={(e) => update('startDate', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Date de fin</label>
          <input
            type="date"
            required
            className="input"
            value={values.endDate}
            onChange={(e) => update('endDate', e.target.value)}
          />
        </div>

        <div>
          <label className="label">Adultes</label>
          <input
            type="number"
            min="1"
            className="input"
            value={values.adults}
            onChange={(e) => update('adults', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Enfants</label>
          <input
            type="number"
            min="0"
            className="input"
            value={values.children}
            onChange={(e) => update('children', Number(e.target.value))}
          />
        </div>

        <div>
          <label className="label">Transport</label>
          <select
            className="input"
            value={values.transport}
            onChange={(e) => update('transport', e.target.value)}
          >
            {TRANSPORT_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Hébergement</label>
          <select
            className="input"
            value={values.accommodation}
            onChange={(e) => update('accommodation', e.target.value)}
          >
            {ACCOMMODATION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="label">Activités souhaitées</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_OPTIONS.map((act) => {
              const active = values.activities.includes(act);
              return (
                <button
                  type="button"
                  key={act}
                  onClick={() => toggleActivity(act)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {act}
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="label">Budget total indicatif (€)</label>
          <input
            type="number"
            min="0"
            step="50"
            className="input"
            value={values.budget}
            onChange={(e) => update('budget', Number(e.target.value))}
          />
        </div>

        <div className="md:col-span-2">
          <label className="label">Notes complémentaires</label>
          <textarea
            rows="3"
            className="input"
            placeholder="Allergies, mobilité réduite, contraintes…"
            value={values.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Génération…' : 'Générer mon itinéraire'}
        </button>
      </div>
    </form>
  );
}
