import { useEffect, useState } from 'react';
import {
  listPackingLists,
  savePackingList,
  updatePackingList,
  deletePackingList,
} from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

export default function MyListsPage() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, name, items }
  const [busy, setBusy] = useState(false);

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

  function startNew() {
    setEditing({ name: '', items: [] });
  }

  function startEdit(list) {
    setEditing({ id: list.id, name: list.name, items: [...list.items] });
  }

  async function handleSave() {
    if (!editing?.name?.trim()) {
      setError('Donnez un nom à votre liste.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing.id) {
        const { error } = await updatePackingList(editing.id, {
          name: editing.name.trim(),
          items: editing.items.filter((i) => i.trim()),
        });
        if (error) throw error;
      } else {
        const { error } = await savePackingList(
          editing.name.trim(),
          editing.items.filter((i) => i.trim())
        );
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
  function updateItem(idx, value) {
    setEditing((e) => ({
      ...e,
      items: e.items.map((it, i) => (i === idx ? value : it)),
    }));
  }
  function removeItem(idx) {
    setEditing((e) => ({
      ...e,
      items: e.items.filter((_, i) => i !== idx),
    }));
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
            <label className="label">Items</label>
            <ul className="space-y-2">
              {editing.items.map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs w-6 text-right">
                    {i + 1}.
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
              ))}
            </ul>
            <button
              type="button"
              onClick={addItem}
              className="btn-secondary mt-3 text-sm"
            >
              + Ajouter un item
            </button>
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
              {lists.map((l) => (
                <li key={l.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">{l.name}</h2>
                    <span className="text-xs text-slate-400">
                      {l.items.length} item{l.items.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {l.items.length > 0 && (
                    <ul className="mt-3 text-sm text-slate-600 space-y-1 max-h-40 overflow-y-auto">
                      {l.items.slice(0, 8).map((it, i) => (
                        <li key={i} className="truncate">
                          • {it}
                        </li>
                      ))}
                      {l.items.length > 8 && (
                        <li className="text-slate-400 text-xs">
                          + {l.items.length - 8} autre
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
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
