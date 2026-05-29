import { useState } from 'react';
import PreferencesForm from '../components/PreferencesForm';
import WizardPreferencesForm from '../components/WizardPreferencesForm';
import InspireMeFlow from '../components/InspireMeFlow';
import LocalActivitiesFlow from '../components/LocalActivitiesFlow';
import GeneratingLoader from '../components/GeneratingLoader';
import PrefillBanner from '../components/PrefillBanner';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import { generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const MODES = [
  {
    id: 'expert',
    label: 'J\'ai mon plan en tête',
    icon: 'map',
    description:
      'Formulaire détaillé : vous précisez tout (étapes, activités, hébergement, budget…).',
  },
  {
    id: 'inspire',
    label: 'Inspire-moi',
    icon: 'sparkles',
    description:
      'Vous tapez juste une destination. On vous propose des lieux à visiter, vous choisissez, on construit l\'itinéraire.',
  },
  {
    id: 'local',
    label: 'Activités autour de moi',
    icon: 'compass',
    description:
      'On vous propose 10 activités à proximité (filtres : rayon, types, temps de pluie…). À ajouter en wishlist ou pour bâtir une journée.',
  },
];

export default function NewItineraryPage() {
  const [mode, setMode] = useState('expert');
  // En mode "expert", l'utilisateur a deux sous-vues possibles :
  // - 'wizard' (par défaut) : navigation pas-à-pas guidée
  // - 'form' : formulaire complet d'un seul tenant (power users)
  const [expertView, setExpertView] = useState('wizard');
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

      // Mémorise les critères d'hébergement dans le résumé pour que la page
      // d'itinéraire pré-remplisse Booking (chambres, gamme, options) sur
      // TOUTES les nuits.
      itinerary.summary = itinerary.summary || {};
      itinerary.summary.accommodation_prefs = {
        rooms: Number(prefs.rooms) || 1,
        stars: prefs.hotelStars || '',
        reviewScore: prefs.hotelReviewScore || '',
        amenities: Array.isArray(prefs.hotelAmenities)
          ? prefs.hotelAmenities
          : [],
      };

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
        <PageHeader
          eyebrow="Nouveau voyage"
          eyebrowColor="coral"
          title="Composons votre prochain itinéraire"
          description="Choisissez votre méthode : un plan déjà en tête, une inspiration à creuser, ou une journée à improviser autour de vous."
        />
      )}

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
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span
                      className={`inline-grid place-items-center h-9 w-9 rounded-xl ${
                        active
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      <Icon name={m.icon} className="h-4 w-4" />
                    </span>
                    <span
                      className={`font-semibold ${
                        active ? 'text-brand-700' : 'text-slate-900'
                      }`}
                    >
                      {m.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {m.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && mode === 'expert' && (
        <>
          <PrefillBanner onPrefill={handlePrefill} />
          {expertView === 'wizard' ? (
            <WizardPreferencesForm
              onSubmit={handleGenerate}
              loading={loading}
              initialValues={prefillPrefs}
              onSwitchToFullForm={() => setExpertView('form')}
            />
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setExpertView('wizard')}
                  className="text-xs text-slate-500 hover:text-brand-700 hover:underline"
                >
                  ← Revenir au pas-à-pas guidé
                </button>
              </div>
              <PreferencesForm
                onSubmit={handleGenerate}
                loading={loading}
                initialValues={prefillPrefs}
              />
            </>
          )}
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
