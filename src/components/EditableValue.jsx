import { useEffect, useRef, useState } from 'react';

/**
 * Valeur éditable inline : par défaut elle se rend comme du texte normal.
 * Au clic, elle devient un champ de saisie ; Enter / blur sauve, Echap annule.
 * Sauvegarde asynchrone via onSave(value) qui doit renvoyer une Promise.
 *
 * Props :
 *  - value         valeur courante affichée
 *  - onSave        async (newValue) => void
 *  - type          'number' | 'text' | 'time'
 *  - suffix        affiché à droite (ex : '€', '€ / pers.')
 *  - prefix        affiché à gauche (ex : '≈ ')
 *  - format        (v) => string pour la version affichée (ex : '247 €')
 *  - placeholder   placeholder de l'input
 *  - min, max, step (number)
 *  - className     classes appliquées au bouton affiché
 *  - inputClassName classes de l'input en mode édition
 *  - label         libellé d'aide (title attribute)
 *  - allowEmpty    si true, autorise la sauvegarde d'une valeur vide / null
 *
 * Rendu :
 *  - Hors édition : <button> qui ressemble à du texte, ✏️ apparaît au survol
 *  - En édition   : <input> autofocus, indication "Entrée pour sauver, Échap pour annuler"
 */
export default function EditableValue({
  value,
  onSave,
  type = 'text',
  suffix = '',
  prefix = '',
  format,
  placeholder = '',
  min,
  max,
  step,
  className = '',
  inputClassName = '',
  label = 'Cliquer pour modifier',
  allowEmpty = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(valueToInput(value, type));
  const [saving, setSaving] = useState(false);
  const wasEdited = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(valueToInput(value, type));
  }, [value, type, editing]);

  async function commit() {
    if (saving) return;
    if (!wasEdited.current) {
      setEditing(false);
      return;
    }
    const parsed = parseDraft(draft, type, allowEmpty);
    if (parsed.error) {
      setDraft(valueToInput(value, type));
      setEditing(false);
      wasEdited.current = false;
      return;
    }
    if (parsed.value === value) {
      setEditing(false);
      wasEdited.current = false;
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.value);
    } catch (e) {
      console.error('[EditableValue] save failed', e);
      // Restaure la valeur originale en cas d'erreur
      setDraft(valueToInput(value, type));
    } finally {
      setSaving(false);
      setEditing(false);
      wasEdited.current = false;
    }
  }

  function cancel() {
    setDraft(valueToInput(value, type));
    setEditing(false);
    wasEdited.current = false;
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        {prefix && <span className="text-slate-500">{prefix}</span>}
        <input
          autoFocus
          type={type === 'time' ? 'time' : type === 'number' ? 'number' : 'text'}
          value={draft}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          disabled={saving}
          onChange={(e) => {
            wasEdited.current = true;
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          className={`min-w-[3rem] max-w-[14rem] rounded border border-brand-400 bg-white px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-brand-300 ${inputClassName}`}
          style={{ width: `${Math.max(3, String(draft).length + 1)}ch` }}
        />
        {suffix && <span className="text-slate-500">{suffix}</span>}
        {saving && (
          <span
            className="ml-1 inline-block h-2 w-2 rounded-full bg-brand-500 animate-pulse"
            aria-label="Enregistrement…"
          />
        )}
      </span>
    );
  }

  const displayed =
    typeof format === 'function'
      ? format(value)
      : value == null || value === ''
        ? '—'
        : String(value);

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={label}
      className={`group inline-flex items-center gap-1 rounded px-1 -mx-1 transition-colors hover:bg-amber-50 cursor-text print:hover:bg-transparent print:px-0 print:mx-0 ${className}`}
    >
      <span>
        {prefix}
        {displayed}
        {suffix && <span className="ml-0.5">{suffix}</span>}
      </span>
      <span
        className="opacity-0 group-hover:opacity-60 text-[10px] transition-opacity print:hidden"
        aria-hidden="true"
      >
        ✏️
      </span>
    </button>
  );
}

function valueToInput(value, type) {
  if (value == null || value === undefined) return '';
  if (type === 'time' && typeof value === 'string') {
    // Cas "YYYY-MM-DDTHH:MM:SS" → HH:MM
    if (value.length >= 16 && value.includes('T')) {
      return value.substring(11, 16);
    }
  }
  return String(value);
}

function parseDraft(draft, type, allowEmpty) {
  const trimmed = String(draft).trim();
  if (trimmed === '') {
    if (allowEmpty) return { value: null, error: false };
    return { value: null, error: true };
  }
  if (type === 'number') {
    const n = Number(trimmed.replace(',', '.'));
    if (Number.isNaN(n)) return { value: null, error: true };
    return { value: n, error: false };
  }
  return { value: trimmed, error: false };
}
