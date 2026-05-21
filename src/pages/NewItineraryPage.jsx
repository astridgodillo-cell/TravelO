import { useState } from 'react';
import PreferencesForm from '../components/PreferencesForm';
import InspireMeFlow from '../components/InspireMeFlow';
import LocalActivitiesFlow from '../components/LocalActivitiesFlow';
import GeneratingLoader from '../components/GeneratingLoader';
import PrefillBanner from '../components/PrefillBanner';
import { generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const MODES = [
  {
    id: 'expert',
    label: 'J\'ai mon plan en tête',
    emoji: '🗺️',
    description:
      'Formulaire détaillé : vous précisez tout (étapes, activités, hébergement, budget…).',
  },
  {
    id: 'inspire',
    label: 'Inspire-moi',
    emoji: '✨',
    description:
      'Vous tapez juste une destination. On vous propose des lieux à visiter, vous choisissez, on construit l\'itinéraire.',
  },
  {
    id: 'local',
    label: 'Activités autour de moi',
    emoji: '🧭',
    description:
      'On vous propose 10 activités à proximité (filtres : rayon, types, temps de pluie…). À ajouter en wishlist ou pour bâtir une journée.',
  },
];

export default function NewItineraryPage() {
  const [mode, setMode] = useState('expert');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  // Données venant du profil pour préremplissage. Stocké séparément pour
  // pouvoir aussi enrichir le payload envoyé au LLM (voyageurs, lieux…).
  const [prefillPrefs, setPrefillPrefs] = useState(null);
  const [profileExtras, setProfileExtras] = useState(null);
  const { user, isApproved } = useAuth();
  const navigate = useNavigate();

  function handlePrefill({ preferences, travelers, personalInfo, visitedPlaces, wishlistPlaces }) {
    setPrefillPrefs(preferences);
    setProfileExtras({ travelers, personalInfo, visitedPlaces, wishlistPlaces });
  }

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
      // Enrichit le payload avec les données profil pour que l'Edge Function
      // puisse les injecter dans le prompt LLM. Le formulaire ne les expose
      // pas (UX), mais on les transmet en sous-marin pour adapter l'itinéraire.
      const enrichedPrefs = profileExtras
        ? {
            ...prefs,
            _profileExtras: {
              travelers: profileExtras.travelers || [],
              personalInfo: profileExtras.personalInfo || {},
              visitedPlaces: profileExtras.visitedPlaces || [],
              wishlistPlaces: profileExtras.wishlistPlaces || [],
            },
          }
        : prefs;
      const itinerary = await generateItinerary(enrichedPrefs, (p) => setProgress(p));

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
        <div className="card">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500 shadow-glow'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{m.emoji}</span>
                    <span
                      className={`font-semibold ${
                        active ? 'text-brand-700' : 'text-slate-900'
                      }`}
                    >
                      {m.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{m.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && mode === 'expert' && (
        <>
          <PrefillBanner onPrefill={handlePrefill} />
          <PreferencesForm
            onSubmit={handleGenerate}
            loading={loading}
            initialValues={prefillPrefs}
          />
        </>
      )}

      {!loading && mode === 'inspire' && (
        <InspireMeFlow onSubmit={handleGenerate} loading={loading} />
      )}

      {!loading && mode === 'local' && <LocalActivitiesFlow />}

      {loading && <GeneratingLoader progress={progress} />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
