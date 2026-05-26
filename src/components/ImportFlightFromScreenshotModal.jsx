import { useEffect, useRef, useState } from 'react';
import { extractFlightFromImage } from '../lib/ai';

/**
 * Modale d'import d'un vol depuis une capture d'écran (Google Flights,
 * Skyscanner, Kayak, etc.). Pareil que ImportHotelFromScreenshotModal
 * mais pour les vols — preview avec aller + retour côte à côte.
 *
 *   onConfirm(extracted) → applique le patch à tous les Avion correspondants
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function compressImageDataUrl(dataUrl, { maxDim = 1400, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Impossible de charger cette image.'));
    img.src = dataUrl;
  });
}

export default function ImportFlightFromScreenshotModal({
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

  // Ctrl+V / Cmd+V pour coller une capture depuis le presse-papiers
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
      const rawUrl = reader.result;
      setPhase('extracting');
      try {
        const compressedUrl = await compressImageDataUrl(rawUrl);
        setDataUrl(compressedUrl);
        const flight = await extractFlightFromImage(compressedUrl, {
          adults: context?.adults,
          children: context?.children,
          origin_hint: context?.origin_hint,
          destination_hint: context?.destination_hint,
        });
        if (!flight?.outbound?.origin_iata) {
          setError(
            flight?.extraction_note ||
              "L'IA n'a pas pu lire les infos sur cette capture. Vérifiez qu'elle montre bien un vol (Google Flights, Skyscanner…)."
          );
          setPhase('upload');
          return;
        }
        setExtracted({
          is_round_trip: !!flight.is_round_trip,
          passengers_total: flight.passengers_total || 1,
          total_price_eur: Number(flight.total_price_eur) || 0,
          currency_detected: flight.currency_detected || 'EUR',
          outbound: { ...flight.outbound },
          return: flight.return ? { ...flight.return } : null,
          extraction_note: flight.extraction_note || '',
        });
        setPhase('preview');
      } catch (e) {
        console.error('[extract-flight] failed', e);
        setError(e?.message || "Extraction échouée. Réessayez ou changez d'image.");
        setPhase('upload');
      }
    };
    reader.onerror = () => setError('Impossible de lire ce fichier.');
    reader.readAsDataURL(file);
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  async function applyConfirm() {
    if (!extracted) return;
    setBusy(true);
    try {
      await onConfirm(extracted);
      onClose();
    } catch (e) {
      setError(e?.message || "L'application a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function updateLegField(legKey, field, value) {
    setExtracted((prev) => {
      if (!prev || !prev[legKey]) return prev;
      return { ...prev, [legKey]: { ...prev[legKey], [field]: value } };
    });
  }

  function updateRoot(field, value) {
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
        className="bg-white w-full max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-glow overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-sky-700 font-bold">
              Mettre à jour les vols via une capture
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">
              ✈️ Import depuis Google Flights
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              La capture sera lue par l'IA et appliquée à tous les vols
              correspondants dans l'itinéraire (aller + retour si A/R).
            </p>
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
              <div className="text-4xl mb-2">✈️</div>
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
                Capture de la fiche vol (Google Flights, Skyscanner, Kayak…) —
                PNG / JPG / WebP, max 8 Mo
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
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                Lecture de la capture par l'IA…
              </div>
              <p className="text-xs text-slate-400 mt-2">
                On extrait compagnie, horaires, aéroports IATA, prix et type de
                vol.
              </p>
            </div>
          )}

          {phase === 'preview' && extracted && (
            <div className="space-y-4">
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                ✓ Infos extraites. Vérifie / corrige si besoin, puis applique.
              </p>

              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={extracted.is_round_trip}
                    onChange={(e) =>
                      updateRoot('is_round_trip', e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="font-medium">Aller-retour</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Voyageurs :</span>
                  <input
                    type="number"
                    min="1"
                    value={extracted.passengers_total}
                    onChange={(e) =>
                      updateRoot('passengers_total', Number(e.target.value) || 1)
                    }
                    className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Prix total famille :</span>
                  <input
                    type="number"
                    min="0"
                    value={extracted.total_price_eur}
                    onChange={(e) =>
                      updateRoot('total_price_eur', Number(e.target.value) || 0)
                    }
                    className="w-24 rounded border border-slate-300 px-1.5 py-0.5"
                  />
                  <span className="text-slate-500">€</span>
                </div>
              </div>

              {extracted.currency_detected &&
                extracted.currency_detected !== 'EUR' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    ⚠️ Prix affiché en {extracted.currency_detected} converti
                    grossièrement. Vérifie le taux du jour si gros écart.
                  </p>
                )}

              <LegBlock
                title="✈️ Vol aller"
                leg={extracted.outbound}
                onUpdate={(f, v) => updateLegField('outbound', f, v)}
              />

              {extracted.is_round_trip && extracted.return && (
                <LegBlock
                  title="🔄 Vol retour"
                  leg={extracted.return}
                  onUpdate={(f, v) => updateLegField('return', f, v)}
                />
              )}

              {extracted.extraction_note && (
                <p className="text-xs text-slate-500 italic">
                  💡 {extracted.extraction_note}
                </p>
              )}

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
            <button
              type="button"
              onClick={applyConfirm}
              disabled={busy || !extracted?.outbound?.origin_iata}
              className="rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
            >
              {busy
                ? 'Application…'
                : '✓ Appliquer à tous les vols correspondants'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function LegBlock({ title, leg, onUpdate }) {
  if (!leg) return null;
  // Helpers pour split YYYY-MM-DDTHH:MM:SS en date + heure éditables
  function getDate(iso) {
    return iso && iso.length >= 10 ? iso.substring(0, 10) : '';
  }
  function getTime(iso) {
    return iso && iso.length >= 16 ? iso.substring(11, 16) : '';
  }
  function combine(date, time) {
    if (!date) return null;
    return `${date}T${time || '00:00'}:00`;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm space-y-2">
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Compagnie (code IATA)">
          <input
            type="text"
            value={leg.airline_code || ''}
            placeholder="AF"
            onChange={(e) => onUpdate('airline_code', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Numéro de vol">
          <input
            type="text"
            value={leg.flight_number || ''}
            placeholder="871"
            onChange={(e) => onUpdate('flight_number', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Aéroport départ (IATA)">
          <input
            type="text"
            value={leg.origin_iata || ''}
            placeholder="MRS"
            onChange={(e) => onUpdate('origin_iata', e.target.value.toUpperCase())}
            className="input uppercase"
          />
        </Field>
        <Field label="Aéroport arrivée (IATA)">
          <input
            type="text"
            value={leg.destination_iata || ''}
            placeholder="YUL"
            onChange={(e) =>
              onUpdate('destination_iata', e.target.value.toUpperCase())
            }
            className="input uppercase"
          />
        </Field>
        <Field label="Date départ">
          <input
            type="date"
            value={getDate(leg.departure_at)}
            onChange={(e) =>
              onUpdate('departure_at', combine(e.target.value, getTime(leg.departure_at)))
            }
            className="input"
          />
        </Field>
        <Field label="Heure départ (locale)">
          <input
            type="time"
            value={getTime(leg.departure_at)}
            onChange={(e) =>
              onUpdate('departure_at', combine(getDate(leg.departure_at), e.target.value))
            }
            className="input"
          />
        </Field>
        <Field label="Date arrivée">
          <input
            type="date"
            value={getDate(leg.arrival_at)}
            onChange={(e) =>
              onUpdate('arrival_at', combine(e.target.value, getTime(leg.arrival_at)))
            }
            className="input"
          />
        </Field>
        <Field label="Heure arrivée (locale)">
          <input
            type="time"
            value={getTime(leg.arrival_at)}
            onChange={(e) =>
              onUpdate('arrival_at', combine(getDate(leg.arrival_at), e.target.value))
            }
            className="input"
          />
        </Field>
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
