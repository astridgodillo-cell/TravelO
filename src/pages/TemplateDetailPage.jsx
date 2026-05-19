import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTemplateItinerary } from '../lib/supabase';
import ItineraryView from '../components/ItineraryView';

export default function TemplateDetailPage() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getTemplateItinerary(id).then(({ data, error }) => {
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
  if (error || !trip) {
    return (
      <div className="card text-center">
        <h1 className="text-xl font-semibold text-slate-900">
          Modèle introuvable
        </h1>
        <p className="mt-2 text-slate-500">
          Ce modèle n'existe pas ou n'est plus disponible.
        </p>
        <Link to="/modeles" className="btn-primary mt-4 inline-flex">
          Voir tous les modèles
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <strong>📘 Vous consultez un modèle d'itinéraire.</strong> Inspirez-vous
          de ce voyage pour créer le vôtre.
        </div>
        <Link to="/nouveau" className="btn-primary">
          Créer mon itinéraire
        </Link>
      </div>
      <ItineraryView itinerary={trip.itinerary} />
    </div>
  );
}
