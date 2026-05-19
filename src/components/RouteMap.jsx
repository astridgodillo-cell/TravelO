import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FitToPoints({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    // Petit délai pour laisser Leaflet mesurer son conteneur après mount
    const t = setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 10);
      } else {
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [points, map]);
  return null;
}

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function dayIcon(label, isStart, isEnd) {
  const bg = isStart ? '#16a34a' : isEnd ? '#dc2626' : '#2573eb';
  return L.divIcon({
    className: 'travelo-day-marker',
    html: `<div style="
      background:${bg};
      color:white;
      border-radius:50%;
      width:30px;
      height:30px;
      display:grid;
      place-items:center;
      font-weight:700;
      font-size:12px;
      border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
    ">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

async function fetchSegmentGeometry(from, to, profile = 'driving') {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;
    return {
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance_km: Math.round(route.distance / 1000),
      duration_h: route.duration / 3600,
    };
  } catch (e) {
    console.warn('[osrm] segment fetch failed', e);
    return null;
  }
}

const cacheKey = (a, b) => `${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`;

export default function RouteMap({ itinerary }) {
  const points = useMemo(() => {
    if (!itinerary?.days) return [];
    return itinerary.days
      .map((d, i) => {
        const c = d.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') {
          return null;
        }
        return {
          index: i,
          label: d.label,
          location: d.location,
          date: d.date,
          weekday: d.weekday,
          accommodation: d.accommodation?.name,
          lat: c.lat,
          lng: c.lng,
          total: d.day_total_eur,
        };
      })
      .filter(Boolean);
  }, [itinerary]);

  const [segments, setSegments] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  // Choix du profil OSRM : car par défaut. Pas de profil "pied" pour des trips.
  const profile = 'driving';

  useEffect(() => {
    if (points.length < 2) {
      setSegments([]);
      return;
    }
    let active = true;
    setLoadingRoutes(true);
    setSegments(new Array(points.length - 1).fill(null));

    (async () => {
      const cache = new Map();
      const results = [];
      // Séquentiel pour respecter la limite du serveur OSRM public (~1 req/s)
      for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        const key = cacheKey(from, to);
        let seg = cache.get(key);
        if (!seg) {
          seg = await fetchSegmentGeometry(from, to, profile);
          if (seg) cache.set(key, seg);
        }
        if (!active) return;
        results.push(seg);
        // Mise à jour incrémentale pour voir le tracé apparaître segment par segment
        setSegments([...results, ...new Array(points.length - 1 - results.length).fill(null)]);
        // Petit délai pour rester sympa avec OSRM public
        await new Promise((r) => setTimeout(r, 250));
      }
      if (active) setLoadingRoutes(false);
    })();

    return () => {
      active = false;
    };
  }, [points]);

  if (!points.length) {
    return (
      <div className="card text-center text-slate-500">
        Pas de coordonnées disponibles pour afficher la carte.
        <p className="text-xs mt-2 text-slate-400">
          Les itinéraires plus anciens, générés avant cette fonctionnalité, n'ont
          pas de coordonnées. Régénérez-les pour les visualiser sur la carte.
        </p>
      </div>
    );
  }

  const center = [
    points.reduce((s, p) => s + p.lat, 0) / points.length,
    points.reduce((s, p) => s + p.lng, 0) / points.length,
  ];

  // Fallback : ligne pointillée tant que le routing n'est pas chargé
  const fallbackLine = points.map((p) => [p.lat, p.lng]);

  return (
    <div className="space-y-3">
      <div className="card p-0 overflow-hidden">
        <MapContainer
          center={center}
          zoom={6}
          scrollWheelZoom={false}
          style={{ height: '500px', width: '100%' }}
        >
          <FitToPoints points={points} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Tracé OSRM par segment */}
          {segments.map((seg, i) =>
            seg ? (
              <Polyline
                key={`seg-${i}`}
                positions={seg.geometry}
                pathOptions={{ color: '#2573eb', weight: 4, opacity: 0.85 }}
              />
            ) : null
          )}

          {/* Fallback dashed line si aucun segment chargé */}
          {segments.every((s) => !s) && (
            <Polyline
              positions={fallbackLine}
              pathOptions={{
                color: '#94a3b8',
                weight: 2,
                opacity: 0.6,
                dashArray: '6,8',
              }}
            />
          )}

          {points.map((p, i) => (
            <Marker
              key={i}
              position={[p.lat, p.lng]}
              icon={dayIcon(p.label, i === 0, i === points.length - 1)}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-bold">
                    {p.label} — {p.location}
                  </div>
                  <div className="text-slate-500 capitalize">
                    {p.weekday} {p.date}
                  </div>
                  {p.accommodation && (
                    <div className="mt-1">🏨 {p.accommodation}</div>
                  )}
                  {typeof p.total === 'number' && (
                    <div className="mt-1 font-semibold">
                      {p.total.toLocaleString('fr-FR')} €
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {loadingRoutes && (
        <p className="text-xs text-slate-500 text-center">
          Calcul du tracé routier en cours…
        </p>
      )}

      {/* Segments recap */}
      {points.length > 1 && (
        <SegmentsRecap points={points} segments={segments} />
      )}
    </div>
  );
}

function SegmentsRecap({ points, segments }) {
  const total = segments.reduce(
    (acc, s) => ({
      km: acc.km + (s?.distance_km || 0),
      h: acc.h + (s?.duration_h || 0),
    }),
    { km: 0, h: 0 }
  );

  return (
    <div className="card">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
        Récapitulatif des trajets (routing réel)
      </h3>
      <ul className="space-y-1.5 text-sm">
        {points.slice(0, -1).map((p, i) => {
          const next = points[i + 1];
          const seg = segments[i];
          return (
            <li
              key={i}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5 last:border-0"
            >
              <div className="text-slate-700">
                <span className="font-medium">{p.label}</span>
                <span className="text-slate-400 mx-1">→</span>
                <span className="font-medium">{next.label}</span>
                <span className="text-slate-500 ml-2">
                  {p.location} → {next.location}
                </span>
              </div>
              <div className="text-slate-600 text-xs">
                {seg
                  ? `${seg.distance_km} km · ${formatHours(seg.duration_h)}`
                  : '—'}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-slate-200 pt-3">
        <span className="font-semibold text-slate-900">Total</span>
        <span className="font-bold text-brand-700">
          {total.km.toLocaleString('fr-FR')} km · {formatHours(total.h)} de
          route
        </span>
      </div>
    </div>
  );
}

function formatHours(h) {
  if (!h && h !== 0) return '—';
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')}`;
}
