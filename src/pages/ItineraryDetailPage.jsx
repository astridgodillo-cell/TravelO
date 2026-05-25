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
import AdminTemplatePanel from '../components/AdminTemplatePanel';
import { useAuth } from '../context/AuthContext';

export default function ItineraryDetailPage() {
  const { isAdmin } = useAuth();
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

  /**
   * Handler générique pour les éditions manuelles inline (prix de vol corrigé
   * sur Google Flights, vrai prix d'hôtel sur Booking, etc.).
   * L'appelant fournit une fonction `updater(itinerary) -> nouvel itinerary`
   * (pure), on persiste et on rafraîchit le state.
   *
   * Pas de régénération IA ici : c'est une simple écriture en DB.
   */
  async function handleUpdateItinerary(updater) {
    if (!trip) throw new Error('Itinéraire non chargé');
    const next = updater(trip.itinerary);
    const { data, error: dbError } = await updateItinerary(trip.id, {
      itinerary: next,
    });
    if (dbError) {
      setError(dbError.message);
      throw dbError;
    }
    setTrip(data);
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
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link
            to="/mes-voyages"
            className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
          >
            ← Mes voyages
          </Link>
          <div className="mt-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-coral-600">
            Itinéraire
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 break-words">
            {trip.title}
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="btn-secondary w-full sm:w-auto shrink-0"
        >
          Exporter en PDF
        </button>
      </div>

      <SharePanel itinerary={trip} onUpdate={(updated) => setTrip(updated)} />

      {isAdmin && (
        <AdminTemplatePanel
          itinerary={trip}
          onUpdate={(updated) => setTrip(updated)}
        />
      )}

      <ItineraryView
        itinerary={trip.itinerary}
        onRegenerateDay={handleRegenerateDay}
        onReplanFromDay={handleReplanFromDay}
        onRegenerateActivity={handleRegenerateActivity}
        onRemoveActivity={handleRemoveActivity}
        onFetchSpecialties={handleFetchSpecialties}
        onUpdateItinerary={handleUpdateItinerary}
        regenerating={regenerating}
      />
    </div>
  );
}
