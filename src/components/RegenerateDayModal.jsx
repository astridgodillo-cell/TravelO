import { useState } from 'react';

const QUICK_SUGGESTIONS = [
  'Trouve-moi quelque chose moins cher pour cette journée',
  'Plus d\'activités nature / randonnée',
  'Plus calme, moins touristique',
  'Hébergement plus haut de gamme',
  'Décale d\'une heure plus tard',
  'Remplace l\'activité par une option enfant-friendly',
];

export default function RegenerateDayModal({ open, day, onClose, onSubmit, loading }) {
  const [instructions, setInstructions] = useState('');

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!instructions.trim()) return;
    onSubmit(instructions.trim());
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Régénérer {day?.label} — {day?.location}
            </h3>
            <p className="text-sm text-slate-500">
              Décrivez ce que vous souhaitez changer ; nous réécrivons juste cette
              journée en gardant la cohérence avec le reste du voyage.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            autoFocus
            rows="4"
            className="input"
            placeholder="Ex : Je voudrais une journée plus axée sur la randonnée, et un hébergement moins cher avec wifi."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />

          <div className="flex flex-wrap gap-1.5">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInstructions(s)}
                className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-100"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !instructions.trim()}
              className="btn-primary"
            >
              {loading ? 'Régénération…' : 'Régénérer cette journée'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
