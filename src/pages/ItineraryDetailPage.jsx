import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getItinerary, updateItinerary } from '../lib/supabase';
import {
  regenerateDay,
  replanFromDay,
  regenerateActivity,
  removeActivity,
  suggestMomentAlternatives,
} from '../lib/ai';
import {
  replaceMoment,
  replaceAccommodation,
  addAccommodationAlternative,
  applyExtractedFlightsToItinerary,
  flightAffectedDayIndices,
} from '../lib/itineraryEdits';
import { fetchSpecialties } from '../lib/photos';
import ItineraryView from '../components/ItineraryView';
import MomentAlternativesModal from '../components/MomentAlternativesModal';
import ImportHotelFromScreenshotModal from '../components/ImportHotelFromScreenshotModal';
import ImportFlightFromScreenshotModal from '../components/ImportFlightFromScreenshotModal';
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
  // État de la modale "Proposer d'autres options" sur un moment
  const [momentSuggestState, setMomentSuggestState] = useState(null);
  // { open: bool, context: {dayIndex, momentKey, label, m, dayLocation},
  //   alternatives: array | null, loading: bool }
  // État de la modale "Importer un hôtel depuis une capture d'écran"
  const [importHotelState, setImportHotelState] = useState(null);
  // { open: bool, dayIndex, dayLocation, currentHotelName }
  // État de la modale "Importer un vol depuis une capture d'écran"
  const [importFlightState, setImportFlightState] = useState(null);
  // { open: bool, dayIndex, tripIndex, trip }

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

  /**
   * Demande à l'IA des alternatives pour un moment de la journée. Ouvre la
   * modale en mode "loading" puis injecte les alternatives quand elles arrivent.
   */
  async function handleSuggestMomentAlternatives(
    dayIndex,
    momentKey,
    label,
    m,
    dayLocation
  ) {
    if (!trip) return;
    setMomentSuggestState({
      open: true,
      context: { dayIndex, momentKey, label, m, dayLocation },
      alternatives: null,
      loading: true,
    });
    try {
      const alternatives = await suggestMomentAlternatives(
        trip.itinerary,
        dayIndex,
        momentKey
      );
      setMomentSuggestState((s) =>
        s ? { ...s, alternatives, loading: false } : s
      );
    } catch (err) {
      console.error('[suggest-moment-alternatives] failed', err);
      setMomentSuggestState((s) =>
        s ? { ...s, alternatives: [], loading: false } : s
      );
      setError(
        err.message || 'Impossible de générer des alternatives pour ce moment.'
      );
    }
  }

  async function handlePickMomentAlternative(alt) {
    if (!trip || !momentSuggestState?.context) return;
    const { dayIndex, momentKey } = momentSuggestState.context;
    await handleUpdateItinerary((it) =>
      replaceMoment(it, dayIndex, momentKey, alt)
    );
  }

  /**
   * Ouvre la modale "Remplacer cet hôtel par une capture d'écran Booking".
   * Le composant gère lui-même l'upload + l'extraction LLM + la preview.
   */
  function handleImportHotelFromImage(dayIndex, currentHotelName, dayLocation) {
    setImportHotelState({
      open: true,
      dayIndex,
      currentHotelName,
      dayLocation,
    });
  }

  async function handleApplyImportedHotel(hotel, mode = 'replace') {
    if (!trip || !importHotelState) return;
    const { dayIndex } = importHotelState;
    // On ne stocke pas "nights" dans l'hébergement (info de réservation, pas de
    // la nuit elle-même).
    const { nights: rawNights, ...hotelData } = hotel || {};
    if (mode === 'add_alternative') {
      await handleUpdateItinerary((it) =>
        addAccommodationAlternative(it, dayIndex, hotelData)
      );
    } else {
      // Réservation multi-nuits : on applique le même hôtel aux N nuits
      // consécutives à partir de ce jour (jours suivants inclus).
      const nights = Math.max(1, Math.round(Number(rawNights) || 1));
      await handleUpdateItinerary((it) => {
        let next = it;
        for (let k = 0; k < nights; k++) {
          next = replaceAccommodation(next, dayIndex + k, hotelData);
        }
        return next;
      });
    }
  }

  /**
   * Ouvre la modale "Mettre à jour les vols via une capture Google Flights".
   * Le bouton est dispo sur tout trip de mode Avion ; l'extraction sera ensuite
   * appliquée à TOUS les vols correspondants de l'itinéraire (matching IATA).
   */
  function handleImportFlightFromImage(dayIndex, tripIndex, tripData) {
    setImportFlightState({
      open: true,
      dayIndex,
      tripIndex,
      trip: tripData,
    });
  }

  /**
   * Applique un vol (capture ou saisie manuelle), PUIS recalcule
   * automatiquement le(s) jour(s) qui contiennent ce vol pour adapter le
   * programme aux vraies heures (arrivée allégée, départ calé sur la marge…).
   */
  async function handleApplyImportedFlight(extractedFlight) {
    if (!trip) return;
    setRegenerating(true);
    setError(null);
    try {
      const affected = flightAffectedDayIndices(trip.itinerary, extractedFlight);
      let working = applyExtractedFlightsToItinerary(
        trip.itinerary,
        extractedFlight
      );
      // Recalcule chaque jour touché en tenant compte des nouvelles heures.
      for (const di of affected) {
        working = await regenerateDay(
          working,
          di,
          "Les horaires de vol de cette journée viennent d'être mis à jour avec les vrais vols réservés. Adapte le programme à ces heures (arrivée / départ) en gardant les marges habituelles (transfert, installation, check-in/check-out). Conserve le vol tel quel."
        );
      }
      const { data, error: dbError } = await updateItinerary(trip.id, {
        itinerary: working,
      });
      if (dbError) throw dbError;
      setTrip(data);
    } catch (err) {
      setError(err.message || 'Erreur lors de la mise à jour du vol.');
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

      {regenerating && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800 flex items-center gap-2 print:hidden">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
          Mise à jour en cours — adaptation des journées en fonction des vols…
        </div>
      )}

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
        onSuggestMomentAlternatives={handleSuggestMomentAlternatives}
        onImportHotelFromImage={handleImportHotelFromImage}
        onImportFlightFromImage={handleImportFlightFromImage}
        regenerating={regenerating}
      />

      <MomentAlternativesModal
        open={!!momentSuggestState?.open}
        onClose={() => setMomentSuggestState(null)}
        context={momentSuggestState?.context}
        alternatives={momentSuggestState?.alternatives}
        loading={momentSuggestState?.loading}
        onPick={handlePickMomentAlternative}
      />

      <ImportHotelFromScreenshotModal
        open={!!importHotelState?.open}
        onClose={() => setImportHotelState(null)}
        context={importHotelState}
        onConfirm={handleApplyImportedHotel}
      />

      <ImportFlightFromScreenshotModal
        open={!!importFlightState?.open}
        onClose={() => setImportFlightState(null)}
        context={{
          adults: trip?.itinerary?.summary?.travellers?.adults || 2,
          children:
            trip?.itinerary?.summary?.travellers?.children_ages?.length || 0,
          origin_hint: importFlightState?.trip?.from,
          destination_hint: importFlightState?.trip?.to,
        }}
        onConfirm={handleApplyImportedFlight}
      />
    </div>
  );
}
