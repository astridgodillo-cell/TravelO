import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPublicItinerary } from '../lib/supabase';
import ItineraryView from '../components/ItineraryView';

export default function PublicItineraryPage() {
  const { slug } = useParams();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getPublicItinerary(slug).then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else setTrip(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) return <p className="text-slate-500">Chargement…</p>;
  if (error || !trip) {
    return (
      <div className="card text-center">
        <h1 className="text-xl font-semibold text-slate-900">
          Itinéraire introuvable
        </h1>
        <p className="mt-2 text-slate-500">
          Ce lien ne correspond plus à aucun itinéraire public.
        </p>
        <Link to="/" className="btn-primary mt-4 inline-flex">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800 print:hidden">
        📣 Vous consultez un itinéraire <strong>partagé publiquement</strong>.{' '}
        <Link to="/nouveau" className="underline">
          Créez le vôtre
        </Link>
        .
      </div>
      <ItineraryView itinerary={trip.itinerary} />
    </div>
  );
}
