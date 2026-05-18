import { useEffect, useState } from 'react';
import { listTemplates, saveTemplate, deleteTemplate } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function TemplatePicker({ currentPreferences, onLoad }) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await listTemplates();
    if (error) setError(error.message);
    else setTemplates(data || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, [user]);

  async function handleSave() {
    const name = prompt(
      'Nom du template ?',
      `${currentPreferences?.destinations || 'Mon voyage'} - ${currentPreferences?.tripType || ''}`
    );
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await saveTemplate(name.trim(), currentPreferences);
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce template ?')) return;
    const { error } = await deleteTemplate(id);
    if (error) setError(error.message);
    else refresh();
  }

  if (!user) {
    return (
      <p className="text-xs text-slate-400">
        Connectez-vous pour enregistrer et réutiliser des templates de
        préférences (véhicule, voyageurs, etc.).
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-700">Mes templates</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs text-brand-700 hover:underline"
        >
          {saving ? 'Enregistrement…' : '+ Sauver les préférences actuelles'}
        </button>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {loading ? (
        <div className="text-xs text-slate-400">Chargement…</div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-slate-400">
          Aucun template enregistré pour l'instant.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <li
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white pl-3 pr-1.5 py-1 text-xs"
            >
              <button
                type="button"
                onClick={() => onLoad(t.preferences)}
                className="text-slate-700 hover:text-brand-700"
              >
                {t.name}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(t.id)}
                className="text-slate-400 hover:text-red-600 px-1"
                aria-label="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
