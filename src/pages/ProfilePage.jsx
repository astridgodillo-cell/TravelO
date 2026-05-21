import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getMyProfile,
  updateMyProfile,
  listTravelers,
  saveTraveler,
  updateTraveler,
  deleteTraveler,
  listTemplates,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
} from '../lib/supabase';
import {
  TRIP_TYPES,
  BUDGET_LEVELS,
  DIETARY_OPTIONS,
  COMMON_LANGUAGES,
  PROFILE_PREF_DEFAULTS,
} from '../lib/preferenceOptions';
import PreferencesEditor from '../components/PreferencesEditor';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

const TABS = [
  { id: 'preferences', label: 'Mes préférences', icon: 'sliders' },
  { id: 'personas', label: 'Profils de voyage', icon: 'mask' },
  { id: 'travelers', label: 'Mes voyageurs', icon: 'users' },
  { id: 'visited', label: 'Lieux visités', icon: 'check-circle' },
  { id: 'wishlist', label: 'Wishlist', icon: 'star' },
];

export default function ProfilePage() {
  const { user, profile: ctxProfile, refreshProfile } = useAuth();
  const [tab, setTab] = useState('preferences');
  const [profile, setProfile] = useState(ctxProfile);

  // Recharge le profil complet (le contexte est OK mais on veut être sûr d'avoir
  // les colonnes jsonb visited_places/wishlist_places/personal_info à jour).
  useEffect(() => {
    if (!user) return;
    getMyProfile().then(({ data }) => {
      if (data) setProfile(data);
    });
  }, [user]);

  function onProfileUpdated(updated) {
    setProfile(updated);
    refreshProfile?.();
  }

  if (!user) return null;
  if (!profile) {
    return <div className="text-center py-12 text-slate-500">Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Votre espace"
        eyebrowColor="brand"
        title="Mon profil"
        description="Configurez vos préférences pour gagner du temps à chaque nouvel itinéraire."
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 sm:gap-2 border-b border-slate-200 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600 -mb-[1px]'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'preferences' && (
        <DefaultPreferencesTab profile={profile} onUpdated={onProfileUpdated} />
      )}
      {tab === 'personas' && <PersonasTab />}
      {tab === 'travelers' && <TravelersTab />}
      {tab === 'visited' && (
        <PlaceListTab
          kind="visited"
          title="Lieux déjà visités"
          help="Ces lieux seront évités automatiquement quand on génèrera un nouvel itinéraire (sauf si tu les ajoutes explicitement aux étapes impératives)."
          field="visited_places"
          profile={profile}
          onUpdated={onProfileUpdated}
        />
      )}
      {tab === 'wishlist' && (
        <PlaceListTab
          kind="wishlist"
          title="Wishlist"
          help="Lieux que tu rêves de visiter un jour. L'IA essaiera de les caser dans l'itinéraire quand la destination s'y prête."
          field="wishlist_places"
          profile={profile}
          onUpdated={onProfileUpdated}
        />
      )}
    </div>
  );
}

/* ============================================================
 * TAB 1 : MES PRÉFÉRENCES PAR DÉFAUT (persona par défaut)
 * On stocke dans le persona is_default=true.
 * ============================================================ */
function DefaultPreferencesTab({ profile, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [defaultTpl, setDefaultTpl] = useState(null);
  const [prefs, setPrefs] = useState(PROFILE_PREF_DEFAULTS);
  const [personalInfo, setPersonalInfo] = useState(
    profile.personal_info || {}
  );

  useEffect(() => {
    listTemplates().then(({ data }) => {
      const def = (data || []).find((t) => t.is_default);
      if (def) {
        setDefaultTpl(def);
        setPrefs({ ...PROFILE_PREF_DEFAULTS, ...(def.preferences || {}) });
      }
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      // 1) Persona par défaut : créé s'il n'existe pas, sinon mis à jour.
      if (defaultTpl) {
        const { data } = await updateTemplate(defaultTpl.id, {
          preferences: prefs,
        });
        if (data) setDefaultTpl(data);
      } else {
        const { data: created } = await saveTemplate(
          'Mes préférences par défaut',
          prefs
        );
        if (created) {
          await setDefaultTemplate(created.id);
          setDefaultTpl({ ...created, is_default: true });
        }
      }
      // 2) Infos personnelles (régime, langues) sur le profil.
      //    On marque aussi l'onboarding comme terminé : l'utilisateur a
      //    configuré son profil ici → le bandeau de bienvenue n'a plus
      //    de raison d'apparaître.
      const { data: updatedProfile } = await updateMyProfile({
        personal_info: personalInfo,
        onboarding_completed: true,
      });
      if (updatedProfile) onUpdated(updatedProfile);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        💡 Ces préférences seront proposées en pré-remplissage à chaque nouvel
        itinéraire (avec confirmation). Tu peux toujours les ajuster avant de générer.
      </div>

      <PreferencesEditor values={prefs} onChange={setPrefs} />

      <Section title="🍽️ Régime alimentaire (de l'utilisateur principal)">
        <p className="text-xs text-slate-500 -mt-2">
          Pour les voyageurs supplémentaires (conjoint, enfants…), utilise l'onglet
          "Mes voyageurs".
        </p>
        <ChipMultiSelect
          options={DIETARY_OPTIONS.map((d) => ({ id: d, label: d }))}
          selected={personalInfo.dietary || []}
          onToggle={(v) =>
            setPersonalInfo((p) => ({
              ...p,
              dietary: toggleArray(p.dietary || [], v),
            }))
          }
        />
      </Section>

      <Section title="🗣️ Langues parlées">
        <ChipMultiSelect
          options={COMMON_LANGUAGES.map((d) => ({ id: d, label: d }))}
          selected={personalInfo.languages || []}
          onToggle={(v) =>
            setPersonalInfo((p) => ({
              ...p,
              languages: toggleArray(p.languages || [], v),
            }))
          }
        />
      </Section>

      <Section title="🦽 Mobilité particulière">
        <input
          className="input"
          placeholder="Ex : difficultés avec les escaliers, fauteuil roulant…"
          value={personalInfo.mobility || ''}
          onChange={(e) =>
            setPersonalInfo((p) => ({ ...p, mobility: e.target.value }))
          }
        />
      </Section>

      <Section title="📝 Allergies / notes médicales">
        <textarea
          rows="2"
          className="input"
          placeholder="Ex : allergie arachides, asthme léger…"
          value={personalInfo.allergies || ''}
          onChange={(e) =>
            setPersonalInfo((p) => ({ ...p, allergies: e.target.value }))
          }
        />
      </Section>

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        {savedAt && (
          <span className="text-xs text-emerald-700">
            Enregistré à {savedAt.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * TAB 2 : PERSONAS (profils de voyage multiples)
 * ============================================================ */
function PersonasTab() {
  const { refreshProfile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, name, preferences }

  async function reload() {
    setLoading(true);
    const { data } = await listTemplates();
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSave() {
    if (!editing.name?.trim()) return;
    if (editing.id) {
      await updateTemplate(editing.id, {
        name: editing.name,
        preferences: editing.preferences,
      });
    } else {
      await saveTemplate(editing.name, editing.preferences);
    }
    // Configurer un persona = onboarding terminé.
    await updateMyProfile({ onboarding_completed: true });
    refreshProfile?.();
    setEditing(null);
    reload();
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce profil de voyage ?')) return;
    await deleteTemplate(id);
    reload();
  }

  async function handleSetDefault(id) {
    await setDefaultTemplate(id);
    reload();
  }

  if (loading) return <div className="text-sm text-slate-500">Chargement…</div>;

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {editing.id ? 'Modifier' : 'Nouveau'} profil de voyage
          </h2>
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline"
            onClick={() => setEditing(null)}
          >
            ← Retour à la liste
          </button>
        </div>
        <div>
          <label className="label">Nom du profil</label>
          <input
            className="input"
            placeholder="Ex : Solo aventure, Famille, Couple weekend…"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>
        <PreferencesEditor
          values={editing.preferences}
          onChange={(p) => setEditing({ ...editing, preferences: p })}
        />
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing(null)}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
          >
            {editing.id ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        🎭 Crée plusieurs profils correspondant à tes types de voyage récurrents
        (solo, couple, en famille, etc.). Au moment de créer un itinéraire, tu choisis lequel
        utiliser.
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            setEditing({ name: '', preferences: PROFILE_PREF_DEFAULTS })
          }
        >
          + Nouveau profil
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card text-center py-10 text-slate-500">
          Aucun profil de voyage enregistré.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">{item.name}</h3>
                  {item.is_default && (
                    <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] uppercase tracking-wide px-2 py-0.5">
                      Par défaut
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {summarizePrefs(item.preferences)}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {!item.is_default && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(item.id)}
                    className="text-xs text-emerald-700 hover:underline"
                  >
                    Définir par défaut
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: item.id,
                      name: item.name,
                      preferences: {
                        ...PROFILE_PREF_DEFAULTS,
                        ...(item.preferences || {}),
                      },
                    })
                  }
                  className="text-xs text-brand-700 hover:underline"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizePrefs(p) {
  if (!p) return '';
  const parts = [];
  const tt = TRIP_TYPES.find((t) => t.id === p.tripType);
  if (tt) parts.push(tt.label);
  const b = BUDGET_LEVELS.find((b) => b.id === p.budget);
  if (b) parts.push(`Budget ${b.label.toLowerCase()}`);
  if (p.interests?.length) parts.push(p.interests.slice(0, 3).join(', '));
  return parts.join(' · ');
}

/* ============================================================
 * TAB 3 : VOYAGEURS
 * ============================================================ */
const RELATIONS = ['conjoint·e', 'enfant', 'parent', 'ami·e', 'autre'];

function TravelersTab() {
  const { refreshProfile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  async function reload() {
    setLoading(true);
    const { data } = await listTravelers();
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  function emptyTraveler() {
    return {
      name: '',
      relation: 'conjoint·e',
      birth_year: null,
      dietary: [],
      allergies: '',
      mobility: '',
      languages: [],
      notes: '',
    };
  }

  async function handleSave() {
    if (!editing.name?.trim()) return;
    const clean = {
      ...editing,
      birth_year: editing.birth_year ? Number(editing.birth_year) : null,
    };
    if (editing.id) {
      const { id, created_at: _c, updated_at: _u, user_id: _uid, ...patch } = clean;
      await updateTraveler(id, patch);
    } else {
      await saveTraveler(clean);
    }
    // Ajouter un voyageur = onboarding terminé.
    await updateMyProfile({ onboarding_completed: true });
    refreshProfile?.();
    setEditing(null);
    reload();
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce voyageur ?')) return;
    await deleteTraveler(id);
    reload();
  }

  if (loading) return <div className="text-sm text-slate-500">Chargement…</div>;

  if (editing) {
    return (
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {editing.id ? 'Modifier' : 'Nouveau'} voyageur
          </h2>
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline"
            onClick={() => setEditing(null)}
          >
            ← Retour
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Prénom / nom</label>
            <input
              className="input"
              placeholder="Ex : Léa"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Relation</label>
            <select
              className="input"
              value={editing.relation || ''}
              onChange={(e) => setEditing({ ...editing, relation: e.target.value })}
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Année de naissance (pour calculer l'âge)</label>
            <input
              type="number"
              className="input"
              placeholder="Ex : 2018"
              value={editing.birth_year || ''}
              onChange={(e) =>
                setEditing({ ...editing, birth_year: e.target.value })
              }
            />
          </div>
        </div>

        <div>
          <label className="label">Régime alimentaire</label>
          <ChipMultiSelect
            options={DIETARY_OPTIONS.map((d) => ({ id: d, label: d }))}
            selected={editing.dietary || []}
            onToggle={(v) =>
              setEditing({
                ...editing,
                dietary: toggleArray(editing.dietary || [], v),
              })
            }
          />
        </div>

        <div>
          <label className="label">Langues parlées</label>
          <ChipMultiSelect
            options={COMMON_LANGUAGES.map((d) => ({ id: d, label: d }))}
            selected={editing.languages || []}
            onToggle={(v) =>
              setEditing({
                ...editing,
                languages: toggleArray(editing.languages || [], v),
              })
            }
          />
        </div>

        <div>
          <label className="label">Allergies</label>
          <input
            className="input"
            placeholder="Ex : arachides, fruits à coque"
            value={editing.allergies || ''}
            onChange={(e) =>
              setEditing({ ...editing, allergies: e.target.value })
            }
          />
        </div>

        <div>
          <label className="label">Mobilité</label>
          <input
            className="input"
            placeholder="Ex : difficultés escaliers"
            value={editing.mobility || ''}
            onChange={(e) =>
              setEditing({ ...editing, mobility: e.target.value })
            }
          />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            rows="2"
            className="input"
            value={editing.notes || ''}
            onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing(null)}
          >
            Annuler
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            {editing.id ? 'Mettre à jour' : 'Ajouter'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
        👥 Enregistre ici les personnes avec qui tu voyages régulièrement. Leurs
        contraintes (régime, allergies, mobilité) seront transmises à l'IA pour adapter
        l'itinéraire.
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setEditing(emptyTraveler())}
        >
          + Ajouter un voyageur
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card text-center py-10 text-slate-500">
          Aucun voyageur enregistré.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((t) => {
            const age =
              t.birth_year ? new Date().getFullYear() - t.birth_year : null;
            return (
              <div
                key={t.id}
                className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">{t.name}</h3>
                    {t.relation && (
                      <span className="text-xs text-slate-500">· {t.relation}</span>
                    )}
                    {age !== null && (
                      <span className="text-xs text-slate-500">· {age} ans</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {[
                      t.dietary?.length && t.dietary.join(', '),
                      t.allergies && `allergies : ${t.allergies}`,
                      t.mobility,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Aucune contrainte particulière'}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * TAB 4 + 5 : LIEUX VISITÉS / WISHLIST
 * Composant générique paramétré par le champ JSONB cible.
 * ============================================================ */
function PlaceListTab({ title, help, field, profile, onUpdated }) {
  const initial = Array.isArray(profile[field]) ? profile[field] : [];
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    setItems(Array.isArray(profile[field]) ? profile[field] : []);
  }, [profile, field]);

  function addItem() {
    const name = draft.trim();
    if (!name) return;
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return;
    }
    setItems([...items, { name }]);
    setDraft('');
  }

  function removeItem(name) {
    setItems(items.filter((i) => i.name !== name));
  }

  function updateNotes(name, notes) {
    setItems(items.map((i) => (i.name === name ? { ...i, notes } : i)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await updateMyProfile({
        [field]: items,
        onboarding_completed: true,
      });
      if (data) onUpdated(data);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {help}
      </div>

      <div className="card space-y-3">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Ex : Lisbonne, Mont Saint-Michel, Kyoto…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={addItem}
          >
            + Ajouter
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-center py-6 text-slate-500 text-sm">
            Aucun lieu pour le moment.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => (
              <li key={it.name} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="font-medium text-slate-900 sm:w-1/3">
                  {it.name}
                </span>
                <input
                  className="input flex-1 text-sm"
                  placeholder="Note (optionnel)"
                  value={it.notes || ''}
                  onChange={(e) => updateNotes(it.name, e.target.value)}
                />
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline shrink-0"
                  onClick={() => removeItem(it.name)}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
        {savedAt && (
          <span className="text-xs text-emerald-700">
            Enregistré à {savedAt.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * PETITS HELPERS UI
 * ============================================================ */
function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChipMultiSelect({ options, selected, onToggle, single, small, capitalize }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = (selected || []).includes(opt.id);
        const sizeCls = small
          ? 'px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-sm'
          : 'px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm';
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onToggle(opt.id, single)}
            className={`rounded-full border transition-colors ${sizeCls} ${
              capitalize ? 'capitalize' : ''
            } ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function toggleArray(arr, value) {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
}
