import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listItineraries, deleteItinerary } from '../lib/supabase';

export default function MyTripsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function refresh() {
    setLoading(true);
    const { data, error } = await listItineraries();
    if (error) setError(error.message);
    else setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id) {
    if (!confirm('Supprimer cet itinéraire ?')) return;
    const { error } = await deleteItinerary(id);
    if (error) setError(error.message);
    else refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
        <ul className="grid md:grid-cols-2 gap-4">
          {items.map((it) => (
            <li key={it.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{it.title}</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {it.itinerary?.summary?.start_date} →{' '}
                    {it.itinerary?.summary?.end_date} ·{' '}
                    {it.itinerary?.summary?.days} jours
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(it.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Supprimer
                </button>
              </div>
              <div className="mt-4 flex gap-2">
                <Link to={`/itineraire/${it.id}`} className="btn-secondary">
                  Voir le détail
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
