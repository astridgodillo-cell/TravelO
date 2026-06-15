import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { getItinerary } from '../lib/supabase';
import { fetchPhotosFor } from '../lib/photos';
import { renderRouteMapImage } from '../lib/staticMapImage';
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

// Page de génération de la brochure PDF « agence » (style tour-opérateur).
// Route : /itineraire/:id/brochure-pdf
export default function BrochurePdfPage() {
  const { id } = useParams();
  const [status, setStatus] = useState('Chargement du voyage…');
  const [url, setUrl] = useState(null);
  const [fileName, setFileName] = useState('brochure.pdf');
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let objUrl = null;
    (async () => {
      try {
        const { data: trip, error: e1 } = await getItinerary(id);
        if (e1) throw new Error(e1.message);
        if (!trip?.itinerary) throw new Error('Voyage introuvable.');
        const it = trip.itinerary;
        const days = Array.isArray(it.days) ? it.days : [];

        setStatus('Recherche des photos…');
        // Photos via Pexels/Unsplash (source 'auto') : fiables pour le PDF.
        const coverList = await fetchPhotosFor(
          it.summary?.destinations || days[0]?.location, 4, 'auto', 'destination'
        );
        const cover = imgUrl(coverList?.[0]);
        const overview = imgUrl(coverList?.[1]);

        const dayMap = {};
        for (let i = 0; i < days.length; i++) {
          if (!active) return;
          const list = await fetchPhotosFor(dayPhotoQuery(days[i]), 3, 'auto', 'destination');
          dayMap[i] = (list || []).map(imgUrl).filter(Boolean);
          setStatus(`Recherche des photos… ${Math.round(((i + 1) / days.length) * 100)}%`);
        }
        if (!active) return;

        // Carte du parcours (image fabriquée à partir des tuiles de l'app).
        setStatus('Création de la carte…');
        const accent = resolveTheme(it)?.palette?.accent || '#C8A04B';
        const points = days
          .map((d) => d.coordinates)
          .filter((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number');
        let routeMap = null;
        try {
          routeMap = points.length ? await renderRouteMapImage(points, { accent }) : null;
        } catch (_) { routeMap = null; }
        if (!active) return;

        setStatus('Création du PDF…');
        const blob = await pdf(
          <BrochurePdfDoc itinerary={it} photos={{ cover, overview, days: dayMap, routeMap }} />
        ).toBlob();
        if (!active) return;

        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
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
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [id]);

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link to={`/itineraire/${id}`} className="text-sm text-brand-700 underline">
          ← Retour au voyage
        </Link>
        {url && (
          <a
            href={url}
            download={fileName}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow"
          >
            ⬇️ Télécharger le PDF
          </a>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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

      {url && (
        <iframe
          title="Brochure PDF"
          src={url}
          className="w-full flex-1 rounded-xl border border-slate-200"
        />
      )}
    </div>
  );
}
