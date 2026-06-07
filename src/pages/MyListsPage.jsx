import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listPackingLists,
  savePackingList,
  updatePackingList,
  deletePackingList,
} from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

// Les titres de catégorie sont stockés comme des items spéciaux préfixés.
// Ça évite de modifier la base de données : un item commençant par "# "
// est un titre de catégorie, sinon c'est un article à cocher.
const CAT_PREFIX = '# ';
const isCat = (s) => typeof s === 'string' && s.startsWith(CAT_PREFIX);
const catLabel = (s) => (isCat(s) ? s.slice(CAT_PREFIX.length) : s);
const makeCat = (label) => CAT_PREFIX + label;

// Transforme un texte collé en liste d'items (avec titres de catégories).
// Formats acceptés :
//   - "Documents : permis de conduire, carte grise ; Literie : oreillers"
//   - une ligne "Documents :" suivie d'une ligne par article
//   - un simple article par ligne (sans catégorie)
function parseBulk(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    // ";" sépare plusieurs groupes de catégories sur une même ligne
    const segments = rawLine.split(';');
    for (const seg of segments) {
      const s = seg.trim();
      if (!s) continue;
      const colon = s.indexOf(':');
      // Un ":" en début de segment => "Catégorie : articles…"
      if (colon > 0 && colon < 45) {
        const header = s.slice(0, colon).trim();
        const rest = s.slice(colon + 1).trim();
        if (header) out.push(makeCat(header));
        rest
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((it) => out.push(it));
      } else {
        s.split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((it) => out.push(it));
      }
    }
  }
  return out;
}

// Nombre d'articles réels (hors titres de catégories).
const countArticles = (items) => items.filter((i) => !isCat(i) && i.trim()).length;

// --- Mémorisation des cases cochées (sur l'appareil, sans base de données) ---
const checksKey = (id) => `travelo_checks_${id}`;
function loadChecks(id) {
  try {
    const raw = localStorage.getItem(checksKey(id));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveChecks(id, set) {
  try {
    localStorage.setItem(checksKey(id), JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export default function MyListsPage() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, name, items }
  const [checking, setChecking] = useState(null); // liste en cours de cochage
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [addingArticle, setAddingArticle] = useState(false); // choix de catégorie
  const [pendingFocus, setPendingFocus] = useState(null); // index à focaliser
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const itemRefs = useRef([]);

  // Place le curseur dans le champ d'un article fraîchement ajouté.
  useEffect(() => {
    if (pendingFocus != null && itemRefs.current[pendingFocus]) {
      itemRefs.current[pendingFocus].focus();
      setPendingFocus(null);
    }
  }, [editing?.items, pendingFocus]);

  async function refresh() {
    setLoading(true);
    const { data, error } = await listPackingLists();
    if (error) setError(error.message);
    else setLists(data || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function resetBulk() {
    setBulkOpen(false);
    setBulkText('');
    setAddingArticle(false);
  }

  function startNew() {
    setEditing({ name: '', items: [] });
    setChecking(null);
    resetBulk();
  }

  function startEdit(list) {
    setEditing({ id: list.id, name: list.name, items: [...list.items] });
    setChecking(null);
    resetBulk();
  }

  function startCheck(list) {
    setChecking(list);
    setEditing(null);
  }

  async function handleSave() {
    if (!editing?.name?.trim()) {
      setError('Donnez un nom à votre liste.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On garde les titres de catégories, on retire seulement les lignes vides.
      const cleanItems = editing.items.filter((i) => i.trim());
      if (editing.id) {
        const { error } = await updatePackingList(editing.id, {
          name: editing.name.trim(),
          items: cleanItems,
        });
        if (error) throw error;
      } else {
        const { error } = await savePackingList(editing.name.trim(), cleanItems);
        if (error) throw error;
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette liste ?')) return;
    setBusy(true);
    const { error } = await deletePackingList(id);
    if (error) setError(error.message);
    else await refresh();
    setBusy(false);
  }

  const hasCategories = editing?.items?.some(isCat);

  // Clic sur « + Ajouter un article » : si des catégories existent, on demande
  // d'abord dans laquelle ranger l'article ; sinon on ajoute directement.
  function handleAddArticleClick() {
    if (hasCategories) setAddingArticle((v) => !v);
    else addItemToCategory(-1);
  }

  // Ajoute un article vide à la fin de la catégorie choisie (catIdx = index du
  // titre de catégorie, ou -1 pour « sans catégorie / au début »).
  function addItemToCategory(catIdx) {
    const arr = [...(editing?.items || [])];
    let insertAt;
    if (catIdx < 0) {
      const firstCat = arr.findIndex(isCat);
      insertAt = firstCat === -1 ? arr.length : firstCat;
    } else {
      let j = catIdx + 1;
      while (j < arr.length && !isCat(arr[j])) j++;
      insertAt = j;
    }
    arr.splice(insertAt, 0, '');
    setEditing((e) => ({ ...e, items: arr }));
    setPendingFocus(insertAt);
    setAddingArticle(false);
  }
  function addCategory() {
    const insertAt = editing.items.length;
    setEditing((e) => ({ ...e, items: [...e.items, makeCat('')] }));
    setPendingFocus(insertAt);
  }

  // --- Glisser-déposer : déplacer un article (et le changer de catégorie) ---
  function handleDropAt(targetInsert) {
    if (dragIndex == null) {
      setDragOverIndex(null);
      return;
    }
    const arr = [...editing.items];
    const [moved] = arr.splice(dragIndex, 1);
    let insertAt = targetInsert;
    if (dragIndex < targetInsert) insertAt -= 1;
    arr.splice(insertAt, 0, moved);
    setEditing((e) => ({ ...e, items: arr }));
    setDragIndex(null);
    setDragOverIndex(null);
  }
  function updateItem(idx, value) {
    setEditing((e) => ({
      ...e,
      items: e.items.map((it, i) =>
        i === idx ? (isCat(it) ? makeCat(value) : value) : it
      ),
    }));
  }
  function removeItem(idx) {
    setEditing((e) => ({
      ...e,
      items: e.items.filter((_, i) => i !== idx),
    }));
  }
  function addBulkItems() {
    const newItems = parseBulk(bulkText);
    if (newItems.length === 0) {
      resetBulk();
      return;
    }
    setEditing((e) => ({
      ...e,
      items: [...e.items.filter((i) => i.trim()), ...newItems],
    }));
    resetBulk();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Préparatifs"
        eyebrowColor="sunset"
        title="Mes listes d'affaires"
        description="Vos check-lists personnelles (« Van été », « Camping rando »…). Cochez-les directement ici, ou attachez-les à un itinéraire depuis l'onglet Pratique."
        action={
          !editing &&
          !checking && (
            <button
              onClick={startNew}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <Icon name="plus" className="h-4 w-4" />
              Nouvelle liste
            </button>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {checking && (
        <ChecklistView list={checking} onClose={() => setChecking(null)} />
      )}

      {editing && (
        <div className="card space-y-4">
          <div>
            <label className="label">Nom de la liste</label>
            <input
              autoFocus
              className="input"
              placeholder="Ex : Van — essentiels été"
              value={editing.name}
              onChange={(e) =>
                setEditing((cur) => ({ ...cur, name: e.target.value }))
              }
            />
          </div>

          <div>
            <label className="label">Articles & catégories</label>
            <p className="text-xs text-slate-400 mb-2">
              Astuce : glissez la poignée ⠿ d'un article pour le déplacer ou le
              changer de catégorie.
            </p>
            <ul className="space-y-2">
              {editing.items.map((item, i) =>
                isCat(item) ? (
                  <li
                    key={i}
                    onDragOver={(e) => {
                      if (dragIndex != null) {
                        e.preventDefault();
                        setDragOverIndex(i);
                      }
                    }}
                    onDrop={() => handleDropAt(i + 1)}
                    className={`flex items-center gap-2 rounded-md ${
                      dragOverIndex === i ? 'ring-2 ring-brand-400' : ''
                    }`}
                  >
                    <span className="text-brand-500 text-xs font-semibold uppercase tracking-wide w-6 text-right">
                      §
                    </span>
                    <input
                      className="input flex-1 font-semibold uppercase tracking-wide text-slate-700 bg-slate-50"
                      placeholder="Titre de catégorie (ex : Documents)"
                      value={catLabel(item)}
                      onChange={(e) => updateItem(i, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-slate-400 hover:text-red-600 text-sm"
                      aria-label="Supprimer la catégorie"
                    >
                      ×
                    </button>
                  </li>
                ) : (
                  <li
                    key={i}
                    onDragOver={(e) => {
                      if (dragIndex != null) {
                        e.preventDefault();
                        setDragOverIndex(i);
                      }
                    }}
                    onDrop={() => handleDropAt(i)}
                    className={`flex items-center gap-2 rounded-md ${
                      dragOverIndex === i ? 'border-t-2 border-brand-400' : ''
                    } ${dragIndex === i ? 'opacity-40' : ''}`}
                  >
                    <span
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none px-1 text-sm"
                      title="Glisser pour déplacer"
                    >
                      ⠿
                    </span>
                    <input
                      ref={(el) => (itemRefs.current[i] = el)}
                      className="input flex-1"
                      placeholder="Ex : Bouteille de gaz de rechange"
                      value={item}
                      onChange={(e) => updateItem(i, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-slate-400 hover:text-red-600 text-sm"
                      aria-label="Supprimer"
                    >
                      ×
                    </button>
                  </li>
                )
              )}
            </ul>

            {addingArticle && (
              <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3 space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Dans quelle catégorie ranger ce nouvel article ?
                </p>
                <div className="flex flex-wrap gap-2">
                  {editing.items.map((it, i) =>
                    isCat(it) ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => addItemToCategory(i)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {catLabel(it).trim() || '(catégorie sans titre)'}
                      </button>
                    ) : null
                  )}
                  <button
                    type="button"
                    onClick={() => addItemToCategory(-1)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                  >
                    Sans catégorie
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingArticle(false)}
                    className="rounded-full px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAddArticleClick}
                className="btn-secondary text-sm"
              >
                + Ajouter un article
              </button>
              <button
                type="button"
                onClick={addCategory}
                className="btn-secondary text-sm"
              >
                + Ajouter une catégorie
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen((v) => !v)}
                className="btn-secondary text-sm"
              >
                + Ajouter en masse
              </button>
            </div>

            {bulkOpen && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Collez votre liste d'un coup. Vous pouvez créer des
                  catégories en écrivant le titre suivi de deux points «&nbsp;:&nbsp;»,
                  puis les articles séparés par des virgules. Séparez les
                  catégories par un point-virgule «&nbsp;;&nbsp;» ou un retour à
                  la ligne.
                </p>
                <textarea
                  autoFocus
                  rows={7}
                  className="input w-full font-mono text-sm"
                  placeholder={
                    'Documents : permis de conduire, carte grise, assurance véhicule\nLiterie & confort : oreillers, couverture polaire, sacs de couchage\nHygiène : dentifrice, brosses à dents, savon'
                  }
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={addBulkItems}
                    className="btn-primary text-sm"
                  >
                    Tout ajouter
                  </button>
                  <button
                    type="button"
                    onClick={resetBulk}
                    className="btn-secondary text-sm"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              onClick={() => setEditing(null)}
              disabled={busy}
              className="btn-secondary"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !editing.name.trim()}
              className="btn-primary"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer la liste'}
            </button>
          </div>
        </div>
      )}

      {!editing && !checking && (
        <>
          {loading ? (
            <p className="text-slate-500">Chargement…</p>
          ) : lists.length === 0 ? (
            <div className="card text-center text-slate-500">
              Aucune liste pour le moment.
              <div className="mt-4">
                <button onClick={startNew} className="btn-primary">
                  Créer ma première liste
                </button>
              </div>
            </div>
          ) : (
            <ul className="grid md:grid-cols-2 gap-4">
              {lists.map((l) => {
                const nbArticles = countArticles(l.items);
                return (
                  <li key={l.id} className="card">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold text-slate-900">{l.name}</h2>
                      <span className="text-xs text-slate-400">
                        {nbArticles} article{nbArticles > 1 ? 's' : ''}
                      </span>
                    </div>
                    {l.items.length > 0 && (
                      <ul className="mt-3 text-sm text-slate-600 space-y-1 max-h-40 overflow-y-auto">
                        {l.items.slice(0, 8).map((it, i) =>
                          isCat(it) ? (
                            <li
                              key={i}
                              className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 pt-1 truncate"
                            >
                              {catLabel(it)}
                            </li>
                          ) : (
                            <li key={i} className="truncate">
                              • {it}
                            </li>
                          )
                        )}
                        {l.items.length > 8 && (
                          <li className="text-slate-400 text-xs">
                            + {l.items.length - 8} ligne
                            {l.items.length - 8 > 1 ? 's' : ''}…
                          </li>
                        )}
                      </ul>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <button
                        onClick={() => startCheck(l)}
                        className="btn-primary text-sm"
                      >
                        Cocher la liste
                      </button>
                      <button
                        onClick={() => startEdit(l)}
                        className="btn-secondary text-sm"
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDelete(l.id)}
                        disabled={busy}
                        className="text-sm text-red-600 hover:underline ml-auto"
                      >
                        Supprimer
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// Vue « checklist » : on coche les articles au fur et à mesure.
// L'état coché est mémorisé sur l'appareil (localStorage), pas en base.
function ChecklistView({ list, onClose }) {
  const [checked, setChecked] = useState(() => loadChecks(list.id));
  const [query, setQuery] = useState('');

  useEffect(() => {
    saveChecks(list.id, checked);
  }, [list.id, checked]);

  const items = list.items || [];
  const total = useMemo(() => countArticles(items), [items]);
  const done = useMemo(
    () => items.filter((it, i) => !isCat(it) && it.trim() && checked.has(i)).length,
    [items, checked]
  );
  const percent = total ? Math.round((done / total) * 100) : 0;

  function toggle(idx) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }
  function uncheckAll() {
    setChecked(new Set());
  }

  // Regroupe les articles sous leurs titres de catégories.
  const groups = useMemo(() => {
    const g = [];
    let current = { label: null, entries: [] };
    items.forEach((it, idx) => {
      if (isCat(it)) {
        if (current.label !== null || current.entries.length) g.push(current);
        current = { label: catLabel(it), entries: [] };
      } else if (it.trim()) {
        current.entries.push({ text: it, idx });
      }
    });
    if (current.label !== null || current.entries.length) g.push(current);
    return g;
  }, [items]);

  const q = query.trim().toLowerCase();
  const matches = (text) => !q || text.toLowerCase().includes(q);

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{list.name}</h2>
          <p className="text-sm text-slate-500">
            Cochez les articles au fur et à mesure.
          </p>
        </div>
        <button onClick={onClose} className="btn-secondary text-sm">
          ← Retour
        </button>
      </div>

      {/* Compteurs + barre de progression */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-slate-900">{total}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            articles
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-slate-900">{done}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            cochés
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-emerald-600">{percent}%</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            prêt
          </div>
        </div>
        <div className="flex-1 min-w-[120px]">
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="Rechercher un article…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={uncheckAll}
          disabled={done === 0}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          Tout décocher
        </button>
      </div>

      {total === 0 ? (
        <p className="text-slate-500 text-sm">
          Cette liste est vide. Cliquez sur « Modifier » pour ajouter des
          articles.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => {
            const visible = g.entries.filter((e) => matches(e.text));
            if (visible.length === 0) return null;
            return (
              <div key={gi}>
                {g.label && (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    {g.label}
                  </h3>
                )}
                <ul className="grid sm:grid-cols-2 gap-2">
                  {visible.map((e) => {
                    const on = checked.has(e.idx);
                    return (
                      <li key={e.idx}>
                        <label
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                            on
                              ? 'border-emerald-300 bg-emerald-50 text-slate-400 line-through'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(e.idx)}
                          />
                          <span>{e.text}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
