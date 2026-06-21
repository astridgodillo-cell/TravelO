import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAlbums, createAlbum, deleteAlbum } from '../lib/supabase';

export default function AlbumsListPage() {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listAlbums().then(({ data, error: e }) => {
      if (e) setError(e.message);
      else setAlbums(data || []);
    });
  }, []);

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

  async function handleDelete(id) {
    if (!window.confirm('Supprimer cet album ? Cette action est définitive.')) return;
    await deleteAlbum(id);
    setAlbums((prev) => prev.filter((a) => a.id !== id));
  }

  const photoCount = (a) =>
    (a.content?.days || []).reduce((n, d) => n + (d.photos?.length || 0), 0);
  const cover = (a) => a.content?.cover?.display || a.content?.cover?.full || null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">Albums</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Mes albums</h1>
          <p className="mt-1 text-sm text-slate-500">Crée un album photo de zéro, page après page.</p>
        </div>
        <button onClick={handleCreate} disabled={creating} className="btn-primary shrink-0 disabled:opacity-50">
          {creating ? 'Création…' : '➕ Nouvel album'}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {albums === null ? (
        <p className="mt-8 text-center text-slate-500">Chargement…</p>
      ) : albums.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-slate-600">Tu n'as pas encore d'album.</p>
          <button onClick={handleCreate} disabled={creating} className="btn-primary mt-4 disabled:opacity-50">
            ➕ Créer mon premier album
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button onClick={() => navigate(`/album/${a.id}`)} className="block w-full text-left">
                <div className="h-36 w-full bg-slate-100">
                  {cover(a) ? (
                    <img src={cover(a)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">📷</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate font-semibold text-slate-800">{a.title || 'Album'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{photoCount(a)} photo(s)</p>
                </div>
              </button>
              <div className="flex justify-end border-t border-slate-100 px-3 py-2">
                <button onClick={() => handleDelete(a.id)} className="text-xs font-medium text-slate-400 hover:text-red-600">
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
