import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTileUrl } from '../lib/mapTiles';
import {
  getAlbum,
  updateAlbum,
  uploadAlbumPhoto,
  repairAlbumPhoto,
} from '../lib/supabase';
import { renderRouteMapImage } from '../lib/staticMapImage';
import AlbumPdfDoc from '../components/AlbumPdfDoc';
import PdfPagesPreview from '../components/PdfPagesPreview';
import { pdfBlobToImageFiles } from '../lib/pdfToImages';
import { DayCard, CoverPicker, ThemePicker, Spinner, CoversSection, FormatPicker, ShareSheet } from './AlbumPage';
import { FORMAT_LABELS, normalizeBg, bakePhotoEffects, getTheme, unitLabel, splitPhotos, computeSplit, bgIsEmpty, autoBgFromPhotos, formatDateRange, MAP_TRANSPORTS, addPhotosToEntry } from '../lib/albumModel';

const emptyDay = () => ({ title: '', note: '', photos: [], bg: null, split: null });

// Géocodage léger (OpenStreetMap) pour placer les étapes de la carte. Appelé
// seulement au moment de fabriquer le PDF, et en cache dans chaque étape.
// `country` (facultatif) fiabilise fortement la recherche (ex. « Ella » seul
// tombe ailleurs dans le monde ; « Ella, Sri Lanka » est correct).
async function geocodeOnce(q) {
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

async function geocode(name, country) {
  const n = (name || '').trim();
  if (!n) return null;
  // 1) avec le pays/la région si fourni ; 2) sinon (ou si rien trouvé,
  // ex. « Sardaigne » qui est une région mal comprise), le nom seul.
  if (country && country.trim()) {
    const withCountry = await geocodeOnce(`${n}, ${country.trim()}`);
    if (withCountry) return withCountry;
  }
  return geocodeOnce(n);
}

export default function StandaloneAlbumPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Retour : on revient à la page PRÉCÉDENTE (d'où l'on venait), et seulement
  // à défaut d'historique (album ouvert directement) vers « Mes albums ».
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/albums');
  };
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
  const [sharingAll, setSharingAll] = useState(false);
  const [sharingAllPdf, setSharingAllPdf] = useState(false);
  const [albumShareData, setAlbumShareData] = useState(null); // { files, text } prêts

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

  async function addPhotos(i, files, targetPage = null) {
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
        const added = uploaded.map((u) => ({ ...u, caption: '' }));
        // Mode manuel : sur la page demandée (📷+) ou sur une nouvelle page —
        // les pages existantes gardent exactement leurs photos. Mode auto :
        // simple ajout, la répartition se refait toute seule.
        const placed = addPhotosToEntry(entry, added, typeof targetPage === 'number' ? targetPage : null);
        // Par défaut : fond de chaque page = une photo du jour, au hasard et
        // toutes différentes (tant qu'aucun fond n'a été choisi). Les pages
        // verrouillées gardent leur fond tel quel.
        const pages = computeSplit(placed.photos.length, placed.split).length;
        let bg = entry.bg;
        if (bgIsEmpty(entry.bg)) {
          const auto = autoBgFromPhotos(placed.photos, pages);
          const lp = entry.lockedPages || {};
          const cur = normalizeBg(entry.bg);
          auto.pages = auto.pages.map((s, k) => (lp[k] ? (cur.pages?.[k] || { type: 'none' }) : s));
          bg = auto;
        }
        days[i] = { ...entry, ...placed, bg };
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

  // Fabrique le PDF complet de l'album et renvoie le fichier. Réutilisé par
  // l'aperçu/téléchargement ET le partage.
  async function buildAlbumBlob() {
    // Carte : on géocode les étapes qui n'ont pas encore de coordonnées.
    let routeMap = null;
    const stops = [];
    if (album.map?.enabled) {
      const points = [];
      const placedTransports = []; // transport au départ de chaque étape placée
      const updatedStops = [];
      for (const s of album.map.stops || []) {
        if (!s.name?.trim()) continue;
        // Le pays de l'étape (voyages multi-pays) prime sur le pays principal.
        let coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : await geocode(s.name, s.country || album.map?.country);
        updatedStops.push({ ...s, ...(coords || {}) });
        if (coords) {
          points.push(coords);
          placedTransports.push(s.transport || null);
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
          routeMap = await renderRouteMapImage(points, {
            ...mapDims,
            accent: '#C8643C',
            // trajets étape i → i+1 : le transport mémorisé sur l'étape de départ
            transports: placedTransports.slice(0, -1),
          });
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
    return pdf(
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
  }

  const albumHasContent = () =>
    (album?.days || []).some((e) => (e.photos?.length || 0) > 0 || (e.note || '').trim());
  const albumSlug = () =>
    (album?.title || 'album').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'album';

  // Ces fonctions PRÉPARENT les fichiers et renvoient { files, text }. Le
  // partage natif est déclenché ensuite par un nouveau clic (ShareSheet), sinon
  // le mobile refuse d'ouvrir WhatsApp après la longue fabrication.

  // Prépare le partage d'UNE journée en images (une par page).
  async function shareDay(dayIndex) {
    if (!album) return null;
    const entry = album.days[dayIndex];
    if (!entry || !(entry.photos?.length || (entry.note || '').trim())) {
      alert('Ajoute au moins une photo (ou un texte) à cette journée avant de la partager.');
      return null;
    }
    const bakedPhotos = await bakePhotoEffects(entry.photos || []);
    const albumForPdf = {
      ...album,
      days: album.days.map((d, i) => (i === dayIndex ? { ...entry, photos: bakedPhotos } : d)),
    };
    const blob = await pdf(
      <AlbumPdfDoc
        album={albumForPdf}
        days={album.days.map((d) => ({ location: '', day_title: d.title }))}
        format={format}
        unit={album.unit}
        theme={getTheme(album.theme)}
        onlyDay={dayIndex}
      />
    ).toBlob();
    const label = album.unit === 'etape' ? 'etape' : 'jour';
    const files = await pdfBlobToImageFiles(blob, { baseName: `${label}-${dayIndex + 1}` });
    const unitLbl = album.unit === 'etape' ? 'Étape' : 'Jour';
    return { files, text: `${unitLbl} ${dayIndex + 1} — ${album.title || 'Mon voyage'}` };
  }

  // Prépare le partage de TOUT l'album en images (une par page).
  async function shareAlbum() {
    if (!album) return null;
    if (!albumHasContent()) {
      alert('Ajoute au moins une photo à ton album avant de le partager.');
      return null;
    }
    const blob = await buildAlbumBlob();
    const files = await pdfBlobToImageFiles(blob, { baseName: albumSlug(), targetWidth: 1240 });
    return { files, text: `${album.title || 'Mon voyage'} — album TravelO` };
  }

  // Prépare le partage de TOUT l'album en UN SEUL fichier PDF.
  async function shareAlbumPdf() {
    if (!album) return null;
    if (!albumHasContent()) {
      alert('Ajoute au moins une photo à ton album avant de le partager.');
      return null;
    }
    const blob = await buildAlbumBlob();
    const file = new File([blob], `${albumSlug()}-${format}.pdf`, { type: 'application/pdf' });
    return { files: [file], text: `${album.title || 'Mon voyage'} — album TravelO` };
  }

  async function generatePdf() {
    if (!album) return;
    setGenerating(true);
    setError(null);
    try {
      const blob = await buildAlbumBlob();
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
    <div className="mx-auto max-w-5xl">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <button type="button" onClick={goBack} className="text-sm text-brand-700 underline">← Retour</button>
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
              onAddPhotos={(files, target) => addPhotos(i, files, target)}
              progress={busyDay === i ? addProgress : null}
              onPickBgPhoto={(slot) => setPickerFor({ kind: 'dayBg', i, slot })}
              busy={busyDay === i}
              format={format}
              onFormatChange={setFormat}
              theme={getTheme(album.theme)}
              unit={album.unit}
              pageOffset={dayOffsets[i]}
              onShareDay={() => shareDay(i)}
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

      {/* Export */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Préparer l'album pour l'impression</h2>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">mise en page v12</span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-700">
          📖 {totalPages} pages au total (couverture, carte éventuelle et page de fin comprises).
        </p>
        <p className="mt-2 text-xs text-slate-500">Format : <span className="font-semibold text-slate-700">{FORMAT_LABELS[format]}</span> (modifiable tout en haut de la page).</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={generatePdf} disabled={generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60">
            {generating && <Spinner />}
            {generating ? 'Création du fichier…' : pdfUrl ? '🔄 Refaire le fichier' : '📄 Créer le fichier à imprimer'}
          </button>
          {pdfUrl && (
            <a href={pdfUrl} download={fileName} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm">⬇️ Télécharger</a>
          )}
          <button
            onClick={async () => {
              if (sharingAll) return;
              setSharingAll(true);
              try { const r = await shareAlbum(); if (r && r.files?.length) setAlbumShareData(r); }
              catch (e) { setError((e?.message || 'Le partage a échoué.') + ' Réessaie dans un instant.'); }
              finally { setSharingAll(false); }
            }}
            disabled={sharingAll || generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Partager tout l'album en images (WhatsApp, Messages…)"
          >
            {sharingAll ? <Spinner /> : <span>📲</span>}
            {sharingAll ? 'Préparation…' : 'Partager en images'}
          </button>
          <button
            onClick={async () => {
              if (sharingAllPdf) return;
              setSharingAllPdf(true);
              try { const r = await shareAlbumPdf(); if (r && r.files?.length) setAlbumShareData(r); }
              catch (e) { setError((e?.message || 'Le partage a échoué.') + ' Réessaie dans un instant.'); }
              finally { setSharingAllPdf(false); }
            }}
            disabled={sharingAllPdf || generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Partager tout l'album en un seul fichier PDF"
          >
            {sharingAllPdf ? <Spinner /> : <span>📄</span>}
            {sharingAllPdf ? 'Préparation…' : 'Partager en 1 PDF'}
          </button>
          {photoCount === 0 && <span className="text-xs text-slate-500">Ajoute au moins une photo.</span>}
        </div>
        {pdfBlob && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-slate-500">Aperçu (fais défiler) — c'est exactement ce qui sera imprimé.</p>
            <div className="max-h-[75vh] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3">
              <PdfPagesPreview blob={pdfBlob} />
            </div>
          </div>
        )}
      </section>

      {albumShareData && (
        <ShareSheet files={albumShareData.files} text={albumShareData.text} onClose={() => setAlbumShareData(null)} />
      )}

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
// ---- Placement MANUEL d'une étape sur la carte ----
// Carte interactive plein écran : on se déplace / zoome (pincement à deux
// doigts), puis on TOUCHE l'endroit exact. Utile quand la recherche
// automatique ne trouve pas un lieu (hameau, plage, point de vue…).

function PickerClicks({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// Cadre la carte à l'ouverture : sur l'étape si déjà placée, sinon sur les
// autres étapes du voyage, sinon vue large (Europe).
function PickerFit({ points, target }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize();
      if (target) map.setView([target.lat, target.lng], 10);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
      else if (points.length === 1) map.setView([points[0].lat, points[0].lng], 7);
      else map.setView([46.6, 2.4], 4);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const pickerPin = () => L.divIcon({
  className: 'travelo-pick-pin',
  html: `<div style="background:#C8643C;color:#fff;border-radius:50%;width:34px;height:34px;display:grid;place-items:center;font-size:16px;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.4);">📍</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const pickerDot = (n) => L.divIcon({
  className: 'travelo-pick-dot',
  html: `<div style="background:rgba(100,116,139,0.9);color:#fff;border-radius:50%;width:20px;height:20px;display:grid;place-items:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${n}</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function StopPositionPicker({ stop, stopIndex, allStops, onSave, onClose }) {
  const [pos, setPos] = useState(stop.lat && stop.lng ? { lat: stop.lat, lng: stop.lng } : null);
  const others = allStops
    .map((s, i) => ({ ...s, i }))
    .filter((s, i) => i !== stopIndex && s.lat && s.lng);
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-800">📍 Placer « {stop.name || `étape ${stopIndex + 1}`} »</h3>
          <p className="text-[11px] text-slate-500">Zoome (deux doigts ou molette), déplace la carte, puis touche l'endroit exact.</p>
        </div>
        <button onClick={onClose} className="-m-2 shrink-0 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
      </div>
      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={[46.6, 2.4]}
          zoom={4}
          scrollWheelZoom
          touchZoom
          dragging
          doubleClickZoom
          zoomControl
          attributionControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <PickerFit points={others} target={pos} />
          <TileLayer url={getTileUrl()} />
          <PickerClicks onPick={setPos} />
          {/* autres étapes déjà placées : petits repères numérotés (contexte) */}
          {others.map((s) => (
            <Marker key={s.i} position={[s.lat, s.lng]} icon={pickerDot(s.i + 1)} interactive={false} />
          ))}
          {/* position choisie : gros repère, déplaçable au doigt */}
          {pos && (
            <Marker
              position={[pos.lat, pos.lng]}
              icon={pickerPin()}
              draggable
              eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); setPos({ lat: ll.lat, lng: ll.lng }); } }}
              zIndexOffset={1000}
            />
          )}
        </MapContainer>
        {!pos && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center">
            <span className="rounded-full bg-slate-900/80 px-4 py-1.5 text-xs font-medium text-white">👆 Touche la carte pour poser le repère</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={onClose}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Annuler</button>
        <button type="button" disabled={!pos} onClick={() => { onSave(pos); onClose(); }}
          className="rounded-lg bg-coral-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">✅ Utiliser cet endroit</button>
      </div>
    </div>
  );
}

function MapSection({ map, onChange }) {
  const enabled = !!map?.enabled;
  const stops = map?.stops || [];
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  // Aperçu de la carte en direct : image redessinée automatiquement quelques
  // instants après chaque changement (étapes, pays, transports).
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [unplaced, setUnplaced] = useState([]); // noms d'étapes non placées
  const [retryNonce, setRetryNonce] = useState(0);
  const [pickIdx, setPickIdx] = useState(null); // étape en cours de placement manuel
  const previewSeq = useRef(0);
  const setStops = (s) => onChange({ ...map, stops: s, enabled });
  const setCountry = (country) => onChange({ ...map, country, enabled, stops });
  // Oublie les coordonnées mémorisées → la carte les recalcule (utile après
  // avoir renseigné/corrigé le pays). On garde pays/transport de chaque étape.
  const recomputePositions = () => setStops(stops.map((s) => ({ name: s.name, country: s.country, transport: s.transport })));
  // Transport du trajet étape i → étape i+1 (mémorisé sur l'étape de départ).
  const setStopTransport = (i, transport) => {
    const next = [...stops];
    next[i] = { ...next[i], transport };
    setStops(next);
  };

  // Aperçu automatique : ~1 s après la dernière modification, on place les
  // étapes qui n'ont pas encore de position (géocodage, mémorisé) puis on
  // dessine la carte — même rendu que dans le fichier final.
  const sig = JSON.stringify((stops || []).map((s) => [s.name, s.country, s.transport, s.lat, s.lng])) + '|' + (map?.country || '') + (enabled ? '1' : '0') + '|' + retryNonce;
  useEffect(() => {
    if (!enabled) return undefined;
    if (!stops.some((s) => s.name?.trim())) { setPreview(null); setUnplaced([]); return undefined; }
    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const resolved = [];
        let changed = false;
        let queried = false;
        for (const s of stops) {
          if (!s.name?.trim() || (s.lat && s.lng)) { resolved.push(s); continue; }
          // Le service de placement gratuit limite la cadence : petite pause
          // entre deux recherches pour ne pas être rejeté.
          if (queried) await new Promise((r) => setTimeout(r, 450));
          queried = true;
          const c = await geocode(s.name, s.country || map?.country);
          if (seq !== previewSeq.current) return; // une saisie plus récente a repris la main
          if (c) { resolved.push({ ...s, ...c }); changed = true; }
          else resolved.push(s);
        }
        if (changed) setStops(resolved); // positions mémorisées (pas de re-géocodage ensuite)
        const placed = resolved.filter((s) => s.name?.trim() && s.lat && s.lng);
        // Étapes impossibles à placer : on PRÉVIENT au lieu d'ignorer en silence.
        setUnplaced(resolved.filter((s) => s.name?.trim() && !(s.lat && s.lng)).map((s) => s.name.trim()));
        if (placed.length) {
          const img = await renderRouteMapImage(placed.map((s) => ({ lat: s.lat, lng: s.lng })), {
            width: 900,
            height: 620,
            accent: '#C8643C',
            transports: placed.slice(0, -1).map((s) => s.transport || null),
          });
          if (seq === previewSeq.current) setPreview(img);
        } else if (seq === previewSeq.current) {
          setPreview(null);
        }
      } finally {
        if (seq === previewSeq.current) setPreviewBusy(false);
      }
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

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
            Liste les villes/étapes, dans l'ordre. Utilise les flèches ▲▼ (ou glisse la poignée ⠿ sur ordinateur) pour les réordonner. Entre deux étapes, choisis le moyen de transport : il apparaîtra sur le trait de la carte. La carte se dessine toute seule.
          </p>

          {/* Pays : fiabilise le placement des villes (ex. plusieurs « Ella »
              dans le monde). */}
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex-1 text-xs font-medium text-slate-600">
              Pays principal du voyage (recommandé)
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
              Renseigne le pays pour que les villes soient bien placées, puis « ↻ Recalculer » et refais le fichier. Voyage dans plusieurs pays ? Tu peux préciser un pays différent sur chaque étape (case « Pays »).
            </p>
          </div>

          <div className="mt-2 space-y-2">
            {stops.map((s, i) => (
              <div key={i}>
              <div
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
                    // on oublie d'anciennes coords si le nom change (pays et transport conservés)
                    next[i] = { name: e.target.value, country: s.country, transport: s.transport };
                    setStops(next);
                  }}
                  placeholder="Ex : Paris"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <input
                  value={s.country || ''}
                  onChange={(e) => {
                    const next = [...stops];
                    // pays modifié → coords oubliées (repositionnement au prochain fichier)
                    next[i] = { name: s.name, country: e.target.value, transport: s.transport };
                    setStops(next);
                  }}
                  placeholder="Pays"
                  title="Pays de cette étape (utile si le voyage traverse plusieurs pays)"
                  className="w-24 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm sm:w-32"
                />
                <button type="button" onClick={() => setPickIdx(i)}
                  className={`shrink-0 text-lg ${s.lat && s.lng ? 'text-emerald-600 hover:text-emerald-700' : 'text-slate-400 hover:text-coral-600'}`}
                  title={s.lat && s.lng ? 'Position trouvée — toucher pour l’ajuster sur la carte' : 'Placer cette étape à la main sur la carte'}>
                  📍
                </button>
                <button type="button" onClick={() => setStops(stops.filter((_, k) => k !== i))}
                  className="text-slate-400 hover:text-red-600" title="Retirer">✕</button>
              </div>
              {/* Trajet vers l'étape suivante : choix du transport (affiché au
                  milieu du trait sur la carte). Re-toucher = désélectionner. */}
              {i < stops.length - 1 && (
                <div className="ml-14 mt-1 flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] text-slate-400">↓ trajet :</span>
                  {MAP_TRANSPORTS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setStopTransport(i, s.transport === t.id ? null : t.id)}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border text-sm ${s.transport === t.id ? 'border-coral-400 bg-coral-100' : 'border-transparent bg-slate-100 hover:bg-slate-200'}`}
                      title={t.label}
                    >
                      {t.emoji}
                    </button>
                  ))}
                </div>
              )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setStops([...stops, { name: '' }])}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            ➕ Ajouter une étape
          </button>

          {/* APERÇU EN DIRECT : même dessin que dans le fichier final */}
          {(preview || previewBusy) && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aperçu de la carte</p>
                {previewBusy && <Spinner className="h-3.5 w-3.5" />}
              </div>
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {preview ? (
                  <img src={preview} alt="Aperçu de la carte du voyage" className={`block w-full ${previewBusy ? 'opacity-60' : ''}`} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-slate-500">Placement des étapes…</div>
                )}
              </div>
              {unplaced.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="flex-1 text-xs font-medium text-amber-700">
                    ⚠️ Étape{unplaced.length > 1 ? 's' : ''} introuvable{unplaced.length > 1 ? 's' : ''} sur la carte : {unplaced.join(', ')}. Vérifie l'orthographe (ou mets le pays, ex. « Italie »), puis réessaie.
                  </p>
                  <button type="button" onClick={() => setRetryNonce((n) => n + 1)}
                    className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                    ↻ Réessayer
                  </button>
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                L'aperçu se met à jour tout seul, environ une seconde après tes changements (étapes, pays, transports). Une étape mal placée ou introuvable ? Touche son 📍 pour la poser à la main.
              </p>
            </div>
          )}

          {pickIdx != null && stops[pickIdx] && (
            <StopPositionPicker
              stop={stops[pickIdx]}
              stopIndex={pickIdx}
              allStops={stops}
              onSave={(pos) => {
                const next = [...stops];
                next[pickIdx] = { ...next[pickIdx], lat: pos.lat, lng: pos.lng };
                setStops(next); // l'aperçu se redessine tout seul
              }}
              onClose={() => setPickIdx(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}
