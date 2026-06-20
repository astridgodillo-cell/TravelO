import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getItinerary } from '../lib/supabase';
import Brochure from '../components/Brochure';

// Page d'affichage de la brochure imprimable d'un voyage.
// Route : /itineraire/:id/brochure
export default function BrochurePage() {
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

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-500">
        Préparation de la brochure…
      </div>
    );
  }

  if (error || !trip?.itinerary) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-600">Impossible de charger ce voyage.</p>
        <Link to="/mes-voyages" className="mt-3 inline-block text-brand-700 underline">
          ← Retour à mes voyages
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="no-print mx-auto mb-4 max-w-3xl">
        <Link to={`/itineraire/${id}`} className="text-sm text-brand-700 underline">
          ← Retour au voyage
        </Link>
      </div>
      <Brochure itinerary={trip.itinerary} />
    </div>
  );
}
