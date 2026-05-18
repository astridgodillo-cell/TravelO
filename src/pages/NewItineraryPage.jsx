import { useState } from 'react';
import PreferencesForm from '../components/PreferencesForm';
import ItineraryView from '../components/ItineraryView';
import GeneratingLoader from '../components/GeneratingLoader';
import { generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function NewItineraryPage() {
  const [itinerary, setItinerary] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleGenerate(prefs) {
    setLoading(true);
    setError(null);
    setItinerary(null);
    try {
      const result = await generateItinerary(prefs);
      setPreferences(prefs);
      setItinerary(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || 'Erreur lors de la génération.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user) {
      navigate('/connexion');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const title =
        (preferences?.destinations || 'Voyage').slice(0, 80) +
        ` — ${itinerary?.summary?.duration_days || ''}j`;
      const { data, error: dbError } = await saveItinerary({
        title,
        preferences,
        itinerary,
      });
      if (dbError) throw dbError;
      if (data?.id) navigate(`/itineraire/${data.id}`);
    } catch (err) {
      setError(err.message || 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!itinerary && !loading && (
        <PreferencesForm onSubmit={handleGenerate} loading={loading} />
      )}

      {loading && <GeneratingLoader />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {itinerary && !loading && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <button
              onClick={() => setItinerary(null)}
              className="btn-secondary"
            >
              ← Modifier les préférences
            </button>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="btn-secondary">
                Exporter en PDF
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary"
              >
                {saving
                  ? 'Sauvegarde…'
                  : user
                    ? 'Sauvegarder dans mes voyages'
                    : 'Se connecter pour sauvegarder'}
              </button>
            </div>
          </div>
          <ItineraryView itinerary={itinerary} />
        </>
      )}
    </div>
  );
}
