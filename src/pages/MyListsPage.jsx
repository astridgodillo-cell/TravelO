import { useEffect, useState } from 'react';
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

export default function MyListsPage() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, name, items }
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

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
  }

  function startNew() {
    setEditing({ name: '', items: [] });
    resetBulk();
  }

  function startEdit(list) {
    setEditing({ id: list.id, name: list.name, items: [...list.items] });
    resetBulk();
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

  function addItem() {
    setEditing((e) => ({ ...e, items: [...e.items, ''] }));
  }
  function addCategory() {
    setEditing((e) => ({ ...e, items: [...e.items, makeCat('')] }));
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
        description="Vos check-lists personnelles (« Van été », « Camping rando »…). Attachables à n'importe quel itinéraire depuis l'onglet Pratique."
        action={
          !editing && (
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
            <ul className="space-y-2">
              {editing.items.map((item, i) =>
                isCat(item) ? (
                  <li key={i} className="flex items-center gap-2">
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
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-6 text-right">
                      •
                    </span>
                    <input
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

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addItem}
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

      {!editing && (
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
                    <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                      <button
                        onClick={() => startEdit(l)}
                        className="btn-secondary text-sm"
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDelete(l.id)}
                        disabled={busy}
                        className="text-sm text-red-600 hover:underline"
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
