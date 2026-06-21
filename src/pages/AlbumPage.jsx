import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getItinerary, updateItinerary, uploadAlbumPhoto } from '../lib/supabase';

// Album de voyage — mode « pendant le voyage » (carnet de bord).
// Route : /itineraire/:id/album
//
// L'utilisateur remplit son album jour après jour : pour chaque journée du
// voyage, il peut écrire un titre, un petit texte (journal) et ajouter des
// photos avec une légende sous chacune. Tout est enregistré dans le voyage
// (clé travel_album), donc il peut s'arrêter et reprendre quand il veut.
//
// Chaque photo est stockée en deux qualités : une légère pour l'affichage
// ici, une haute définition conservée pour l'impression (300 DPI). On prévient
// l'utilisateur si une photo est trop petite pour bien rendre à l'impression.

// Largeur (en pixels) en-dessous de laquelle une photo risque d'être floue
// imprimée en grand : 21 cm à 300 DPI ≈ 2480 px. On reste tolérant (la
// plupart des photos servent en demi/quart de page) et on alerte sous 1500 px.
const MIN_PRINT_PX = 1500;

function isLowRes(photo) {
  const longEdge = Math.max(photo?.w || 0, photo?.h || 0);
  return longEdge > 0 && longEdge < MIN_PRINT_PX;
}

function PhotoTile({ photo, onCaption, onRemove }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative aspect-[4/3] bg-slate-100">
        <img
          src={photo.display || photo.full}
          alt=""
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
          title="Retirer cette photo"
        >
          ✕
        </button>
        {isLowRes(photo) && (
          <span
            className="absolute bottom-1.5 left-1.5 rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
            title="Cette photo est un peu petite : elle peut sembler floue si elle est imprimée en grand."
          >
            ⚠︎ petite photo
          </span>
        )}
      </div>
      <input
        value={photo.caption || ''}
        onChange={(e) => onCaption(e.target.value)}
        placeholder="Légende sous la photo"
        className="w-full border-t border-slate-100 px-2.5 py-2 text-xs text-slate-700 outline-none"
      />
    </div>
  );
}

function DayCard({ day, index, entry, onChange, onAddPhotos, busy }) {
  const fileRef = useRef(null);

  const update = (patch) => onChange({ ...entry, ...patch });

  function setPhotoCaption(pi, caption) {
    const photos = entry.photos.map((p, i) =>
      i === pi ? { ...p, caption } : p
    );
    update({ photos });
  }
  function removePhoto(pi) {
    update({ photos: entry.photos.filter((_, i) => i !== pi) });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-coral-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-coral-600">
          Jour {index + 1}
          {day?.location ? ` · ${day.location}` : ''}
        </span>
      </div>

      <input
        value={entry.title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Titre de la journée"
        className="w-full border-0 border-b border-slate-200 pb-1.5 text-lg font-semibold text-slate-900 outline-none focus:border-coral-400"
      />

      <textarea
        value={entry.note}
        onChange={(e) => update({ note: e.target.value })}
        placeholder="Raconte ta journée : ce que tu as vu, mangé, ressenti…"
        rows={3}
        className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-coral-400"
      />

      {entry.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {entry.photos.map((p, pi) => (
            <PhotoTile
              key={pi}
              photo={p}
              onCaption={(c) => setPhotoCaption(pi, c)}
              onRemove={() => removePhoto(pi)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="mt-4 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {busy ? 'Ajout des photos…' : '📷 Ajouter des photos à cette journée'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) onAddPhotos(files);
        }}
      />
    </section>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [album, setAlbum] = useState(null); // { title, days: { [i]: entry } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [busyDay, setBusyDay] = useState(null); // index du jour en cours d'upload
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    let active = true;
    getItinerary(id).then(({ data, error: e }) => {
      if (!active) return;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      const it = data?.itinerary || {};
      const days = Array.isArray(it.days) ? it.days : [];
      const saved = it.travel_album || null;

      // On initialise une entrée par journée (titre repris du programme),
      // puis on fusionne ce qui a déjà été enregistré.
      const dayEntries = {};
      days.forEach((d, i) => {
        const s = saved?.days?.[i];
        dayEntries[i] = {
          title: s?.title ?? (d.day_title || d.location || `Jour ${i + 1}`),
          note: s?.note ?? '',
          photos: Array.isArray(s?.photos) ? s.photos : [],
        };
      });

      setTrip(data);
      setAlbum({
        title: saved?.title ?? (it.summary?.title || data.title || 'Mon album'),
        days: dayEntries,
      });
      setSavedOnce(!!saved);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  function setDayEntry(i, entry) {
    setAlbum((prev) => ({ ...prev, days: { ...prev.days, [i]: entry } }));
    setDirty(true);
  }

  async function addPhotos(i, files) {
    setBusyDay(i);
    setError(null);
    try {
      const uploaded = [];
      for (const f of files) {
        try {
          uploaded.push(await uploadAlbumPhoto(f));
        } catch (err) {
          throw new Error(
            "L'envoi d'une photo a échoué. Si cela persiste, l'espace de stockage des photos n'est peut-être pas encore activé."
          );
        }
      }
      setAlbum((prev) => {
        const entry = prev.days[i];
        const photos = [...entry.photos, ...uploaded.map((u) => ({ ...u, caption: '' }))];
        return { ...prev, days: { ...prev.days, [i]: { ...entry, photos } } };
      });
      setDirty(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDay(null);
    }
  }

  async function save() {
    if (!trip) return;
    setSaving(true);
    setError(null);
    try {
      const next = {
        ...trip.itinerary,
        travel_album: {
          title: album.title,
          days: album.days,
          updatedAt: new Date().toISOString(),
        },
      };
      const { data, error: e } = await updateItinerary(id, { itinerary: next });
      if (e) throw e;
      setTrip(data);
      setDirty(false);
      setSavedOnce(true);
    } catch (e) {
      setError(e.message || "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-500">
        Ouverture de l'album…
      </div>
    );
  }
  if (error && !album) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-600">Impossible d'ouvrir cet album.</p>
        <Link to="/mes-voyages" className="mt-3 inline-block text-brand-700 underline">
          ← Retour à mes voyages
        </Link>
      </div>
    );
  }

  const days = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link to={`/itineraire/${id}`} className="text-sm text-brand-700 underline">
          ← Retour au voyage
        </Link>
        <button
          onClick={save}
          disabled={saving || (!dirty && savedOnce)}
          className="rounded-lg bg-coral-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? 'Enregistrement…'
            : dirty || !savedOnce
              ? '💾 Enregistrer'
              : '✓ Enregistré'}
        </button>
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">
        Album de voyage
      </div>
      <input
        value={album.title}
        onChange={(e) => {
          setAlbum((prev) => ({ ...prev, title: e.target.value }));
          setDirty(true);
        }}
        placeholder="Titre de l'album"
        className="w-full border-0 border-b-2 border-slate-200 pb-2 text-2xl font-bold tracking-tight text-slate-900 outline-none focus:border-coral-400 sm:text-3xl"
      />

      <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Remplis ton album au fil du voyage : ajoute tes photos du jour, écris un
        petit mot et une légende sous chaque photo. Pense à appuyer sur «
        Enregistrer » de temps en temps — tu pourras revenir continuer plus tard.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-5">
        {days.map((d, i) => (
          <DayCard
            key={i}
            day={d}
            index={i}
            entry={album.days[i]}
            onChange={(entry) => setDayEntry(i, entry)}
            onAddPhotos={(files) => addPhotos(i, files)}
            busy={busyDay === i}
          />
        ))}
      </div>

      {days.length === 0 && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Ce voyage n'a pas encore de journées à illustrer.
        </p>
      )}
    </div>
  );
}
