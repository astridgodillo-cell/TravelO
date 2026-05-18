import { useState } from 'react';
import PreferencesForm from '../components/PreferencesForm';
import GeneratingLoader from '../components/GeneratingLoader';
import { generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function NewItineraryPage() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const { user, isApproved } = useAuth();
  const navigate = useNavigate();

  async function handleGenerate(prefs) {
    if (!user) {
      navigate('/connexion');
      return;
    }
    if (!isApproved) {
      navigate('/compte-en-attente');
      return;
    }

    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const itinerary = await generateItinerary(prefs, (p) => setProgress(p));

      // Auto-save : tous les itinéraires générés sont automatiquement
      // sauvegardés dans "Mes voyages". L'utilisateur peut ensuite les
      // modifier ou les supprimer.
      const title =
        (prefs?.destinations || 'Voyage').slice(0, 80) +
        ` — ${itinerary?.summary?.duration_days || ''}j`;

      const { data, error: dbError } = await saveItinerary({
        title,
        preferences: prefs,
        itinerary,
      });

      if (dbError) {
        throw new Error(
          `Itinéraire généré mais sauvegarde échouée : ${dbError.message}`
        );
      }

      if (data?.id) {
        navigate(`/itineraire/${data.id}`);
      } else {
        navigate('/mes-voyages');
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de la génération.');
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      {!loading && (
        <PreferencesForm onSubmit={handleGenerate} loading={loading} />
      )}

      {loading && <GeneratingLoader progress={progress} />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
