import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import {
  getAlbum,
  updateAlbum,
  uploadAlbumPhoto,
  repairAlbumPhoto,
} from '../lib/supabase';
import { renderRouteMapImage } from '../lib/staticMapImage';
import AlbumPdfDoc from '../components/AlbumPdfDoc';
import { DayCard, CoverPicker, ThemePicker } from './AlbumPage';
import { FORMAT_LABELS, normalizeBg, bakePhotoEffects, getTheme } from '../lib/albumModel';

const emptyDay = () => ({ title: '', note: '', photos: [], bg: null, split: null });

// Géocodage léger (OpenStreetMap) pour placer les étapes de la carte. Appelé
// seulement au moment de fabriquer le PDF, et en cache dans chaque étape.
async function geocode(name) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`,
      { headers: { Accept: 'application/json' } }
    );
    const j = await r.json();
    if (j && j[0]) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  } catch {
    /* hors-ligne ou bloqué : on ignore */
  }
  return null;
}

export default function StandaloneAlbumPage() {
  const { id } = useParams();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [busyDay, setBusyDay] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const [format, setFormat] = useState('carre');
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const [pickerFor, setPickerFor] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState(null);

  useEffect(() => {
    let active = true;
    getAlbum(id).then(({ data, error: e }) => {
      if (!active) return;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      const c = data?.content || {};
      setAlbum({
        title: c.title ?? data?.title ?? 'Mon album',
        dateStart: c.dateStart ?? '',
        dateEnd: c.dateEnd ?? '',
        cover: c.cover ?? null,
        endNote: c.endNote ?? '',
        endPhoto: c.endPhoto ?? null,
        theme: c.theme ?? 'classique',
        days: Array.isArray(c.days) && c.days.length ? c.days : [emptyDay()],
        map: c.map ?? { enabled: false, stops: [] },
      });
      setSavedOnce(!!data?.content?.days);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const patch = (p) => {
    setAlbum((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };
  const updateDay = (i, entry) => {
    setAlbum((prev) => {
      const days = [...prev.days];
      days[i] = entry;
      return { ...prev, days };
    });
    setDirty(true);
  };
  const addDay = () => patch({ days: [...album.days, emptyDay()] });
  const removeDay = (i) => patch({ days: album.days.filter((_, k) => k !== i) });
  const moveDay = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= album.days.length) return;
    const days = [...album.days];
    [days[i], days[j]] = [days[j], days[i]];
    patch({ days });
  };

  async function addPhotos(i, files) {
    setBusyDay(i);
    setError(null);
    try {
      const uploaded = [];
      for (const f of files) {
        try {
          uploaded.push(await uploadAlbumPhoto(f));
        } catch (err) {
          throw new Error("L'envoi d'une photo a échoué. Réessaie dans un instant.", { cause: err });
        }
      }
      setAlbum((prev) => {
        const days = [...prev.days];
        days[i] = { ...days[i], photos: [...days[i].photos, ...uploaded.map((u) => ({ ...u, caption: '' }))] };
        return { ...prev, days };
      });
      setDirty(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDay(null);
    }
  }

  function contentToSave(a = album) {
    return {
      title: a.title,
      dateStart: a.dateStart,
      dateEnd: a.dateEnd,
      cover: a.cover || null,
      endNote: a.endNote || '',
      endPhoto: a.endPhoto || null,
      theme: a.theme || 'classique',
      days: a.days,
      map: a.map || { enabled: false, stops: [] },
    };
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { error: e } = await updateAlbum(id, { title: album.title, content: contentToSave() });
      if (e) throw e;
      setDirty(false);
      setSavedOnce(true);
    } catch (e) {
      setError(e.message || "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const photoCount = album
    ? album.days.reduce((n, d) => n + (d.photos?.length || 0), 0)
    : 0;

  async function repairPhotos() {
    if (!album) return;
    setRepairing(true);
    setError(null);
    setRepairMsg('Vérification des photos…');
    try {
      const days = [];
      for (const d of album.days) {
        const photos = [];
        for (const p of d.photos || []) photos.push(await repairAlbumPhoto(p));
        let bg = d.bg;
        if (bg) {
          bg = { ...bg };
          if (bg.spread?.photo) bg.spread = { ...bg.spread, photo: await repairAlbumPhoto(bg.spread.photo) };
          if (Array.isArray(bg.pages)) {
            const pages = [];
            for (const sp of bg.pages) pages.push(sp?.photo ? { ...sp, photo: await repairAlbumPhoto(sp.photo) } : sp);
            bg.pages = pages;
          }
        }
        days.push({ ...d, photos, bg });
      }
      const cover = album.cover ? await repairAlbumPhoto(album.cover) : null;
      const endPhoto = album.endPhoto ? await repairAlbumPhoto(album.endPhoto) : null;
      const next = { ...album, days, cover, endPhoto };
      setAlbum(next);
      const { error: e } = await updateAlbum(id, { title: next.title, content: contentToSave(next) });
      if (e) throw e;
      setDirty(false);
      setSavedOnce(true);
      setRepairMsg('✓ Photos vérifiées et remises à l’endroit.');
      if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    } catch (e) {
      setRepairMsg(null);
      setError(e.message || 'La réparation a échoué.');
    } finally {
      setRepairing(false);
    }
  }

  async function generatePdf() {
    if (!album) return;
    setGenerating(true);
    setError(null);
    try {
      // Carte : on géocode les étapes qui n'ont pas encore de coordonnées.
      let routeMap = null;
      const stops = [];
      if (album.map?.enabled) {
        const points = [];
        const updatedStops = [];
        for (const s of album.map.stops || []) {
          if (!s.name?.trim()) continue;
          let coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : await geocode(s.name);
          updatedStops.push({ ...s, ...(coords || {}) });
          if (coords) {
            points.push(coords);
            stops.push(s.name);
          }
        }
        // On mémorise les coordonnées trouvées pour ne pas re-géocoder.
        setAlbum((prev) => ({ ...prev, map: { ...prev.map, stops: updatedStops } }));
        if (points.length) {
          const mapDims =
            format === 'a4paysage' ? { width: 1600, height: 1000 }
              : format === 'a4portrait' ? { width: 1100, height: 1500 }
                : { width: 1400, height: 1320 };
          try {
            routeMap = await renderRouteMapImage(points, { ...mapDims, accent: '#C8643C' });
          } catch { routeMap = null; }
        }
      }

      const days = album.days.map((d) => ({ location: '', day_title: d.title }));
      // « Cuisson » des filtres couleur dans les photos.
      const bakedDays = [];
      for (const d of album.days) bakedDays.push({ ...d, photos: await bakePhotoEffects(d.photos) });
      const albumForPdf = { ...album, days: bakedDays };
      const blob = await pdf(
        <AlbumPdfDoc
          album={albumForPdf}
          days={days}
          format={format}
          summary={{ start_date: album.dateStart, end_date: album.dateEnd }}
          routeMap={routeMap}
          stops={stops}
          endNote={album.endNote}
          endPhoto={album.endPhoto}
          theme={getTheme(album.theme)}
        />
      ).toBlob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || 'Erreur pendant la création du fichier.');
    } finally {
      setGenerating(false);
    }
  }

  const fileName = `album-${(album?.title || 'album').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${format}.pdf`;

  if (loading) {
    return <div className="mx-auto max-w-3xl p-8 text-center text-slate-500">Ouverture de l'album…</div>;
  }
  if (error && !album) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-600">Impossible d'ouvrir cet album.</p>
        <Link to="/albums" className="mt-3 inline-block text-brand-700 underline">← Mes albums</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link to="/albums" className="text-sm text-brand-700 underline">← Mes albums</Link>
        <button
          onClick={save}
          disabled={saving || (!dirty && savedOnce)}
          className="rounded-lg bg-coral-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : dirty || !savedOnce ? '💾 Enregistrer' : '✓ Enregistré'}
        </button>
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">Album créé de zéro</div>
      <input
        value={album.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="Titre de l'album"
        className="w-full border-0 border-b-2 border-slate-200 pb-2 text-2xl font-bold tracking-tight text-slate-900 outline-none focus:border-coral-400 sm:text-3xl"
      />

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="text-sm text-slate-600">
          Du{' '}
          <input type="date" value={album.dateStart} onChange={(e) => patch({ dateStart: e.target.value })}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-sm text-slate-600">
          au{' '}
          <input type="date" value={album.dateEnd} onChange={(e) => patch({ dateEnd: e.target.value })}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
      </div>

      <ThemePicker value={album.theme || 'classique'} onChange={(t) => patch({ theme: t })} />

      {/* Couverture */}
      <CoverThumb
        label="Photo de couverture"
        photo={album.cover}
        onChoose={() => setPickerFor({ kind: 'cover' })}
        onClear={album.cover ? () => patch({ cover: null }) : null}
        emptyText="Sans photo : la 1re photo de l'album est utilisée."
      />

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {photoCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <button type="button" onClick={repairPhotos} disabled={repairing}
            className="rounded-lg border border-amber-500 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
            {repairing ? 'Réparation…' : '🛠️ Réparer l’orientation des photos'}
          </button>
          <span className="text-xs text-amber-700">{repairMsg || 'À utiliser si des photos apparaissent couchées.'}</span>
        </div>
      )}

      {/* Jours / pages */}
      <div className="mt-5 space-y-5">
        {album.days.map((d, i) => (
          <div key={i}>
            <div className="mb-1 flex items-center justify-end gap-2">
              <button type="button" onClick={() => moveDay(i, -1)} disabled={i === 0}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Monter">↑</button>
              <button type="button" onClick={() => moveDay(i, 1)} disabled={i === album.days.length - 1}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Descendre">↓</button>
              <button type="button" onClick={() => removeDay(i)}
                className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50">Supprimer ce jour</button>
            </div>
            <DayCard
              day={{ location: '' }}
              index={i}
              entry={d}
              onChange={(entry) => updateDay(i, entry)}
              onAddPhotos={(files) => addPhotos(i, files)}
              onPickBgPhoto={(slot) => setPickerFor({ kind: 'dayBg', i, slot })}
              busy={busyDay === i}
              format={format}
              theme={getTheme(album.theme)}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={addDay}
        className="mt-4 w-full rounded-xl border-2 border-dashed border-coral-300 bg-coral-50 px-3 py-3 text-sm font-semibold text-coral-700 hover:bg-coral-100">
        ➕ Ajouter un jour / une page
      </button>

      {/* Carte */}
      <MapSection map={album.map} onChange={(map) => patch({ map })} />

      {/* Page de fin */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-slate-900">Page de fin</h2>
        <textarea
          value={album.endNote}
          onChange={(e) => patch({ endNote: e.target.value })}
          rows={3}
          placeholder="Ton mot de fin (par défaut : une citation)"
          className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-coral-400"
        />
        <CoverThumb
          label="Photo de fond (facultative)"
          photo={album.endPhoto}
          onChoose={() => setPickerFor({ kind: 'end' })}
          onClear={album.endPhoto ? () => patch({ endPhoto: null }) : null}
          emptyText="Sans photo : fond sombre uni."
        />
      </section>

      {/* Export */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Préparer l'album pour l'impression</h2>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">mise en page v12</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {Object.entries(FORMAT_LABELS).map(([key, label]) => (
            <button key={key} type="button"
              onClick={() => { setFormat(key); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); } }}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${format === key ? 'border-coral-400 bg-coral-50 text-coral-700 ring-2 ring-coral-200' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={generatePdf} disabled={generating || photoCount === 0}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-50">
            {generating ? 'Création du fichier…' : pdfUrl ? '🔄 Refaire le fichier' : '📄 Créer le fichier à imprimer'}
          </button>
          {pdfUrl && (
            <a href={pdfUrl} download={fileName} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm">⬇️ Télécharger</a>
          )}
          {photoCount === 0 && <span className="text-xs text-slate-500">Ajoute au moins une photo.</span>}
        </div>
        {pdfUrl && <iframe title="Aperçu de l'album" src={pdfUrl} className="mt-4 h-[70vh] w-full rounded-xl border border-slate-200" />}
      </section>

      {pickerFor && (() => {
        const kind = pickerFor.kind;
        let title = 'Choisir la photo de couverture';
        let current = album.cover;
        if (kind === 'end') { title = 'Choisir la photo de fond'; current = album.endPhoto; }
        else if (kind === 'dayBg') {
          const bg = normalizeBg(album.days[pickerFor.i]?.bg);
          title = `Fond · Jour ${pickerFor.i + 1}`;
          current = pickerFor.slot === 'spread' ? bg.spread?.photo : bg.pages?.[pickerFor.slot]?.photo;
        }
        return (
          <CoverPicker
            title={title}
            days={album.days}
            album={album}
            current={current}
            onPick={(photo) => {
              if (kind === 'dayBg') {
                const { i, slot } = pickerFor;
                setAlbum((prev) => {
                  const days = [...prev.days];
                  const bg = normalizeBg(days[i].bg);
                  if (slot === 'spread') bg.spread = { type: 'photo', photo, toned: bg.spread?.toned !== false };
                  else {
                    const pages = [...(bg.pages || [])];
                    while (pages.length <= slot) pages.push({ type: 'none' });
                    pages[slot] = { type: 'photo', photo, toned: pages[slot]?.toned !== false };
                    bg.pages = pages;
                  }
                  days[i] = { ...days[i], bg: { ...bg } };
                  return { ...prev, days };
                });
              } else {
                patch(kind === 'end' ? { endPhoto: photo } : { cover: photo });
              }
              setDirty(true);
              setPickerFor(null);
            }}
            onClose={() => setPickerFor(null)}
          />
        );
      })()}
    </div>
  );
}

// Vignette + boutons pour une photo (couverture / fond de fin).
function CoverThumb({ label, photo, onChoose, onClear, emptyText }) {
  return (
    <div className="mt-4 flex items-center gap-4">
      <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {photo ? (
          <img src={photo.display || photo.full} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">{emptyText}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onChoose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">🖼️ Choisir</button>
          {onClear && (
            <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">Enlever</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Carte optionnelle : liste de villes/étapes (réordonnables par glisser-
// déposer). Les coordonnées sont trouvées automatiquement à la fabrication.
function MapSection({ map, onChange }) {
  const enabled = !!map?.enabled;
  const stops = map?.stops || [];
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const setStops = (s) => onChange({ ...map, stops: s, enabled });

  const moveStop = (from, to) => {
    if (from == null || to == null || from === to) return;
    const next = [...stops];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setStops(next);
  };

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <label className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ ...map, enabled: e.target.checked, stops })} />
        Ajouter une page « carte du voyage »
      </label>
      {enabled && (
        <div className="mt-3">
          <p className="text-sm text-slate-600">
            Liste les villes/étapes, dans l'ordre. Glisse la poignée ⠿ pour les réordonner. La carte se dessine toute seule.
          </p>
          <div className="mt-2 space-y-2">
            {stops.map((s, i) => (
              <div
                key={i}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  moveStop(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`flex items-center gap-2 rounded-lg ${
                  overIndex === i && dragIndex !== null ? 'ring-2 ring-coral-300' : ''
                } ${dragIndex === i ? 'opacity-50' : ''}`}
              >
                <span
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  className="cursor-grab select-none px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                  title="Glisser pour déplacer"
                >
                  ⠿
                </span>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-coral-500 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <input
                  value={s.name || ''}
                  onChange={(e) => {
                    const next = [...stops];
                    next[i] = { name: e.target.value }; // on oublie d'anciennes coords si le nom change
                    setStops(next);
                  }}
                  placeholder="Ex : Paris"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => setStops(stops.filter((_, k) => k !== i))}
                  className="text-slate-400 hover:text-red-600" title="Retirer">✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setStops([...stops, { name: '' }])}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            ➕ Ajouter une étape
          </button>
        </div>
      )}
    </section>
  );
}
