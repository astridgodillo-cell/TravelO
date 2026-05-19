import { useState } from 'react';

export default function ModifyDayModal({
  open,
  day,
  isLastDay,
  onClose,
  onSubmit,
  loading,
}) {
  const [newLocation, setNewLocation] = useState('');
  const [instructions, setInstructions] = useState('');
  const [cascade, setCascade] = useState(false);
  const [makeOffDay, setMakeOffDay] = useState(false);

  if (!open) return null;

  function reset() {
    setNewLocation('');
    setInstructions('');
    setCascade(false);
    setMakeOffDay(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    const parts = [];
    if (makeOffDay) {
      parts.push(
        'Transforme cette journée en JOUR OFF (repos) : aucun gros trajet, on reste sur le lieu de la veille, activités très light ou optionnelles, repas tranquille, anchor_theme commence par "Journée libre" ou "Repos". Mets is_off_day = true.'
      );
    }
    if (newLocation.trim()) {
      parts.push(`Change le lieu pour : ${newLocation.trim()}`);
    }
    if (instructions.trim()) {
      parts.push(instructions.trim());
    }
    if (!parts.length) return;
    onSubmit({ instructions: parts.join('. '), cascade });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Modifier {day?.label} — {day?.location}
            </h3>
            <p className="text-sm text-slate-500">
              Adaptez cette journée à vos envies. Cochez la case si vous voulez
              aussi que la suite du voyage s'adapte automatiquement.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={makeOffDay}
              onChange={(e) => setMakeOffDay(e.target.checked)}
            />
            <div>
              <span className="font-medium text-emerald-800">
                🛋️ Faire de cette journée un jour off (repos)
              </span>
              <div className="text-xs text-emerald-700 mt-0.5">
                Pas de trajet, on reste sur place, activités minimales, repas
                tranquille.
              </div>
            </div>
          </label>

          <div>
            <label className="label">Changer le lieu (optionnel)</label>
            <input
              className="input"
              placeholder={`Actuellement : ${day?.location || ''}`}
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              disabled={makeOffDay}
            />
            {makeOffDay && (
              <p className="text-xs text-slate-500 mt-1">
                (Désactivé : un jour off reste sur le lieu de la veille)
              </p>
            )}
          </div>

          <div>
            <label className="label">Autres consignes</label>
            <textarea
              rows="4"
              className="input"
              placeholder="Ex : Plus de randonnée, hébergement moins cher, retire la visite du château."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          {!isLastDay && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={cascade}
                onChange={(e) => setCascade(e.target.checked)}
              />
              <div>
                <span className="font-medium text-slate-800">
                  Replanifier aussi les jours suivants
                </span>
                <div className="text-xs text-slate-500 mt-0.5">
                  Coche si le changement de lieu impacte la suite (ex : tu pars
                  vers une autre région). Sinon seul ce jour est modifié.
                </div>
              </div>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="btn-secondary"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={
                loading ||
                (!newLocation.trim() && !instructions.trim() && !makeOffDay)
              }
              className="btn-primary"
            >
              {loading
                ? 'Recalcul…'
                : cascade
                  ? 'Modifier + replanifier la suite'
                  : 'Modifier cette journée'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
