import { useEffect, useState } from 'react';

const TYPE_STYLES = {
  repos: { icon: '🛌', label: 'Repos', bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-800' },
  culture: { icon: '🏛️', label: 'Culture', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
  gastronomie: { icon: '🍽️', label: 'Gastronomie', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800' },
  nature: { icon: '🌿', label: 'Nature', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
  gratuit: { icon: '💸', label: 'Gratuit / peu cher', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-800' },
};

/**
 * Modale qui propose 5 alternatives pour un moment donné de la journée.
 * L'utilisateur clique sur "Choisir" → ça remplace le moment dans l'itinéraire
 * (via le handler passé en prop) et la modale se ferme.
 *
 * Props :
 *  - open                : boolean
 *  - onClose             : () => void
 *  - context             : { dayIndex, momentKey, label, m, dayLocation } (info contextuelle)
 *  - alternatives        : array | null (null = encore en chargement)
 *  - loading             : boolean
 *  - onPick(alt)         : async (alt) => void   — applique le choix
 */
export default function MomentAlternativesModal({
  open,
  onClose,
  context,
  alternatives,
  loading,
  onPick,
}) {
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!open) setPicking(false);
  }, [open]);

  if (!open) return null;

  async function pick(alt) {
    if (picking) return;
    setPicking(true);
    try {
      await onPick(alt);
      onClose();
    } catch (e) {
      console.error('[MomentAlternativesModal] pick failed', e);
      // On laisse la modale ouverte pour que l'utilisateur retente
    } finally {
      setPicking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-2xl max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-glow overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-violet-600 font-bold">
              Autres options pour ce moment
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">
              {context?.label} — {context?.dayLocation}
            </h2>
            {context?.m?.title && (
              <p className="text-xs text-slate-500 mt-1 truncate">
                Actuellement : {context.m.title}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={picking}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading || !alternatives ? (
            <div className="py-12 text-center text-sm text-slate-500">
              <div className="inline-flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                Recherche d'alternatives cohérentes…
              </div>
              <p className="text-xs text-slate-400 mt-2">
                L'IA examine les moments adjacents, votre hôtel, la météo et
                les contraintes vol pour proposer des options réalisables.
              </p>
            </div>
          ) : alternatives.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Aucune alternative n'a pu être générée. Réessayez ou modifiez
              directement le titre / la description en cliquant dessus.
            </div>
          ) : (
            <ul className="space-y-3">
              {alternatives.map((alt, i) => {
                const style = TYPE_STYLES[alt.type] || TYPE_STYLES.culture;
                return (
                  <li
                    key={i}
                    className={`rounded-xl border ${style.border} ${style.bg} p-4`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-white/80 ${style.text}`}
                          >
                            <span>{style.icon}</span>
                            <span>{style.label}</span>
                          </span>
                          {alt.estimated_duration && (
                            <span className="text-[10px] text-slate-500">
                              ⏱ {alt.estimated_duration}
                            </span>
                          )}
                        </div>
                        <div className="font-semibold text-slate-900">
                          {alt.title}
                        </div>
                        <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                          {alt.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => pick(alt)}
                        disabled={picking}
                        className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold transition-colors"
                      >
                        Choisir
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 text-xs text-slate-500 flex flex-wrap items-center gap-2 justify-between">
          <span>
            💡 Tu peux aussi modifier directement le titre ou la description en
            cliquant dessus dans l'itinéraire.
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={picking}
            className="text-slate-500 hover:underline disabled:opacity-50"
          >
            Annuler
          </button>
        </footer>
      </div>
    </div>
  );
}
