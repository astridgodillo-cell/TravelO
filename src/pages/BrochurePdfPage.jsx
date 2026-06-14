import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { getItinerary } from '../lib/supabase';
import { fetchPhotosFor } from '../lib/photos';
import BrochurePdfDoc from '../components/BrochurePdfDoc';

const imgUrl = (p) =>
  p?.src?.large || p?.src?.medium || p?.src?.small || p?.url || '';

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
          const list = await fetchPhotosFor(days[i].location, 3, 'auto', 'destination');
          dayMap[i] = (list || []).map(imgUrl).filter(Boolean);
          setStatus(`Recherche des photos… ${Math.round(((i + 1) / days.length) * 100)}%`);
        }
        if (!active) return;

        setStatus('Création du PDF…');
        const blob = await pdf(
          <BrochurePdfDoc itinerary={it} photos={{ cover, overview, days: dayMap }} />
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
