import { useState } from 'react';
import { setItineraryAsTemplate } from '../lib/supabase';

const CATEGORIES = [
  'Road trip',
  'City break',
  'Vélo',
  'Trek',
  'Croisière',
  'Famille',
  'Romantique',
  'Aventure',
  'Culturel',
  'Gastronomique',
  'Autre',
];

export default function AdminTemplatePanel({ itinerary, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState(
    itinerary.template_category || 'Road trip'
  );
  const [description, setDescription] = useState(
    itinerary.template_description || ''
  );

  const isTemplate = !!itinerary.is_template;

  async function toggle(makeTemplate) {
    setBusy(true);
    setError(null);
    const patch = makeTemplate
      ? {
          is_template: true,
          template_category: category,
          template_description: description.trim() || null,
        }
      : { is_template: false };
    const { data, error } = await setItineraryAsTemplate(itinerary.id, patch);
    if (error) setError(error.message);
    else onUpdate?.(data);
    setBusy(false);
  }

  async function saveMeta() {
    if (!isTemplate) return;
    setBusy(true);
    setError(null);
    const { data, error } = await setItineraryAsTemplate(itinerary.id, {
      template_category: category,
      template_description: description.trim() || null,
    });
    if (error) setError(error.message);
    else onUpdate?.(data);
    setBusy(false);
  }

  return (
    <div className="card border-purple-200 bg-purple-50/50 print:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-purple-700">
            📘 Bibliothèque de modèles (Admin)
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            {isTemplate
              ? 'Cet itinéraire est proposé comme MODÈLE aux nouveaux utilisateurs.'
              : 'Marquez cet itinéraire comme modèle pour le proposer en exemple aux nouveaux utilisateurs.'}
          </p>
        </div>
        <button
          onClick={() => toggle(!isTemplate)}
          disabled={busy}
          className={isTemplate ? 'btn-secondary' : 'btn-primary'}
        >
          {busy
            ? '…'
            : isTemplate
              ? 'Retirer des modèles'
              : 'Ajouter aux modèles'}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600">{error}</div>
      )}

      {isTemplate && (
        <div className="mt-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Catégorie</label>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={saveMeta}
                disabled={busy}
                className="btn-secondary"
              >
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Description (optionnel)</label>
            <textarea
              rows="2"
              className="input"
              placeholder="Ex : Road trip en van de 3 semaines pour une famille avec enfants, parfait pour découvrir la Bretagne."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
