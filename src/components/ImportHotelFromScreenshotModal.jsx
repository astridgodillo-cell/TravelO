import { useEffect, useRef, useState } from 'react';
import { extractHotelFromImage } from '../lib/ai';

/**
 * Modale d'import d'un hôtel depuis une capture d'écran (Booking, Hotels.com,
 * Airbnb, etc.). 3 phases :
 *   1) Upload : drag-drop ou bouton "Choisir un fichier"
 *   2) Extraction : appel LLM vision, loading
 *   3) Confirmation : preview des données extraites, champs éditables,
 *      bouton "Confirmer" qui applique le remplacement.
 *
 * Props :
 *   open               : boolean
 *   onClose            : () => void
 *   context            : { dayIndex, dayLocation, currentHotelName }
 *   onConfirm(hotel)   : async (hotel) => void   — applique le remplacement
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 Mo

export default function ImportHotelFromScreenshotModal({
  open,
  onClose,
  context,
  onConfirm,
}) {
  const [phase, setPhase] = useState('upload'); // 'upload' | 'extracting' | 'preview'
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPhase('upload');
      setDataUrl(null);
      setError(null);
      setExtracted(null);
      setBusy(false);
    }
  }, [open]);

  // Permet de coller directement une capture du presse-papiers (Ctrl+V /
  // Cmd+V). Capture la capture macOS (Cmd+Shift+5 → Ctrl, ou simplement
  // l'option "copier dans le presse-papiers") sans avoir à enregistrer
  // un fichier d'abord. Actif uniquement quand la modale est ouverte ET
  // qu'on est encore en phase upload (sinon on bloquerait des paste de
  // texte légitimes dans les champs d'édition de l'aperçu).
  useEffect(() => {
    if (!open || phase !== 'upload') return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, phase]);

  if (!open) return null;

  async function handleFile(file) {
    setError(null);
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setError('Le fichier doit être une image (PNG, JPG, WebP).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `L'image dépasse 8 Mo. Compressez-la ou prenez une capture plus petite.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;
      setDataUrl(url);
      setPhase('extracting');
      try {
        const hotel = await extractHotelFromImage(url, {
          day_location: context?.dayLocation,
          current_hotel_name: context?.currentHotelName,
        });
        if (!hotel?.name) {
          setError(
            hotel?.extraction_note ||
              "L'IA n'a pas pu lire les infos sur cette capture. Vérifiez qu'elle est nette et qu'elle montre bien la fiche hôtel."
          );
          setPhase('upload');
          return;
        }
        setExtracted({
          name: hotel.name || '',
          type: hotel.type || 'Hôtel',
          price_eur: Number(hotel.price_per_night_eur) || 0,
          currency_detected: hotel.currency_detected || 'EUR',
          rating: hotel.rating || null,
          rating_count: hotel.rating_count || null,
          services: Array.isArray(hotel.services) ? hotel.services : [],
          coordinates_hint: hotel.address_hint || '',
          booking_url: hotel.booking_url || null,
          extraction_note: hotel.extraction_note || '',
        });
        setPhase('preview');
      } catch (e) {
        console.error('[extract-hotel] failed', e);
        setError(e?.message || "Extraction échouée. Réessayez ou changez d'image.");
        setPhase('upload');
      }
    };
    reader.onerror = () => {
      setError('Impossible de lire ce fichier.');
    };
    reader.readAsDataURL(file);
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  async function applyAction(mode) {
    if (!extracted) return;
    setBusy(true);
    try {
      await onConfirm(extracted, mode);
      onClose();
    } catch (e) {
      setError(e?.message || "L'opération a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function updateField(field, value) {
    setExtracted((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-glow overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-indigo-600 font-bold">
              Remplacer l'hôtel par une capture
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">
              📸 Import depuis Booking
            </h2>
            {context?.currentHotelName && (
              <p className="text-xs text-slate-500 mt-1 truncate">
                Hôtel actuel : {context.currentHotelName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'upload' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 p-8 text-center cursor-pointer transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <div className="text-4xl mb-2">📸</div>
              <p className="text-sm font-medium text-slate-800">
                Glisse ta capture, ou colle-la avec{' '}
                <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  Ctrl
                </kbd>
                <span className="mx-0.5 text-slate-400">+</span>
                <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  V
                </kbd>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                ou clique pour choisir un fichier (PNG, JPG, WebP — max 8 Mo)
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          )}

          {phase === 'extracting' && (
            <div className="py-8 text-center">
              {dataUrl && (
                <img
                  src={dataUrl}
                  alt="Capture en cours d'analyse"
                  className="mx-auto max-h-48 rounded-lg shadow-sm mb-4 object-contain"
                />
              )}
              <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                Lecture de la capture par l'IA…
              </div>
              <p className="text-xs text-slate-400 mt-2">
                On extrait le nom, le prix par nuit, la note et les équipements.
              </p>
            </div>
          )}

          {phase === 'preview' && extracted && (
            <div className="space-y-3">
              {dataUrl && (
                <details className="rounded-lg border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-600 select-none">
                    📷 Voir la capture utilisée
                  </summary>
                  <div className="p-3 pt-0">
                    <img
                      src={dataUrl}
                      alt="Capture"
                      className="max-h-64 mx-auto rounded object-contain"
                    />
                  </div>
                </details>
              )}

              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                ✓ Infos extraites. Vérifie / corrige si besoin, puis confirme.
              </p>

              <Field label="Nom de l'hôtel">
                <input
                  type="text"
                  value={extracted.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  className="input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <input
                    type="text"
                    value={extracted.type}
                    onChange={(e) => updateField('type', e.target.value)}
                    className="input"
                    placeholder="Hôtel 4★"
                  />
                </Field>
                <Field label="Prix par nuit (€)">
                  <input
                    type="number"
                    min="0"
                    value={extracted.price_eur}
                    onChange={(e) =>
                      updateField('price_eur', Number(e.target.value) || 0)
                    }
                    className="input"
                  />
                </Field>
              </div>

              {extracted.currency_detected && extracted.currency_detected !== 'EUR' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠️ Prix affiché en {extracted.currency_detected} sur la capture
                  — converti grossièrement en EUR. Vérifie le taux du jour.
                </p>
              )}

              <Field label="Quartier / adresse (optionnel)">
                <input
                  type="text"
                  value={extracted.coordinates_hint}
                  onChange={(e) =>
                    updateField('coordinates_hint', e.target.value)
                  }
                  className="input"
                  placeholder="Centre-ville, près du métro…"
                />
              </Field>

              {(extracted.rating || extracted.rating_count) && (
                <p className="text-xs text-slate-600">
                  Note Booking détectée :{' '}
                  <strong>{extracted.rating}/10</strong>
                  {extracted.rating_count && ` (${extracted.rating_count} avis)`}
                </p>
              )}

              {extracted.services?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">
                    Services / équipements
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {extracted.services.map((s, i) => (
                      <span
                        key={i}
                        className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {extracted.extraction_note && (
                <p className="text-xs text-slate-500 italic">
                  💡 {extracted.extraction_note}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Annuler
          </button>
          {phase === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => applyAction('add_alternative')}
                disabled={busy || !extracted?.name}
                className="rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 px-4 py-2 text-sm font-semibold"
                title="Ajouter comme option supplémentaire sans changer l'hôtel principal"
              >
                ➕ Ajouter comme option
              </button>
              <button
                type="button"
                onClick={() => applyAction('replace')}
                disabled={busy || !extracted?.name}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
                title="Remplacer l'hôtel actuel (priorité 1, utilisé dans le budget)"
              >
                {busy ? 'Application…' : "✓ Mettre en priorité 1"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-slate-700 mb-1">{label}</div>
      {children}
    </label>
  );
}
