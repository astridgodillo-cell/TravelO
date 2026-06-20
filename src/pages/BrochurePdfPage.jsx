import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { getItinerary } from '../lib/supabase';
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

// Nombre de photos affichées par jour dans la brochure (1 grande + 4 petites).
const PER_DAY = 5;

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
                    onPick(u);
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

        setItinerary(it);
        setRouteMap(rMap);
        setCoverPool(coverUrls);
        setDayPools(poolsByDay);
        setCover(coverUrls[0] || null);
        setOverview(coverUrls[1] || coverUrls[0] || null);
        setDayPhotos(initialDays);
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

  function setDayPhoto(i, slot, value) {
    setDayPhotos((prev) => {
      const arr = [...(prev[i] || [])];
      arr[slot] = value;
      return { ...prev, [i]: arr };
    });
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
          photos={{ cover, overview, days: dayPhotos, routeMap }}
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
        <div className="flex items-center gap-2">
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
            proposée, ou importez la vôtre. Quand tout vous convient, cliquez sur
            « Générer le PDF » en haut.
          </div>

          {/* Couverture + aperçu */}
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Couverture & présentation
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <PhotoSlot
                value={cover}
                pool={coverPool}
                onPick={setCover}
                label="Couverture"
                className="h-40"
                defaultQuery={itinerary.summary?.destinations || ''}
              />
              <PhotoSlot
                value={overview}
                pool={coverPool}
                onPick={setOverview}
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
                <p className="mb-3 font-semibold text-slate-800">
                  Jour {i + 1} — {d.location}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {Array.from({ length: PER_DAY }).map((_, slot) => (
                    <PhotoSlot
                      key={slot}
                      value={(dayPhotos[i] || [])[slot]}
                      pool={dayPools[i] || []}
                      onPick={(v) => setDayPhoto(i, slot, v)}
                      defaultQuery={dayPhotoQuery(d)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
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
