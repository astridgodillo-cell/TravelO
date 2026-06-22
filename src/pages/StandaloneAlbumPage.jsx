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
import PdfPagesPreview from '../components/PdfPagesPreview';
import { DayCard, CoverPicker, ThemePicker, Spinner, CoversSection, FormatPicker } from './AlbumPage';
import { FORMAT_LABELS, normalizeBg, bakePhotoEffects, getTheme, unitLabel, splitPhotos, computeSplit, bgIsEmpty, autoBgFromPhotos, formatDateRange } from '../lib/albumModel';

const emptyDay = () => ({ title: '', note: '', photos: [], bg: null, split: null });

// Géocodage léger (OpenStreetMap) pour placer les étapes de la carte. Appelé
// seulement au moment de fabriquer le PDF, et en cache dans chaque étape.
// `country` (facultatif) fiabilise fortement la recherche (ex. « Ella » seul
// tombe ailleurs dans le monde ; « Ella, Sri Lanka » est correct).
async function geocode(name, country) {
  const q = country ? `${name}, ${country}` : name;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
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
  const [addProgress, setAddProgress] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const [format, setFormat] = useState('carre');
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);

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
        unit: c.unit ?? 'jour',
        coverLayout: c.coverLayout ?? {},
        endLayout: c.endLayout ?? {},
        coverSpread: c.coverSpread ?? {},
        opening: c.opening ?? { type: 'blank' },
        days: Array.isArray(c.days) && c.days.length ? c.days : [emptyDay()],
        map: c.map ?? { enabled: false, stops: [] },
      });
      if (c.format) setFormat(c.format);
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
  // Fusionne le jour i avec le précédent : on regroupe les photos, on garde le
  // titre du précédent et on conserve titre/texte du jour fusionné dans la
  // description. La mise en page (pages, décos, disposition libre) est remise à
  // zéro car le nombre de photos change.
  const mergeDayUp = (i) => {
    if (i <= 0) return;
    const a = album.days[i - 1];
    const b = album.days[i];
    const note = [a.note, b.title, b.note].map((s) => (s || '').trim()).filter(Boolean).join('\n');
    const merged = {
      ...a,
      photos: [...(a.photos || []), ...(b.photos || [])],
      note,
      split: null,
      pageDeco: {},
      freePages: {},
    };
    const days = album.days.filter((_, k) => k !== i);
    days[i - 1] = merged;
    patch({ days });
  };

  async function addPhotos(i, files) {
    setBusyDay(i);
    setAddProgress({ done: 0, total: files.length });
    setError(null);
    try {
      const uploaded = [];
      for (const f of files) {
        try {
          uploaded.push(await uploadAlbumPhoto(f));
          setAddProgress({ done: uploaded.length, total: files.length });
        } catch (err) {
          throw new Error("L'envoi d'une photo a échoué. Réessaie dans un instant.", { cause: err });
        }
      }
      setAlbum((prev) => {
        const days = [...prev.days];
        const entry = days[i];
        const photos = [...entry.photos, ...uploaded.map((u) => ({ ...u, caption: '' }))];
        // Par défaut : fond de chaque page = une photo du jour, au hasard et
        // toutes différentes (tant qu'aucun fond n'a été choisi).
        const pages = computeSplit(photos.length, entry.split).length;
        const bg = bgIsEmpty(entry.bg) ? autoBgFromPhotos(photos, pages) : entry.bg;
        days[i] = { ...entry, photos, bg };
        return { ...prev, days };
      });
      setDirty(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDay(null);
      setAddProgress(null);
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
      unit: a.unit || 'jour',
      format,
      coverLayout: a.coverLayout || {},
      endLayout: a.endLayout || {},
      coverSpread: a.coverSpread || {},
      opening: a.opening || { type: 'blank' },
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
      if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfBlob(null); }
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
          let coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : await geocode(s.name, album.map?.country);
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
      let openingForPdf = album.opening || { type: 'blank' };
      if (openingForPdf.type === 'random') {
        const all = album.days.flatMap((d) => d.photos || []).filter((p) => p.full || p.display);
        openingForPdf = { ...openingForPdf, photo: all.length ? all[Math.floor(Math.random() * all.length)] : null };
      }
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
          unit={album.unit}
          coverLayout={album.coverLayout}
          endLayout={album.endLayout}
          coverSpread={album.coverSpread}
          opening={openingForPdf}
        />
      ).toBlob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setPdfBlob(blob);
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

  // Numéro de page réel (1 = couverture) de la 1re page de chaque section, pour
  // l'indicateur « double page en vis‑à‑vis ».
  const hasMapPage = !!album.map?.enabled && (album.map.stops || []).some((s) => s.name?.trim());
  const dayPageCounts = album.days.map((s) => splitPhotos(s.photos, s.split).filter((c) => c.length > 0).length);
  // Avant les sections : 1re de couv + 2e de couv (blanche) + page d'ouverture.
  const BEFORE = 3;
  const dayOffsets = dayPageCounts.map(
    (_, i) => BEFORE + dayPageCounts.slice(0, i).reduce((a, b) => a + b, 0) + 1
  );
  const totalPages = BEFORE + dayPageCounts.reduce((a, b) => a + b, 0) + 2;

  return (
    <div>
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

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
       <div className="min-w-0">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">Album créé de zéro</div>
      <input
        value={album.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="Titre de l'album"
        className="w-full border-0 border-b-2 border-slate-200 pb-2 text-2xl font-bold tracking-tight text-slate-900 outline-none focus:border-coral-400 sm:text-3xl"
      />

      <div className="mt-4">
        <FormatPicker value={format} onChange={(f) => { setFormat(f); setDirty(true); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfBlob(null); } }} />
      </div>

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

      {/* Unité des sections : journées ou étapes */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Organiser par&nbsp;:</span>
        {[['jour', 'Jours'], ['etape', 'Étapes']].map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => patch({ unit: k })}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${(album.unit || 'jour') === k ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {lbl}
          </button>
        ))}
        <span className="text-xs text-slate-500">Pratique pour regrouper plusieurs journées d'une même étape.</span>
      </div>

      {/* Couvertures (1re + 4e côte à côte) + page d'ouverture */}
      <CoversSection
        album={album}
        format={format}
        theme={getTheme(album.theme)}
        dates={formatDateRange(album.dateStart, album.dateEnd)}
        hasMap={hasMapPage}
        onPatch={(p) => patch(p)}
        onPick={(target) => setPickerFor({ kind: target })}
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
            <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => moveDay(i, -1)} disabled={i === 0}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Monter">↑</button>
              <button type="button" onClick={() => moveDay(i, 1)} disabled={i === album.days.length - 1}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Descendre">↓</button>
              <button
                type="button"
                onClick={() => {
                  const w = unitLabel(album.unit).toLowerCase();
                  if (window.confirm(`Fusionner cette ${w} avec ${w === 'étape' ? "l'étape" : 'le jour'} ${i} ? Toutes les photos seront regroupées.`)) mergeDayUp(i);
                }}
                disabled={i === 0}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                title="Regrouper les photos de cette section avec la précédente"
              >
                ⤵ Fusionner avec {unitLabel(album.unit).toLowerCase() === 'étape' ? "l'étape" : 'le jour'} précédent{unitLabel(album.unit).toLowerCase() === 'étape' ? 'e' : ''}
              </button>
              <button type="button" onClick={() => removeDay(i)}
                className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50">Supprimer ce jour</button>
            </div>
            <DayCard
              day={{ location: '' }}
              index={i}
              entry={d}
              onChange={(entry) => updateDay(i, entry)}
              onAddPhotos={(files) => addPhotos(i, files)}
              progress={busyDay === i ? addProgress : null}
              onPickBgPhoto={(slot) => setPickerFor({ kind: 'dayBg', i, slot })}
              busy={busyDay === i}
              format={format}
              onFormatChange={setFormat}
              theme={getTheme(album.theme)}
              unit={album.unit}
              pageOffset={dayOffsets[i]}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={addDay}
        className="mt-4 w-full rounded-xl border-2 border-dashed border-coral-300 bg-coral-50 px-3 py-3 text-sm font-semibold text-coral-700 hover:bg-coral-100">
        ➕ Ajouter {(album.unit || 'jour') === 'etape' ? 'une étape' : 'un jour'} / une page
      </button>

      {/* Carte */}
      <MapSection map={album.map} onChange={(map) => patch({ map })} />
       </div>

       {/* Colonne de droite (fixe sur ordinateur) : aperçu + impression */}
       <aside className="mt-8 lg:mt-0 lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Aperçu &amp; impression</h2>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">v12</span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-700">
            📖 {totalPages} pages au total (couvertures et carte comprises).
          </p>
          <p className="mt-1 text-xs text-slate-500">Format : <span className="font-semibold text-slate-700">{FORMAT_LABELS[format]}</span> (modifiable à gauche).</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={generatePdf} disabled={generating || photoCount === 0}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60">
              {generating && <Spinner />}
              {generating ? 'Création du fichier…' : pdfUrl ? '🔄 Refaire le fichier' : '📄 Créer le fichier à imprimer'}
            </button>
            {pdfUrl && (
              <a href={pdfUrl} download={fileName} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm">⬇️ Télécharger</a>
            )}
            {photoCount === 0 && <span className="text-xs text-slate-500">Ajoute au moins une photo.</span>}
          </div>
          {pdfBlob ? (
            <div className="mt-4">
              <p className="mb-2 text-xs text-slate-500">Aperçu — c'est exactement ce qui sera imprimé.</p>
              <div className="max-h-[70vh] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3 lg:max-h-[calc(100dvh-19rem)]">
                <PdfPagesPreview blob={pdfBlob} />
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
              Clique sur « Créer le fichier » pour voir l'aperçu de toutes les pages ici.
            </p>
          )}
        </section>
       </aside>
      </div>

      {pickerFor && (() => {
        const kind = pickerFor.kind;
        let title = 'Choisir la photo de couverture';
        let current = album.cover;
        if (kind === 'end') { title = 'Choisir la photo de la 4e de couverture'; current = album.endPhoto; }
        else if (kind === 'spread') { title = 'Photo étendue sur les deux couvertures'; current = album.coverSpread?.photo; }
        else if (kind === 'opening') { title = "Photo de la page d'ouverture"; current = album.opening?.photo; }
        else if (kind === 'dayBg') {
          const bg = normalizeBg(album.days[pickerFor.i]?.bg);
          title = `Fond · ${unitLabel(album.unit)} ${pickerFor.i + 1}`;
          current = pickerFor.slot === 'spread' ? bg.spread?.photo : bg.pages?.[pickerFor.slot]?.photo;
        }
        return (
          <CoverPicker
            title={title}
            unit={album.unit}
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
              } else if (kind === 'spread') {
                patch({ coverSpread: { ...(album.coverSpread || {}), photo } });
              } else if (kind === 'opening') {
                patch({ opening: { ...(album.opening || { type: 'photo' }), photo } });
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
// Carte optionnelle : liste de villes/étapes (réordonnables par glisser-
// déposer). Les coordonnées sont trouvées automatiquement à la fabrication.
function MapSection({ map, onChange }) {
  const enabled = !!map?.enabled;
  const stops = map?.stops || [];
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const setStops = (s) => onChange({ ...map, stops: s, enabled });
  const setCountry = (country) => onChange({ ...map, country, enabled, stops });
  // Oublie les coordonnées mémorisées → la carte les recalcule (utile après
  // avoir renseigné/corrigé le pays).
  const recomputePositions = () => setStops(stops.map((s) => ({ name: s.name })));

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
            Liste les villes/étapes, dans l'ordre. Utilise les flèches ▲▼ (ou glisse la poignée ⠿ sur ordinateur) pour les réordonner. La carte se dessine toute seule.
          </p>

          {/* Pays : fiabilise le placement des villes (ex. plusieurs « Ella »
              dans le monde). */}
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex-1 text-xs font-medium text-slate-600">
              Pays du voyage (recommandé)
              <input
                value={map?.country || ''}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Ex : Sri Lanka"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button type="button" onClick={recomputePositions}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Oublie les positions mémorisées et les recalcule à la prochaine création du fichier">
              ↻ Recalculer les positions
            </button>
            <p className="w-full text-[11px] text-slate-500">
              Renseigne le pays pour que les villes soient bien placées, puis « ↻ Recalculer » et refais le fichier.
            </p>
          </div>

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
                <div className="flex shrink-0 flex-col">
                  <button type="button" onClick={() => moveStop(i, i - 1)} disabled={i === 0}
                    className="flex h-5 w-6 items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-25" title="Monter">▲</button>
                  <button type="button" onClick={() => moveStop(i, i + 1)} disabled={i === stops.length - 1}
                    className="flex h-5 w-6 items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-25" title="Descendre">▼</button>
                </div>
                <span
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  className="hidden cursor-grab select-none px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing sm:block"
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
