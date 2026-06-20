import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { getItinerary, updateItinerary } from '../lib/supabase';
import { fetchPhotosFor } from '../lib/photos';
import { renderRouteMapImage } from '../lib/staticMapImage';
import { recomputeBudgetFromDays } from '../lib/itineraryEdits';
import BrochurePdfDoc, { resolveTheme } from '../components/BrochurePdfDoc';

const imgUrl = (p) =>
  p?.src?.large || p?.src?.medium || p?.src?.small || p?.url || '';

// Mot-clé photo le plus pertinent pour la journée :
//  - le photo_query du jour s'il existe (fourni par le générateur),
//  - sinon la VILLE (entre parenthèses pour "Legoland (Günzburg)" → Günzburg,
//    sinon la 1re partie avant un tiret/virgule).
function dayPhotoQuery(d) {
  if (d?.photo_query) return d.photo_query;
  const loc = String(d?.location || '');
  const paren = loc.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  return loc.split(/[–—,/]| - /)[0].trim() || loc;
}

// Nombre de photos affichées par jour dans la brochure (1 grande + 6 petites).
const PER_DAY = 7;

// Première lettre en majuscule (pour transformer un mot cherché en légende).
const capitalize = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Légendes par défaut d'une journée (titres du programme), une par photo.
function defaultCaptions(d) {
  const raw = [
    d?.morning?.title,
    d?.afternoon?.title,
    d?.noon?.title,
    d?.evening?.title,
    d?.culinary_specialties?.[0]?.name,
  ];
  return raw.map((x) => (x ? String(x) : '')).slice(0, PER_DAY);
}

// Lit un fichier image choisi par l'utilisateur et le transforme en URL
// directement utilisable dans le PDF (donnée intégrée, pas de lien externe).
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Une vignette photo qu'on peut remplacer : au clic, un panneau s'ouvre avec
// d'autres photos proposées (à cliquer), une barre de recherche pour charger
// d'autres photos (en tapant un mot), et un bouton pour importer la sienne.
function PhotoSlot({ value, pool = [], onPick, label, className = 'h-24', defaultQuery = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    onPick(url);
    setOpen(false);
    e.target.value = '';
  }

  async function runSearch() {
    const q = (query || defaultQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const photos = await fetchPhotosFor(q, 30, 'unsplash', 'destination');
      setResults([...new Set((photos || []).map(imgUrl).filter(Boolean))]);
    } finally {
      setSearching(false);
    }
  }

  // Photos affichées : les résultats de recherche s'ils existent, sinon les
  // photos proposées au départ. La photo actuelle est toujours en tête.
  const base = searched ? results : pool;
  const options = [...new Set([value, ...base].filter(Boolean))];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`group relative block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 ${className}`}
        title="Cliquer pour changer la photo"
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-slate-400">
            Aucune photo
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          Changer
        </span>
      </button>
      {label && (
        <p className="mt-1 truncate text-center text-[11px] text-slate-500">{label}</p>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
            {/* Recherche par mot-clé */}
            <div className="mb-2 flex gap-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                  }
                }}
                placeholder={defaultQuery ? `Ex : ${defaultQuery}` : 'Ex : Vienne, coucher de soleil…'}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={searching}
                className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {searching ? '…' : '🔍'}
              </button>
            </div>

            <p className="mb-1.5 text-[11px] text-slate-500">
              {searching
                ? 'Recherche en cours…'
                : searched
                  ? results.length
                    ? `${results.length} photo(s) trouvée(s) — cliquez pour choisir`
                    : 'Aucune photo trouvée. Essayez un autre mot.'
                  : 'Cliquez une photo, ou tapez un mot pour en chercher d’autres.'}
            </p>

            <div className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto">
              {options.map((u, k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    // Si la photo vient d'une recherche, on transmet le mot
                    // cherché comme suggestion de légende.
                    onPick(u, searched ? (query || defaultQuery).trim() : undefined);
                    setOpen(false);
                  }}
                  className={`relative h-16 overflow-hidden rounded-md border ${
                    u === value ? 'border-brand-500 ring-2 ring-brand-300' : 'border-slate-200'
                  }`}
                >
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              📤 Importer ma propre photo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Grand « mur de photos » d'une journée : on cherche par mot-clé et on coche
// PLUSIEURS photos d'un coup (jusqu'à 5). Les photos cochées, dans l'ordre,
// remplacent celles de la journée.
function BulkPhotoPicker({ index, location, defaultQuery = '', initial = [], pool = [], onApply, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [uploaded, setUploaded] = useState([]);
  const [selected, setSelected] = useState(() => initial.filter(Boolean).slice(0, PER_DAY));
  const fileRef = useRef(null);

  async function runSearch() {
    const q = (query || defaultQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const photos = await fetchPhotosFor(q, 30, 'unsplash', 'destination');
      setResults([...new Set((photos || []).map(imgUrl).filter(Boolean))]);
    } finally {
      setSearching(false);
    }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const urls = await Promise.all(files.map(fileToDataUrl));
    setUploaded((prev) => [...urls, ...prev]);
    setSelected((prev) => {
      const next = [...prev];
      for (const u of urls) if (next.length < PER_DAY && !next.includes(u)) next.push(u);
      return next;
    });
    e.target.value = '';
  }

  function toggle(u) {
    setSelected((prev) => {
      if (prev.includes(u)) return prev.filter((x) => x !== u);
      if (prev.length >= PER_DAY) return prev; // déjà 5 cochées
      return [...prev, u];
    });
  }

  const base = searched ? results : pool;
  const grid = [...new Set([...uploaded, ...selected, ...base].filter(Boolean))];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-800">
            Jour {index + 1} — {location} · choisir plusieurs photos
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder={defaultQuery ? `Ex : ${defaultQuery}` : 'Ex : Vienne, vieille ville…'}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={runSearch}
            disabled={searching}
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {searching ? 'Recherche…' : '🔍 Chercher'}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            📤 Importer
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </div>

        <p className="mb-2 text-xs text-slate-500">
          {searching
            ? 'Recherche en cours…'
            : `${selected.length}/${PER_DAY} photo(s) cochée(s). Cliquez une photo pour la cocher ou la décocher.`}
        </p>

        <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {grid.map((u, k) => {
            const pos = selected.indexOf(u);
            const on = pos >= 0;
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(u)}
                className={`relative h-28 overflow-hidden rounded-lg border-2 ${
                  on ? 'border-brand-500' : 'border-transparent'
                }`}
              >
                <img src={u} alt="" className="h-full w-full object-cover" />
                {on && (
                  <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white shadow">
                    {pos + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
            Annuler
          </button>
          <button
            onClick={() => onApply(selected)}
            disabled={selected.length === 0}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Utiliser ces {selected.length} photo(s)
          </button>
        </div>
      </div>
    </div>
  );
}

// Page de génération de la brochure PDF « agence » (style tour-opérateur).
// Route : /itineraire/:id/brochure-pdf
// Étapes : 1) recherche des photos  2) choix/remplacement des photos
//          3) génération du PDF.
export default function BrochurePdfPage() {
  const { id } = useParams();
  const [status, setStatus] = useState('Chargement du voyage…');
  const [error, setError] = useState(null);

  // Données préparées une fois pour toutes après le chargement.
  const [itinerary, setItinerary] = useState(null);
  const [routeMap, setRouteMap] = useState(null);
  const [coverPool, setCoverPool] = useState([]); // photos candidates couverture/aperçu
  const [dayPools, setDayPools] = useState({}); // { [i]: [url,...] } candidates par jour

  // Sélection courante (modifiable par l'utilisateur).
  const [cover, setCover] = useState(null);
  const [overview, setOverview] = useState(null);
  const [dayPhotos, setDayPhotos] = useState({}); // { [i]: [url x5] }
  const [dayCaptions, setDayCaptions] = useState({}); // { [i]: [legende x5] }

  // Mur de photos d'une journée (sélection multiple) : index du jour ouvert.
  const [bulkDay, setBulkDay] = useState(null);

  // Enregistrement de la sélection (pour reprendre plus tard).
  const [dirty, setDirty] = useState(false); // des changements non enregistrés
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  // Génération PDF.
  const [generating, setGenerating] = useState(false);
  const [url, setUrl] = useState(null);
  const [fileName, setFileName] = useState('brochure.pdf');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: trip, error: e1 } = await getItinerary(id);
        if (e1) throw new Error(e1.message);
        if (!trip?.itinerary) throw new Error('Voyage introuvable.');
        const it = trip.itinerary;
        const days = Array.isArray(it.days) ? it.days : [];

        setStatus('Recherche des photos…');
        const coverList = await fetchPhotosFor(
          it.summary?.destinations || days[0]?.location, 8, 'auto', 'destination'
        );
        const coverUrls = [...new Set((coverList || []).map(imgUrl).filter(Boolean))];

        // Regroupe les jours par requête photo : si plusieurs jours partagent
        // la même ville, on récupère un grand lot et on répartit des photos
        // DIFFÉRENTES sur chaque jour (pas de doublons d'une page à l'autre).
        const queryToDays = new Map();
        days.forEach((d, i) => {
          const q = dayPhotoQuery(d);
          if (!queryToDays.has(q)) queryToDays.set(q, []);
          queryToDays.get(q).push(i);
        });

        const initialDays = {};
        const poolsByDay = {};
        let done = 0;
        for (const [q, idxs] of queryToDays) {
          if (!active) return;
          const need = idxs.length * PER_DAY;
          const pool = (await fetchPhotosFor(q, Math.min(30, need + 6), 'auto', 'destination')) || [];
          const urls = [...new Set(pool.map(imgUrl).filter(Boolean))];
          idxs.forEach((di, k) => {
            const out = [];
            for (let j = 0; j < PER_DAY && urls.length; j++) {
              out.push(urls[(k * PER_DAY + j) % urls.length]); // décalage par jour
            }
            initialDays[di] = out;
            poolsByDay[di] = urls;
            done += 1;
            setStatus(`Recherche des photos… ${Math.round((done / days.length) * 100)}%`);
          });
        }
        if (!active) return;

        // Carte du parcours (image fabriquée à partir des tuiles de l'app).
        setStatus('Création de la carte…');
        const accent = resolveTheme(it)?.palette?.accent || '#C8A04B';
        const points = days
          .map((d) => d.coordinates)
          .filter((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number');
        let rMap = null;
        try {
          rMap = points.length ? await renderRouteMapImage(points, { accent }) : null;
        } catch (_) { rMap = null; }
        if (!active) return;

        // Reprise d'un travail enregistré : si une sélection a déjà été
        // sauvegardée sur ce voyage, on la recharge (et on complète avec les
        // photos auto pour les emplacements éventuellement manquants).
        const saved = it.brochure_photos || null;
        const mergedDays = { ...initialDays, ...(saved?.days || {}) };
        // Légendes par défaut (titres du programme) + celles enregistrées.
        const initialCaptions = {};
        days.forEach((d, i) => { initialCaptions[i] = defaultCaptions(d); });
        const mergedCaptions = { ...initialCaptions, ...(saved?.captions || {}) };

        setItinerary(it);
        setRouteMap(rMap);
        setCoverPool(coverUrls);
        setDayPools(poolsByDay);
        setCover(saved?.cover || coverUrls[0] || null);
        setOverview(saved?.overview || coverUrls[1] || coverUrls[0] || null);
        setDayPhotos(mergedDays);
        setDayCaptions(mergedCaptions);
        setSavedOnce(!!saved);
        setFileName(`brochure-${(it.summary?.destinations || 'voyage').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
        setStatus(null);
      } catch (e) {
        if (active) {
          setError(e.message || 'Erreur lors de la génération.');
          setStatus(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  function pickCover(v) {
    setCover(v);
    setDirty(true);
  }
  function pickOverview(v) {
    setOverview(v);
    setDirty(true);
  }
  function setDayPhoto(i, slot, value, captionSuggestion) {
    setDayPhotos((prev) => {
      const arr = [...(prev[i] || [])];
      arr[slot] = value;
      return { ...prev, [i]: arr };
    });
    // Quand la photo vient d'une recherche, on cale la légende sur le mot
    // cherché (il décrit la photo). L'utilisateur peut ensuite la modifier.
    if (captionSuggestion) {
      setDayCaptions((prev) => {
        const arr = [...(prev[i] || [])];
        arr[slot] = capitalize(captionSuggestion);
        return { ...prev, [i]: arr };
      });
    }
    setDirty(true);
  }

  function setDayCaption(i, slot, value) {
    setDayCaptions((prev) => {
      const arr = [...(prev[i] || [])];
      arr[slot] = value;
      return { ...prev, [i]: arr };
    });
    setDirty(true);
  }

  // Applique une sélection multiple : les photos cochées (dans l'ordre)
  // remplacent les emplacements de la journée ; les autres restent inchangés.
  function applyBulk(i, urls) {
    setDayPhotos((prev) => {
      const arr = [...(prev[i] || [])];
      for (let k = 0; k < PER_DAY; k++) if (urls[k]) arr[k] = urls[k];
      return { ...prev, [i]: arr };
    });
    setDirty(true);
    setBulkDay(null);
  }

  // Enregistre la sélection dans le voyage (clé brochure_photos) pour pouvoir
  // la reprendre plus tard, même après avoir fermé la page.
  async function saveWork() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      const next = {
        ...itinerary,
        brochure_photos: { cover, overview, days: dayPhotos, captions: dayCaptions },
      };
      const { error: e } = await updateItinerary(id, { itinerary: next });
      if (e) throw e;
      setItinerary(next);
      setDirty(false);
      setSavedOnce(true);
    } catch (e) {
      setError(e.message || "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (!itinerary) return;
    setGenerating(true);
    setError(null);
    try {
      const itForPdf = { ...itinerary, budget_summary: recomputeBudgetFromDays(itinerary) };
      const blob = await pdf(
        <BrochurePdfDoc
          itinerary={itForPdf}
          photos={{ cover, overview, days: dayPhotos, captions: dayCaptions, routeMap }}
        />
      ).toBlob();
      if (url) URL.revokeObjectURL(url);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || 'Erreur lors de la génération du PDF.');
    } finally {
      setGenerating(false);
    }
  }

  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/itineraire/${id}`} className="text-sm text-brand-700 underline">
          ← Retour au voyage
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {itinerary && (
            <button
              onClick={saveWork}
              disabled={saving || (!dirty && savedOnce)}
              className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? 'Enregistrement…'
                : dirty || !savedOnce
                  ? '💾 Enregistrer mes photos'
                  : '✓ Enregistré'}
            </button>
          )}
          {itinerary && (
            <button
              onClick={generate}
              disabled={generating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating
                ? 'Création du PDF…'
                : url
                  ? '🔄 Régénérer avec ces photos'
                  : '📄 Générer le PDF'}
            </button>
          )}
          {url && (
            <a
              href={url}
              download={fileName}
              className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm"
            >
              ⬇️ Télécharger
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {status && !error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3 text-slate-600">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-500" />
            {status}
          </div>
        </div>
      )}

      {/* Étape de choix des photos */}
      {itinerary && !status && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Cliquez sur une photo pour la remplacer : choisissez une autre photo
            proposée, ou importez la vôtre. Sous chaque photo de journée, vous
            pouvez écrire la légende qui apparaîtra dans la brochure (elle se
            remplit automatiquement avec le mot que vous cherchez). Vous pouvez
            vous arrêter quand vous voulez : cliquez sur « 💾 Enregistrer mes
            photos » en haut, et vous retrouverez votre travail tel quel la
            prochaine fois. Quand tout vous convient, cliquez sur « Générer le
            PDF ».
          </div>
          {savedOnce && !dirty && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              ✓ Votre sélection de photos est enregistrée. Vous pouvez fermer la
              page et la reprendre plus tard.
            </div>
          )}

          {/* Couverture + aperçu */}
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Couverture & présentation
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <PhotoSlot
                value={cover}
                pool={coverPool}
                onPick={pickCover}
                label="Couverture"
                className="h-40"
                defaultQuery={itinerary.summary?.destinations || ''}
              />
              <PhotoSlot
                value={overview}
                pool={coverPool}
                onPick={pickOverview}
                label="Présentation"
                className="h-40"
                defaultQuery={itinerary.summary?.destinations || ''}
              />
            </div>
          </div>

          {/* Photos par jour */}
          <div className="space-y-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Photos de chaque journée
            </h3>
            {days.map((d, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800">
                    Jour {i + 1} — {d.location}
                  </p>
                  <button
                    type="button"
                    onClick={() => setBulkDay(i)}
                    className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    🖼️ Choisir plusieurs photos d'un coup
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: PER_DAY }).map((_, slot) => (
                    <div key={slot}>
                      <PhotoSlot
                        value={(dayPhotos[i] || [])[slot]}
                        pool={dayPools[i] || []}
                        onPick={(v, cap) => setDayPhoto(i, slot, v, cap)}
                        defaultQuery={dayPhotoQuery(d)}
                      />
                      <input
                        value={(dayCaptions[i] || [])[slot] || ''}
                        onChange={(e) => setDayCaption(i, slot, e.target.value)}
                        placeholder="Légende sous la photo"
                        className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mur de photos d'une journée (sélection multiple) */}
      {bulkDay != null && days[bulkDay] && (
        <BulkPhotoPicker
          index={bulkDay}
          location={days[bulkDay].location}
          defaultQuery={dayPhotoQuery(days[bulkDay])}
          initial={dayPhotos[bulkDay] || []}
          pool={dayPools[bulkDay] || []}
          onApply={(urls) => applyBulk(bulkDay, urls)}
          onClose={() => setBulkDay(null)}
        />
      )}

      {/* Aperçu du PDF généré */}
      {url && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Aperçu du PDF
          </h3>
          <iframe
            title="Brochure PDF"
            src={url}
            className="h-[80vh] w-full rounded-xl border border-slate-200"
          />
        </div>
      )}
    </div>
  );
}
