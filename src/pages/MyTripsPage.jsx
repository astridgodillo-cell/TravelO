import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listItineraries, deleteItinerary } from '../lib/supabase';

export default function MyTripsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data, error } = await listItineraries();
    if (error) setError(error.message);
    else {
      setItems(data || []);
      setSelected(new Set()); // reset selection after refresh
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  async function handleDeleteOne(id, e) {
    e?.stopPropagation();
    if (!confirm('Supprimer cet itinéraire ? Cette action est définitive.'))
      return;
    setDeleting(true);
    const { error } = await deleteItinerary(id);
    if (error) setError(error.message);
    else await refresh();
    setDeleting(false);
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Supprimer définitivement ${selected.size} itinéraire${
          selected.size > 1 ? 's' : ''
        } ? Cette action est irréversible.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    let lastError = null;
    for (const id of selected) {
      const { error } = await deleteItinerary(id);
      if (error) lastError = error.message;
    }
    if (lastError) setError(lastError);
    await refresh();
    setDeleting(false);
  }

  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Mes voyages</h1>
        <Link to="/nouveau" className="btn-primary">
          + Nouvel itinéraire
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : items.length === 0 ? (
        <div className="card text-center text-slate-500">
          Vous n'avez pas encore d'itinéraire sauvegardé.
          <div className="mt-4">
            <Link to="/nouveau" className="btn-primary">
              Créer mon premier voyage
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Barre de sélection */}
          <div className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Tout sélectionner"
              />
              <span className="text-slate-700">
                {someSelected
                  ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}`
                  : 'Tout sélectionner'}
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {someSelected && (
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={deleting}
                  className="btn-secondary text-sm"
                >
                  Désélectionner
                </button>
              )}
              <button
                onClick={handleDeleteSelected}
                disabled={!someSelected || deleting}
                className="btn text-sm bg-red-600 text-white hover:bg-red-700"
              >
                {deleting
                  ? 'Suppression…'
                  : someSelected
                    ? `🗑️ Supprimer (${selected.size})`
                    : '🗑️ Supprimer'}
              </button>
            </div>
          </div>

          {/* Liste */}
          <ul className="grid md:grid-cols-2 gap-4">
            {items.map((it) => {
              const checked = selected.has(it.id);
              return (
                <li
                  key={it.id}
                  className={`card transition-colors ${
                    checked ? 'ring-2 ring-brand-500 bg-brand-50/40' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(it.id)}
                      className="mt-1.5"
                      aria-label="Sélectionner cet itinéraire"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold text-slate-900 truncate">
                          {it.title}
                        </h2>
                        {it.is_public && (
                          <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            Public
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        {it.itinerary?.summary?.start_date} →{' '}
                        {it.itinerary?.summary?.end_date} ·{' '}
                        {it.itinerary?.summary?.duration_days} jours
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Créé le {formatDate(it.created_at)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          to={`/itineraire/${it.id}`}
                          className="btn-secondary text-sm"
                        >
                          Voir le détail
                        </Link>
                        <button
                          onClick={(e) => handleDeleteOne(it.id, e)}
                          disabled={deleting}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function formatDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return s;
  }
}
