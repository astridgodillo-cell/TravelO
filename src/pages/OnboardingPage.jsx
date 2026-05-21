import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  updateMyProfile,
  saveTemplate,
  setDefaultTemplate,
  saveTraveler,
} from '../lib/supabase';
import {
  PROFILE_PREF_DEFAULTS,
  DIETARY_OPTIONS,
  COMMON_LANGUAGES,
} from '../lib/preferenceOptions';
import PreferencesEditor from '../components/PreferencesEditor';

const STEPS = [
  { id: 1, label: 'Préférences voyage' },
  { id: 2, label: 'Voyageurs' },
  { id: 3, label: 'Vous' },
];

export default function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [prefs, setPrefs] = useState(PROFILE_PREF_DEFAULTS);
  const [travelers, setTravelers] = useState([]);
  const [personalInfo, setPersonalInfo] = useState({});

  function addTraveler() {
    setTravelers((t) => [
      ...t,
      { tempId: Date.now() + Math.random(), name: '', relation: 'enfant', birth_year: '' },
    ]);
  }
  function updateTraveler(idx, patch) {
    setTravelers((t) => t.map((tr, i) => (i === idx ? { ...tr, ...patch } : tr)));
  }
  function removeTraveler(idx) {
    setTravelers((t) => t.filter((_, i) => i !== idx));
  }

  async function persistAll(markCompleted) {
    setSaving(true);
    try {
      // 1) Persona par défaut (uniquement si au moins un champ modifié)
      const looksConfigured =
        prefs.tripType !== PROFILE_PREF_DEFAULTS.tripType ||
        prefs.budget !== PROFILE_PREF_DEFAULTS.budget ||
        (prefs.interests || []).length !== PROFILE_PREF_DEFAULTS.interests.length;
      if (looksConfigured) {
        const { data: tpl } = await saveTemplate('Mes préférences par défaut', prefs);
        if (tpl?.id) await setDefaultTemplate(tpl.id);
      }

      // 2) Voyageurs
      for (const t of travelers) {
        if (!t.name?.trim()) continue;
        const { tempId: _t, ...rest } = t;
        await saveTraveler({
          ...rest,
          birth_year: rest.birth_year ? Number(rest.birth_year) : null,
        });
      }

      // 3) Profil : personal_info + flag onboarding
      const patch = { personal_info: personalInfo };
      if (markCompleted) patch.onboarding_completed = true;
      await updateMyProfile(patch);
      await refreshProfile?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    // "Plus tard" : on ne marque PAS comme terminé. Le bandeau revient.
    navigate('/');
  }

  async function handleFinish() {
    await persistAll(true);
    navigate('/');
  }

  async function handleNext() {
    if (step < STEPS.length) setStep(step + 1);
    else await handleFinish();
  }

  if (!user) return null;
  if (profile?.onboarding_completed) {
    return (
      <div className="card text-center space-y-3 max-w-md mx-auto">
        <p className="text-slate-700">Tu as déjà complété ton profil ✅</p>
        <div className="flex justify-center gap-2">
          <Link to="/profil" className="btn-primary">
            Modifier mon profil
          </Link>
          <Link to="/" className="btn-secondary">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-coral-600">
          Premiers pas
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Bienvenue sur TravelO
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
          Configurons votre profil en 3 étapes pour que vos futurs itinéraires
          soient pré-remplis tout seuls. Vous pouvez passer chaque étape ou tout faire plus tard.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0 ${
                step === s.id
                  ? 'bg-brand-600 text-white'
                  : step > s.id
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {step > s.id ? '✓' : s.id}
            </div>
            <div
              className={`ml-2 text-sm font-medium hidden sm:block ${
                step === s.id ? 'text-slate-900' : 'text-slate-500'
              }`}
            >
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px bg-slate-200 mx-3" />
            )}
          </div>
        ))}
      </div>

      <div className="card space-y-6">
        {step === 1 && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Tes préférences de voyage
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Quels types de voyages te ressemblent ? Tu pourras toujours les
                ajuster avant chaque itinéraire.
              </p>
            </div>
            <PreferencesEditor values={prefs} onChange={setPrefs} compact />
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Avec qui voyages-tu ?
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Ajoute les personnes qui voyagent souvent avec toi (conjoint, enfants…).
                Tu peux passer cette étape et les ajouter plus tard.
              </p>
            </div>

            {travelers.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                Aucun voyageur ajouté.
              </div>
            ) : (
              <div className="space-y-3">
                {travelers.map((t, i) => (
                  <div
                    key={t.tempId}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                  >
                    <div className="sm:col-span-4">
                      <label className="label">Prénom</label>
                      <input
                        className="input"
                        placeholder="Ex : Léa"
                        value={t.name}
                        onChange={(e) => updateTraveler(i, { name: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="label">Relation</label>
                      <select
                        className="input"
                        value={t.relation}
                        onChange={(e) => updateTraveler(i, { relation: e.target.value })}
                      >
                        <option value="conjoint·e">conjoint·e</option>
                        <option value="enfant">enfant</option>
                        <option value="parent">parent</option>
                        <option value="ami·e">ami·e</option>
                        <option value="autre">autre</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="label">Année naiss.</label>
                      <input
                        type="number"
                        className="input"
                        placeholder="2018"
                        value={t.birth_year}
                        onChange={(e) => updateTraveler(i, { birth_year: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-1 sm:justify-self-end">
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => removeTraveler(i)}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={addTraveler}
            >
              + Ajouter un voyageur
            </button>

            <p className="text-xs text-slate-400">
              Pour les contraintes (allergies, mobilité, langues), tu pourras compléter chaque
              voyageur depuis la page "Mon profil".
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">À propos de toi</h2>
              <p className="text-sm text-slate-500 mt-1">
                Optionnel — mais ça aide l'IA à mieux calibrer tes itinéraires.
              </p>
            </div>

            <div>
              <label className="label">Régime alimentaire</label>
              <ChipPicker
                options={DIETARY_OPTIONS}
                selected={personalInfo.dietary || []}
                onToggle={(v) =>
                  setPersonalInfo((p) => ({
                    ...p,
                    dietary: toggle(p.dietary || [], v),
                  }))
                }
              />
            </div>

            <div>
              <label className="label">Langues parlées</label>
              <ChipPicker
                options={COMMON_LANGUAGES}
                selected={personalInfo.languages || []}
                onToggle={(v) =>
                  setPersonalInfo((p) => ({
                    ...p,
                    languages: toggle(p.languages || [], v),
                  }))
                }
              />
            </div>

            <div>
              <label className="label">Allergies / notes médicales</label>
              <input
                className="input"
                placeholder="Ex : allergie arachides"
                value={personalInfo.allergies || ''}
                onChange={(e) =>
                  setPersonalInfo((p) => ({ ...p, allergies: e.target.value }))
                }
              />
            </div>
          </>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline order-2 sm:order-1"
            onClick={handleSkip}
          >
            Plus tard
          </button>
          <div className="flex gap-2 order-1 sm:order-2">
            {step > 1 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setStep(step - 1)}
              >
                ← Précédent
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleNext}
              disabled={saving}
            >
              {step < STEPS.length
                ? 'Suivant →'
                : saving
                  ? 'Enregistrement…'
                  : 'Terminer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toggle(arr, value) {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
}

function ChipPicker({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
