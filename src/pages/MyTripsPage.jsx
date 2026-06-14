import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  supabase,
  listItineraries,
  deleteItinerary,
  shareItineraryByEmail,
  listSharesForItinerary,
  deleteItineraryShare,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

export default function MyTripsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(null); // itinéraire en cours de partage

  async function refresh() {
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

  // Rafraîchit quand une invitation est acceptée ailleurs dans l'appli.
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener('travelo:itineraries-refresh', onRefresh);
    return () =>
      window.removeEventListener('travelo:itineraries-refresh', onRefresh);
  }, []);

  // Temps réel : recharge dès qu'un itinéraire (à moi ou partagé) change.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`itineraries-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itineraries' },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itinerary_shares',
          filter: `owner_id=eq.${user.id}`,
        },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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

  async function handleDeleteOne(it, e) {
    e?.stopPropagation();
    if (it._shared) {
      // Itinéraire partagé avec moi : je quitte le partage (sans le supprimer).
      if (!confirm('Quitter ce voyage partagé ?')) return;
      setDeleting(true);
      const { data: shares } = await listSharesForItinerary(it.id);
      const mine = (shares || []).find((s) => s.recipient_id === user?.id);
      const { error } = mine
        ? await deleteItineraryShare(mine.id)
        : { error: null };
      if (error) setError(error.message);
      else await refresh();
      setDeleting(false);
      return;
    }
    if (!confirm('Supprimer cet itinéraire ? Cette action est définitive.'))
      return;
    setDeleting(true);
    const { error } = await deleteItinerary(it.id);
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
      <PageHeader
        eyebrow="Mes voyages"
        eyebrowColor="brand"
        title="Vos itinéraires"
        description="Retrouvez, modifiez, partagez ou supprimez les voyages que vous avez générés."
        banner="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2000&q=80"
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link to="/creer-ia" className="btn-primary inline-flex items-center justify-center gap-1.5">
              ✨ Créer avec l'IA
            </Link>
            <Link to="/nouveau" className="btn-secondary inline-flex items-center justify-center gap-1.5">
              <Icon name="plus" className="h-4 w-4" />
              Formulaire
            </Link>
            <Link to="/importer" className="btn-secondary inline-flex items-center justify-center gap-1.5">
              📥 Importer
            </Link>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {sharing && (
        <ShareItineraryDialog
          itinerary={sharing}
          currentUserId={user?.id}
          onClose={() => setSharing(null)}
        />
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
                className="btn text-sm bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1.5"
              >
                <Icon name="trash" className="h-4 w-4" />
                {deleting
                  ? 'Suppression…'
                  : someSelected
                    ? `Supprimer (${selected.size})`
                    : 'Supprimer'}
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
                        <span className="flex shrink-0 gap-1">
                          {it._shared && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                              Partagé
                            </span>
                          )}
                          {it.is_public && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              Public
                            </span>
                          )}
                        </span>
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
                        {!it._shared && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSharing(it);
                            }}
                            className="btn-secondary text-sm"
                          >
                            Partager
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDeleteOne(it, e)}
                          disabled={deleting}
                          className="text-sm text-red-600 hover:underline"
                        >
                          {it._shared ? 'Quitter' : 'Supprimer'}
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

// Fenêtre de partage d'un itinéraire : on invite par email, on voit qui a accès.
function ShareItineraryDialog({ itinerary, currentUserId, onClose }) {
  const [email, setEmail] = useState('');
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function loadShares() {
    const { data } = await listSharesForItinerary(itinerary.id);
    setShares(data || []);
  }
  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itinerary.id]);

  async function handleInvite(e) {
    e.preventDefault();
    const target = email.trim();
    if (!target) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    const { error } = await shareItineraryByEmail(itinerary.id, target);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg(`Invitation envoyée à ${target}. En attente de sa réponse.`);
    setEmail('');
    loadShares();
  }

  async function handleRemove(shareId) {
    setBusy(true);
    const { error } = await deleteItineraryShare(shareId);
    setBusy(false);
    if (error) setErr(error.message);
    else loadShares();
  }

  const statusLabel = {
    pending: 'En attente',
    accepted: 'A accepté',
    refused: 'A refusé',
  };
  const statusColor = {
    pending: 'text-amber-600',
    accepted: 'text-emerald-600',
    refused: 'text-red-600',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 animate-fade-up my-8 mb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Partager « {itinerary.title} »
            </h2>
            <p className="text-sm text-slate-500">
              Invite quelqu'un par son email. Une fois qu'il accepte, vous
              modifiez le voyage à deux, en direct.
            </p>
          </div>
          <button onClick={onClose} className="btn-secondary text-sm">
            Fermer
          </button>
        </div>

        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Email de la personne</label>
            <input
              type="email"
              className="input"
              placeholder="ex : ami@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Envoi…' : 'Envoyer l’invitation'}
          </button>
        </form>

        {msg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {msg}
          </div>
        )}
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Personnes concernées
          </h3>
          {shares.length === 0 ? (
            <p className="text-sm text-slate-500">
              Ce voyage n'est partagé avec personne pour l'instant.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="text-slate-700">{s.recipient_email}</span>
                  <span className="flex items-center gap-3">
                    <span className={`font-medium ${statusColor[s.status]}`}>
                      {statusLabel[s.status] || s.status}
                    </span>
                    <button
                      onClick={() => handleRemove(s.id)}
                      disabled={busy}
                      className="text-slate-400 hover:text-red-600"
                      aria-label="Retirer"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
