import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTemplates, listTravelers, getMyProfile } from '../lib/supabase';

// Propose à l'utilisateur de préremplir le formulaire depuis son profil.
// - Si plusieurs personas existent : dropdown pour choisir.
// - Si un seul existe (ou seulement le défaut) : un seul bouton "Oui".
// - Si aucun : on cache la bannière.
//
// onPrefill reçoit un objet `{ preferences, travelers, personalInfo }` où
//   preferences   = champs du persona (tripType, interests, vehicle…)
//   travelers     = tableau des voyageurs sélectionnés
//   personalInfo  = régime/langues/mobilité du user
export default function PrefillBanner({ onPrefill, onDismiss }) {
  const [loading, setLoading] = useState(true);
  const [personas, setPersonas] = useState([]);
  const [travelers, setTravelers] = useState([]);
  const [profile, setProfile] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedTravelers, setSelectedTravelers] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    Promise.all([listTemplates(), listTravelers(), getMyProfile()]).then(
      ([tplRes, travRes, profRes]) => {
        const tpls = tplRes.data || [];
        const trvs = travRes.data || [];
        setPersonas(tpls);
        setTravelers(trvs);
        setProfile(profRes.data || null);
        const def = tpls.find((t) => t.is_default);
        if (def) setSelectedId(def.id);
        else if (tpls.length) setSelectedId(tpls[0].id);
        // Pré-sélectionne tous les voyageurs par défaut
        setSelectedTravelers(trvs.map((t) => t.id));
        setLoading(false);
      }
    );
  }, []);

  if (loading || dismissed) return null;
  // Rien à proposer si pas de persona ni de voyageurs ni d'infos perso
  const hasPersonalInfo =
    profile?.personal_info &&
    Object.values(profile.personal_info).some(
      (v) => (Array.isArray(v) ? v.length : !!v)
    );
  if (personas.length === 0 && travelers.length === 0 && !hasPersonalInfo) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex items-center justify-between gap-3">
        <span>
          💡 Astuce : configure ton{' '}
          <Link to="/profil" className="text-brand-700 hover:underline font-medium">
            profil
          </Link>{' '}
          pour préremplir automatiquement ce formulaire à l'avenir.
        </span>
        <button
          type="button"
          className="text-slate-400 hover:text-slate-600 text-xs"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
    );
  }

  function applyPrefill() {
    const persona = personas.find((p) => p.id === selectedId);
    const selectedTravelersData = travelers.filter((t) =>
      selectedTravelers.includes(t.id)
    );
    onPrefill({
      preferences: persona?.preferences || {},
      travelers: selectedTravelersData,
      personalInfo: profile?.personal_info || {},
      visitedPlaces: profile?.visited_places || [],
      wishlistPlaces: profile?.wishlist_places || [],
    });
    setDismissed(true);
  }

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-brand-900">
            ✨ Préremplir depuis ton profil ?
          </h3>
          <p className="text-sm text-brand-800 mt-0.5">
            On peut récupérer tes préférences enregistrées, tes voyageurs et tes
            contraintes pour gagner du temps.
          </p>
        </div>
        <button
          type="button"
          className="text-brand-500 hover:text-brand-700 text-sm shrink-0"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-brand-200">
          {personas.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-brand-900 mb-1">
                Profil de voyage à utiliser
              </label>
              <select
                className="input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_default ? ' (par défaut)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {travelers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-brand-900 mb-1">
                Voyageurs ({selectedTravelers.length} / {travelers.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {travelers.map((t) => {
                  const active = selectedTravelers.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setSelectedTravelers((arr) =>
                          arr.includes(t.id)
                            ? arr.filter((x) => x !== t.id)
                            : [...arr, t.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {t.name}
                      {t.birth_year &&
                        ` (${new Date().getFullYear() - t.birth_year}a)`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={applyPrefill}>
          Préremplir
        </button>
        {(personas.length > 1 || travelers.length > 0) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Masquer' : 'Personnaliser'}
          </button>
        )}
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline px-2"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          Repartir de zéro
        </button>
      </div>
    </div>
  );
}
