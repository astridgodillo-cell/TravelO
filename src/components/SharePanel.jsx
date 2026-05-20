import { useState } from 'react';
import { setItineraryPublic } from '../lib/supabase';

export default function SharePanel({ itinerary, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const isPublic = !!itinerary.is_public;
  const publicUrl = itinerary.public_slug
    ? `${window.location.origin}/partage/${itinerary.public_slug}`
    : null;

  async function togglePublic() {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await setItineraryPublic(itinerary.id, !isPublic);
      if (error) throw error;
      onUpdate?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      // Older browsers
    }
  }

  return (
    <div className="card print:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Partage public
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            {isPublic
              ? 'Toute personne ayant le lien peut consulter cet itinéraire.'
              : 'Cet itinéraire est privé — visible uniquement de votre compte.'}
          </p>
        </div>
        <button
          onClick={togglePublic}
          disabled={busy}
          className={isPublic ? 'btn-secondary' : 'btn-primary'}
        >
          {busy
            ? '…'
            : isPublic
              ? 'Rendre privé'
              : 'Rendre public'}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600">{error}</div>
      )}

      {isPublic && publicUrl && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            readOnly
            className="input flex-1 text-sm font-mono min-w-0"
            value={publicUrl}
            onClick={(e) => e.target.select()}
          />
          <button
            onClick={copy}
            className="btn-secondary whitespace-nowrap w-full sm:w-auto shrink-0"
          >
            {copied ? '✓ Copié' : 'Copier'}
          </button>
        </div>
      )}
    </div>
  );
}
