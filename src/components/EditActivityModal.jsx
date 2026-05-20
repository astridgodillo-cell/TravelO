import { useState } from 'react';

const QUICK_SUGGESTIONS = [
  'Remplace par quelque chose en lien avec la nature',
  'Trouve une option moins chère',
  'Plus enfant-friendly',
  'Décale plus tard dans la journée',
  'Quelque chose de plus court',
  'Une activité culturelle à la place',
  'Une activité sportive à la place',
];

export default function EditActivityModal({
  open,
  activity,
  dayLocation,
  onClose,
  onSubmit,
  loading,
}) {
  const [instructions, setInstructions] = useState('');

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!instructions.trim()) return;
    onSubmit(instructions.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-4 sm:p-6 space-y-4 my-4 sm:my-0 sm:max-h-[90vh] sm:overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              Modifier l'activité
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 break-words">
              <span className="font-medium">{activity?.title}</span>
              {dayLocation && ` · ${dayLocation}`}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none shrink-0"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Que voulez-vous changer ?</label>
            <textarea
              autoFocus
              rows="3"
              className="input"
              placeholder="Ex : Remplace par une dégustation de vin à la place."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInstructions(s)}
                className="text-[11px] sm:text-xs rounded-full border border-slate-200 px-2.5 sm:px-3 py-1 text-slate-600 hover:bg-slate-100"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary w-full sm:w-auto"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !instructions.trim()}
              className="btn-primary w-full sm:w-auto"
            >
              {loading ? 'Remplacement…' : 'Remplacer cette activité'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
