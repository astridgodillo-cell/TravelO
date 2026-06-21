import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  listAlbums,
  createAlbum,
  deleteAlbum,
  listItineraries,
  shareAlbumByEmail,
  listSharesForAlbum,
  deleteAlbumShare,
  shareItineraryByEmail,
  listSharesForItinerary,
  deleteItineraryShare,
} from '../lib/supabase';

const albumPhotoCount = (content) =>
  Object.values(content?.days || {}).reduce((n, d) => n + (d?.photos?.length || 0), 0);
const albumCover = (content) => content?.cover?.display || content?.cover?.full || null;

export default function AlbumsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(null);

  const refresh = useCallback(async () => {
    const [albumsRes, itinsRes] = await Promise.all([listAlbums(), listItineraries()]);
    if (albumsRes.error) {
      setError(albumsRes.error.message);
      setItems([]);
      return;
    }
    // Albums autonomes
    const standalone = (albumsRes.data || []).map((a) => ({
      key: `album-${a.id}`,
      kind: 'album',
      id: a.id,
      title: a.title || 'Album',
      content: a.content,
      shared: !!a._shared,
      to: `/album/${a.id}`,
    }));
    // Albums créés dans un voyage
    const trips = (itinsRes.data || [])
      .map((it) => ({ it, alb: it.itinerary?.travel_album }))
      .filter(({ alb }) => alb && (albumCover(alb) || albumPhotoCount(alb) > 0))
      .map(({ it, alb }) => ({
        key: `trip-${it.id}`,
        kind: 'trip',
        id: it.id,
        title: alb.title || it.title || 'Album du voyage',
        content: alb,
        shared: !!it._shared,
        to: `/itineraire/${it.id}/album`,
      }));
    setItems([...standalone, ...trips]);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => { if (active) await refresh(); })();
    return () => { active = false; };
  }, [refresh]);

  // Rechargement quand une invitation d'album/voyage est acceptée ailleurs.
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener('travelo:albums-refresh', onRefresh);
    window.addEventListener('travelo:itineraries-refresh', onRefresh);
    return () => {
      window.removeEventListener('travelo:albums-refresh', onRefresh);
      window.removeEventListener('travelo:itineraries-refresh', onRefresh);
    };
  }, [refresh]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { data, error: e } = await createAlbum('Mon album', { days: [] });
      if (e) throw e;
      navigate(`/album/${data.id}`);
    } catch (e) {
      setError(
        (e.message || 'Création impossible.') +
          " — Si l'erreur mentionne « albums », la table n'a pas encore été créée dans la base."
      );
      setCreating(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm('Supprimer cet album ? Cette action est définitive.')) return;
    await deleteAlbum(item.id);
    setItems((prev) => prev.filter((x) => x.key !== item.key));
  }

  async function handleLeave(item) {
    if (!window.confirm('Quitter cet album partagé ?')) return;
    if (item.kind === 'trip') {
      const { data } = await listSharesForItinerary(item.id);
      const mine = (data || []).find((s) => s.recipient_id === user?.id);
      if (mine) await deleteItineraryShare(mine.id);
    } else {
      const { data } = await listSharesForAlbum(item.id);
      const mine = (data || []).find((s) => s.recipient_id === user?.id);
      if (mine) await deleteAlbumShare(mine.id);
    }
    setItems((prev) => prev.filter((x) => x.key !== item.key));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">Albums</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Mes albums</h1>
          <p className="mt-1 text-sm text-slate-500">Tous tes albums photo, y compris ceux créés dans tes voyages.</p>
        </div>
        <button onClick={handleCreate} disabled={creating} className="btn-primary shrink-0 disabled:opacity-50">
          {creating ? 'Création…' : '➕ Nouvel album'}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <p className="mt-8 text-center text-slate-500">Chargement…</p>
      ) : items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-slate-600">Tu n'as pas encore d'album.</p>
          <button onClick={handleCreate} disabled={creating} className="btn-primary mt-4 disabled:opacity-50">
            ➕ Créer mon premier album
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const cover = albumCover(a.content);
            return (
              <div key={a.key} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button onClick={() => navigate(a.to)} className="block w-full flex-1 text-left">
                  <div className="relative h-36 w-full bg-slate-100">
                    {cover ? (
                      <img src={cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-3xl">📷</div>
                    )}
                    <div className="absolute left-2 top-2 flex gap-1">
                      {a.kind === 'trip' && (
                        <span className="rounded-full bg-brand-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">🧳 Voyage</span>
                      )}
                      {a.shared && (
                        <span className="rounded-full bg-coral-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">partagé</span>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="truncate font-semibold text-slate-800">{a.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{albumPhotoCount(a.content)} photo(s)</p>
                  </div>
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                  {!a.shared ? (
                    <button onClick={() => setSharing(a)} className="text-xs font-semibold text-coral-600 hover:text-coral-700">
                      🔗 Partager
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Partagé avec toi</span>
                  )}
                  {a.shared ? (
                    <button onClick={() => handleLeave(a)} className="text-xs font-medium text-slate-400 hover:text-red-600">Quitter</button>
                  ) : a.kind === 'album' ? (
                    <button onClick={() => handleDelete(a)} className="text-xs font-medium text-slate-400 hover:text-red-600">Supprimer</button>
                  ) : (
                    <span />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sharing && <ShareAlbumDialog item={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

// Fenêtre de partage d'un album : invite par email, montre qui a accès.
// Un album de voyage est partagé via le partage du voyage (l'invité y accède
// aussi dans « Mes voyages »).
function ShareAlbumDialog({ item, onClose }) {
  const [email, setEmail] = useState('');
  const [shares, setShares] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isTrip = item.kind === 'trip';

  const loadShares = async () => {
    const { data } = isTrip ? await listSharesForItinerary(item.id) : await listSharesForAlbum(item.id);
    setShares(data || []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = isTrip ? await listSharesForItinerary(item.id) : await listSharesForAlbum(item.id);
      if (active) setShares(data || []);
    })();
    return () => { active = false; };
  }, [isTrip, item.id]);

  async function handleInvite(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const target = email.trim();
    if (!target) return;
    setBusy(true);
    const { error } = isTrip
      ? await shareItineraryByEmail(item.id, target)
      : await shareAlbumByEmail(item.id, target);
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
    const { error } = isTrip ? await deleteItineraryShare(shareId) : await deleteAlbumShare(shareId);
    if (error) setErr(error.message);
    else loadShares();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Partager «&nbsp;{item.title}&nbsp;»</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-sm text-slate-600">
            Invite quelqu'un par son email. Une fois qu'il accepte, l'album apparaît dans ses « Mes albums ».
            {isTrip && ' Comme cet album fait partie d’un voyage, le voyage sera lui aussi partagé.'}
          </p>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemple.com"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? 'Envoi…' : 'Inviter'}
            </button>
          </form>
          {msg && <p className="mt-2 text-xs text-emerald-600">{msg}</p>}
          {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

          {shares.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Partagé avec</p>
              <ul className="space-y-1">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-slate-700">
                      {s.recipient_email}
                      <span className={`ml-2 text-xs ${s.status === 'accepted' ? 'text-emerald-600' : s.status === 'refused' ? 'text-red-500' : 'text-amber-600'}`}>
                        {s.status === 'accepted' ? 'a accepté' : s.status === 'refused' ? 'a refusé' : 'en attente'}
                      </span>
                    </span>
                    <button onClick={() => handleRemove(s.id)} className="ml-2 shrink-0 text-xs font-medium text-slate-400 hover:text-red-600">Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-100 px-4 py-3">
          <button onClick={onClose} className="btn-primary">Terminé</button>
        </div>
      </div>
    </div>
  );
}
