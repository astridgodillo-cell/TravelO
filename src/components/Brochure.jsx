import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchPhotosFor } from '../lib/photos';
import { getTileUrl, getGoogleMapsRouteLink } from '../lib/mapTiles';

// URL d'image exploitable à partir d'un objet photo renvoyé par fetchPhotosFor.
const imgUrl = (p) =>
  p?.src?.large || p?.src?.medium || p?.src?.small || p?.url || '';

function isValidCoord(c) {
  if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
  if (Math.abs(c.lat) < 0.5 && Math.abs(c.lng) < 0.5) return false; // (0,0)
  return c.lat >= -90 && c.lat <= 90 && c.lng >= -180 && c.lng <= 180;
}

function dotIcon(label) {
  return L.divIcon({
    className: 'brochure-pin',
    html: `<div style="background:#e2580c;color:#fff;border-radius:50%;width:24px;height:24px;display:grid;place-items:center;font-weight:700;font-size:11px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label || ''}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Recadre la carte sur les points (un seul → centré ; plusieurs → bounds).
function FitPoints({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const fit = () => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 11);
      } else {
        map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
          padding: [30, 30],
          maxZoom: 11,
        });
      }
    };
    const t1 = setTimeout(fit, 120);
    const t2 = setTimeout(fit, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [points, map]);
  return null;
}

// Carte Leaflet (mêmes tuiles que l'itinéraire — fonctionne avec la clé).
function LeafletMap({ points, className }) {
  const pts = (points || []).filter(isValidCoord);
  if (!pts.length) return null;
  return (
    <MapContainer
      className={className}
      center={[pts[0].lat, pts[0].lng]}
      zoom={9}
      scrollWheelZoom={false}
      dragging={false}
      zoomControl={false}
      doubleClickZoom={false}
      attributionControl={false}
    >
      <TileLayer url={getTileUrl()} />
      {pts.map((p, i) => (
        <Marker
          key={i}
          position={[p.lat, p.lng]}
          icon={dotIcon(pts.length > 1 ? String(i + 1) : '')}
        />
      ))}
      {pts.length > 1 && (
        <Polyline
          positions={pts.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: '#e2580c', weight: 3, opacity: 0.7 }}
        />
      )}
      <FitPoints points={pts} />
    </MapContainer>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// Garantit qu'un bloc tient dans la hauteur d'une page : si le contenu
// dépasse, on le réduit légèrement (transform scale) tout en gardant tout.
// La mesure se fait toujours à l'état naturel (sans transform) pour éviter
// toute oscillation, et est rejouée le temps que photos/cartes se chargent
// ainsi qu'avant l'impression.
function FitToPage({ children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      inner.style.transform = 'none';
      inner.style.width = '100%';
      const avail = outer.clientHeight;
      const needed = inner.scrollHeight;
      if (!avail || !needed) return;
      const s = needed > avail ? Math.max(0.5, avail / needed) : 1;
      inner.style.transformOrigin = 'top left';
      inner.style.transform = `scale(${s})`;
      inner.style.width = s < 1 ? `${100 / s}%` : '100%';
    };
    measure();
    const id = setInterval(measure, 400);
    const stop = setTimeout(() => clearInterval(id), 6000);
    window.addEventListener('resize', measure);
    window.addEventListener('beforeprint', measure);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
      window.removeEventListener('resize', measure);
      window.removeEventListener('beforeprint', measure);
    };
  }, []);
  return (
    <div ref={outerRef} className="h-full overflow-hidden">
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

const MOMENTS = [
  ['morning', 'Matin'],
  ['noon', 'Midi'],
  ['afternoon', 'Après-midi'],
  ['evening', 'Soir'],
];

// Brochure imprimable façon tour-opérateur : couverture + carte d'ensemble +
// 1 page par jour (photo, carte, programme) + page budget/conseils.
// Les photos viennent de Pexels/Unsplash/Google Places (comme dans l'app),
// les cartes statiques de MapTiler.
export default function Brochure({ itinerary }) {
  const summary = itinerary?.summary || {};
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const budget = itinerary?.budget_summary || {};
  const notes = itinerary?.notes || {};

  const [cover, setCover] = useState(null);
  const [dayPhotos, setDayPhotos] = useState({});
  const [foodPhotos, setFoodPhotos] = useState({});
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const coverQuery = summary.destinations || days[0]?.location;
      const c = await fetchPhotosFor(coverQuery, 1, 'auto', 'destination');
      if (active && c?.[0]) setCover(c[0]);

      for (let i = 0; i < days.length; i++) {
        if (!active) return;
        const d = days[i];
        const ph = await fetchPhotosFor(d.location, 1, 'google-places', 'destination');
        if (active && ph?.[0]) setDayPhotos((prev) => ({ ...prev, [i]: ph[0] }));
        const spec = d.culinary_specialties?.[0];
        if (spec?.photo_query) {
          const fp = await fetchPhotosFor(spec.photo_query, 1, 'unsplash', 'food');
          if (active && fp?.[0]) setFoodPhotos((prev) => ({ ...prev, [i]: fp[0] }));
        }
        if (active) setProgress(Math.round(((i + 1) / days.length) * 100));
      }
      if (active) setReady(true);
    }
    load();
    return () => {
      active = false;
    };
  }, [itinerary]);

  const points = days.map((d) => d.coordinates).filter(isValidCoord);
  const gmapsLink = getGoogleMapsRouteLink(points);
  const coverImg = imgUrl(cover);

  const eur = (n) =>
    n == null ? '—' : `${Math.round(Number(n)).toLocaleString('fr-FR')} €`;

  return (
    <div className="brochure-root">
      <style>{`
        @page { size: A4; margin: 8mm; }
        .brochure-page {
          break-after: page;
          page-break-after: always;
          background: #fff;
        }
        .brochure-page:last-child { break-after: auto; page-break-after: auto; }
        .b-avoid { break-inside: avoid; }
        /* Une journée = une page : hauteur fixe, contenu ajusté pour rentrer. */
        .brochure-day-card { height: 1040px; overflow: hidden; }
        @media print {
          nav, footer, .no-print { display: none !important; }
          .brochure-page {
            box-shadow: none !important;
            margin: 0 !important;
            border: none !important;
          }
        }
      `}</style>

      {/* Barre d'action (cachée à l'impression) */}
      <div className="no-print sticky top-0 z-20 mb-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="text-sm text-slate-600">
          {ready ? (
            <span className="font-medium text-emerald-700">✅ Brochure prête</span>
          ) : (
            <span>📷 Préparation des photos… {progress}%</span>
          )}
        </div>
        <button
          onClick={() => window.print()}
          disabled={!ready}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          🖨️ Imprimer / Enregistrer en PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        {/* ---------- COUVERTURE ---------- */}
        <section className="brochure-page relative overflow-hidden rounded-2xl shadow">
          <div className="relative h-[60vh] min-h-[420px] w-full bg-slate-800">
            {coverImg && (
              <img
                src={coverImg}
                alt={summary.destinations || ''}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40" />
            <div className="absolute inset-x-0 bottom-0 p-8 text-white">
              <p className="mb-2 text-sm uppercase tracking-[0.3em] text-white/80">
                Carnet de voyage
              </p>
              <h1 className="font-serif text-4xl font-bold leading-tight drop-shadow">
                {summary.destinations || 'Votre voyage'}
              </h1>
              {summary.headline && (
                <p className="mt-3 max-w-xl text-lg text-white/90">{summary.headline}</p>
              )}
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/85">
                {summary.start_date && (
                  <span>📅 {fmtDate(summary.start_date)} → {fmtDate(summary.end_date)}</span>
                )}
                {summary.duration_days && <span>⏳ {summary.duration_days} jours</span>}
                {summary.travellers && (
                  <span>
                    👥 {summary.travellers.adults || 0} adulte(s)
                    {summary.travellers.children_ages?.length
                      ? ` + ${summary.travellers.children_ages.length} enfant(s)`
                      : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- CARTE D'ENSEMBLE ---------- */}
        <section className="brochure-page rounded-2xl bg-white p-8 shadow">
          <h2 className="font-serif text-2xl font-bold text-slate-900">
            🗺️ Votre itinéraire
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {points.length} étape(s){summary.total_distance_km ? ` • ${summary.total_distance_km} km` : ''}
          </p>
          {points.length > 0 && (
            <LeafletMap
              points={points}
              className="mt-4 h-[340px] w-full rounded-xl border border-slate-200"
            />
          )}
          <ol className="mt-5 space-y-1 text-sm text-slate-700">
            {days.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-brand-700">{d.label || `J${i + 1}`}</span>
                <span>— {d.location}</span>
              </li>
            ))}
          </ol>
          {gmapsLink && (
            <a
              href={gmapsLink}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-sm font-medium text-brand-700 underline"
            >
              📍 Ouvrir l'itinéraire dans Google Maps
            </a>
          )}
        </section>

        {/* ---------- UNE PAGE PAR JOUR ---------- */}
        {days.map((d, i) => {
          const photo = dayPhotos[i];
          const food = foodPhotos[i];
          const hasDayMap = isValidCoord(d.coordinates);
          const nextTrip = d.trips?.[0];
          return (
            <section key={i} className="brochure-page brochure-day-card rounded-2xl bg-white shadow">
              <FitToPage>
              <div className="brochure-day p-6">
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                <h2 className="font-serif text-2xl font-bold text-slate-900">
                  {d.label || `Jour ${i + 1}`} — {d.location}
                </h2>
                <span className="shrink-0 text-sm text-slate-500">
                  {d.weekday ? `${d.weekday} ` : ''}
                  {d.weather?.emoji || ''}{' '}
                  {d.weather?.temperature_c != null ? `${d.weather.temperature_c}°C` : ''}
                </span>
              </div>

              {d.day_title && (
                <p className="mt-2 font-serif text-base italic text-slate-700">
                  {d.day_title}
                </p>
              )}

              <div className="b-avoid mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {photo && (
                  <figure>
                    <img
                      src={imgUrl(photo)}
                      alt={d.location}
                      className="h-40 w-full rounded-xl object-cover"
                    />
                    {photo.photographer && (
                      <figcaption className="mt-1 text-[10px] text-slate-400">
                        📷 {photo.photographer}
                      </figcaption>
                    )}
                  </figure>
                )}
                {hasDayMap && (
                  <LeafletMap
                    points={[d.coordinates]}
                    className="h-40 w-full rounded-xl border border-slate-200"
                  />
                )}
              </div>

              {/* Programme */}
              <div className="mt-4 space-y-2">
                {MOMENTS.map(([key, label]) => {
                  const m = d[key];
                  if (!m || (!m.title && !m.description)) return null;
                  return (
                    <div key={key} className="b-avoid">
                      <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">
                        {label}
                        {m.title ? ` — ${m.title}` : ''}
                      </h3>
                      {m.description && (
                        <p className="mt-0.5 text-sm leading-snug text-slate-700">
                          {m.description}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Spécialités culinaires */}
              {d.culinary_specialties?.length > 0 && (
                <div className="b-avoid mt-4 rounded-xl bg-amber-50 p-3">
                  <h3 className="text-sm font-bold text-amber-800">🍽️ À goûter</h3>
                  <div className="mt-2 flex gap-3">
                    {food && (
                      <img
                        src={imgUrl(food)}
                        alt={d.culinary_specialties[0]?.name}
                        className="h-20 w-20 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <ul className="space-y-1 text-sm text-slate-700">
                      {d.culinary_specialties.slice(0, 2).map((s, k) => (
                        <li key={k}>
                          <span className="font-semibold">{s.name}</span>
                          {s.description ? ` — ${s.description}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Hébergement + trajet + total */}
              <div className="b-avoid mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {d.accommodation?.name && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="font-semibold text-slate-800">🏨 {d.accommodation.name}</p>
                    <p className="text-slate-500">
                      {d.accommodation.type}
                      {d.accommodation.price_eur ? ` • ${eur(d.accommodation.price_eur)}` : ''}
                    </p>
                  </div>
                )}
                {nextTrip && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="font-semibold text-slate-800">
                      🚗 {nextTrip.from} → {nextTrip.to}
                    </p>
                    <p className="text-slate-500">
                      {nextTrip.distance_km ? `${nextTrip.distance_km} km` : ''}
                      {nextTrip.duration ? ` • ${nextTrip.duration}` : ''}
                      {nextTrip.estimated_cost_eur ? ` • ${eur(nextTrip.estimated_cost_eur)}` : ''}
                    </p>
                  </div>
                )}
              </div>
              {d.day_total_eur != null && (
                <p className="mt-3 text-right text-sm font-semibold text-slate-600">
                  Budget du jour : {eur(d.day_total_eur)}
                </p>
              )}
              </div>
              </FitToPage>
            </section>
          );
        })}

        {/* ---------- BUDGET & CONSEILS ---------- */}
        <section className="brochure-page rounded-2xl bg-white p-8 shadow">
          <h2 className="font-serif text-2xl font-bold text-slate-900">💶 Budget prévisionnel</h2>
          <table className="mt-4 w-full text-sm">
            <tbody>
              {[
                ['Transports', budget.trips_eur],
                ['Carburant', budget.fuel_eur],
                ['Péages', budget.tolls_eur],
                ['Ferries', budget.ferries_eur],
                ['Hébergement', budget.accommodation_eur],
                ['Repas', budget.meals_eur],
                ['Activités', budget.activities_eur],
              ]
                .filter(([, v]) => v != null && v !== 0)
                .map(([label, v]) => (
                  <tr key={label} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-600">{label}</td>
                    <td className="py-1.5 text-right font-medium text-slate-800">{eur(v)}</td>
                  </tr>
                ))}
              <tr className="border-t-2 border-slate-300">
                <td className="py-2 font-bold text-slate-900">Total estimé</td>
                <td className="py-2 text-right font-bold text-brand-700">
                  {eur(budget.grand_total_eur)}
                </td>
              </tr>
              {budget.per_person_eur != null && (
                <tr>
                  <td className="py-1 text-slate-500">par personne</td>
                  <td className="py-1 text-right text-slate-500">{eur(budget.per_person_eur)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {notes.practical_tips?.length > 0 && (
            <div className="mt-6">
              <h3 className="font-serif text-lg font-bold text-slate-900">💡 Conseils pratiques</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {notes.practical_tips.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {notes.packing_list && (
            <div className="mt-6">
              <h3 className="font-serif text-lg font-bold text-slate-900">🎒 Liste de bagages</h3>
              <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-slate-700">
                {[
                  ['Essentiels', notes.packing_list.essentials],
                  ['Vêtements', notes.packing_list.clothing],
                  ['Papiers & tech', notes.packing_list.tech_and_papers],
                  ['Spécifique véhicule', notes.packing_list.vehicle_specific],
                  ['Spécifique activités', notes.packing_list.activities_specific],
                ]
                  .filter(([, arr]) => arr?.length)
                  .map(([label, arr]) => (
                    <div key={label}>
                      <p className="font-semibold text-slate-800">{label}</p>
                      <ul className="list-disc pl-4">
                        {arr.map((x, k) => (
                          <li key={k}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-slate-400">
            Brochure générée par TravelO • Prix et disponibilités à vérifier au moment de réserver
          </p>
        </section>
      </div>
    </div>
  );
}
