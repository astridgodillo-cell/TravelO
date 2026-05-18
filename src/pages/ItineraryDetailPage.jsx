import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getItinerary } from '../lib/supabase';
import ItineraryView from '../components/ItineraryView';

export default function ItineraryDetailPage() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getItinerary(id).then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else setTrip(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <p className="text-slate-500">Chargement…</p>;
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  if (!trip) return <p>Itinéraire introuvable.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/mes-voyages" className="text-sm text-brand-700 hover:underline">
            ← Mes voyages
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">{trip.title}</h1>
        </div>
        <button onClick={() => window.print()} className="btn-secondary">
          Exporter / Imprimer
        </button>
      </div>
      <ItineraryView itinerary={trip.itinerary} />
    </div>
  );
}
