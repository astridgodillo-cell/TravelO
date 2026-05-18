import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getItinerary, updateItinerary } from '../lib/supabase';
import {
  regenerateDay,
  replanFromDay,
  regenerateActivity,
  removeActivity,
} from '../lib/ai';
import { fetchSpecialties } from '../lib/photos';
import ItineraryView from '../components/ItineraryView';
import SharePanel from '../components/SharePanel';

export default function ItineraryDetailPage() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
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

  async function handleRegenerateDay(dayIndex, instructions) {
    if (!trip) return;
    setRegenerating(true);
    setError(null);
    try {
      const updatedItinerary = await regenerateDay(
        trip.itinerary,
        dayIndex,
        instructions
      );
      const { data, error: dbError } = await updateItinerary(trip.id, {
        itinerary: updatedItinerary,
      });
      if (dbError) throw dbError;
      setTrip(data);
    } catch (err) {
      setError(err.message || 'Erreur lors de la régénération.');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRegenerateActivity(dayIndex, activityIndex, instructions) {
    if (!trip) return;
    setRegenerating(true);
    setError(null);
    try {
      const updatedItinerary = await regenerateActivity(
        trip.itinerary,
        dayIndex,
        activityIndex,
        instructions
      );
      const { data, error: dbError } = await updateItinerary(trip.id, {
        itinerary: updatedItinerary,
      });
      if (dbError) throw dbError;
      setTrip(data);
    } catch (err) {
      setError(err.message || 'Erreur lors du remplacement de l\'activité.');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRemoveActivity(dayIndex, activityIndex) {
    if (!trip) return;
    setError(null);
    const updatedItinerary = removeActivity(
      trip.itinerary,
      dayIndex,
      activityIndex
    );
    const { data, error: dbError } = await updateItinerary(trip.id, {
      itinerary: updatedItinerary,
    });
    if (dbError) setError(dbError.message);
    else setTrip(data);
  }

  async function handleFetchSpecialties(dayIndex) {
    if (!trip) return;
    const day = trip.itinerary?.days?.[dayIndex];
    if (!day?.location) return;
    setError(null);
    const specialties = await fetchSpecialties(day.location, 4);
    if (!specialties.length) {
      setError('Impossible de charger les spécialités pour ce lieu.');
      return;
    }
    const newDays = trip.itinerary.days.map((d, i) =>
      i === dayIndex ? { ...d, culinary_specialties: specialties } : d
    );
    const updatedItinerary = { ...trip.itinerary, days: newDays };
    const { data, error: dbError } = await updateItinerary(trip.id, {
      itinerary: updatedItinerary,
    });
    if (dbError) setError(dbError.message);
    else setTrip(data);
  }

  async function handleReplanFromDay(dayIndex, instructions) {
    if (!trip) return;
    setRegenerating(true);
    setError(null);
    try {
      const updatedItinerary = await replanFromDay(
        trip.itinerary,
        dayIndex,
        instructions
      );
      const { data, error: dbError } = await updateItinerary(trip.id, {
        itinerary: updatedItinerary,
      });
      if (dbError) throw dbError;
      setTrip(data);
    } catch (err) {
      setError(err.message || 'Erreur lors de la replanification.');
    } finally {
      setRegenerating(false);
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            to="/mes-voyages"
            className="text-sm text-brand-700 hover:underline"
          >
            ← Mes voyages
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">
            {trip.title}
          </h1>
        </div>
        <button onClick={() => window.print()} className="btn-secondary">
          Exporter en PDF
        </button>
      </div>

      <SharePanel itinerary={trip} onUpdate={(updated) => setTrip(updated)} />

      <ItineraryView
        itinerary={trip.itinerary}
        onRegenerateDay={handleRegenerateDay}
        onReplanFromDay={handleReplanFromDay}
        onRegenerateActivity={handleRegenerateActivity}
        onRemoveActivity={handleRemoveActivity}
        onFetchSpecialties={handleFetchSpecialties}
        regenerating={regenerating}
      />
    </div>
  );
}
