import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTileUrl } from '../lib/mapTiles';

// Lazy-mount via IntersectionObserver : on n'instancie le composant Leaflet
// que quand la carte est sur le point d'apparaître à l'écran. Sans ça,
// 20+ cartes simultanées plombent les longs voyages.

function isValidCoord(c) {
  if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
  if (Math.abs(c.lat) < 0.5 && Math.abs(c.lng) < 0.5) return false; // (0,0)
  if (c.lat < -90 || c.lat > 90 || c.lng < -180 || c.lng > 180) return false;
  return true;
}

function bigPin(label) {
  return L.divIcon({
    className: 'travelo-day-mini-current',
    html: `<div style="
      background:#2573eb;
      color:white;
      border-radius:50%;
      width:30px;
      height:30px;
      display:grid;
      place-items:center;
      font-weight:700;
      font-size:12px;
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    ">${label || '📍'}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function smallDot() {
  return L.divIcon({
    className: 'travelo-day-mini-dot',
    html: `<div style="
      background:rgba(100,116,139,0.85);
      border-radius:50%;
      width:10px;
      height:10px;
      border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

// Compose les bounds en englobant tous les jours du voyage,
// avec une marge en bas et au-dessus pour ne pas coller aux bords.
function FitToBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    let cancelled = false;
    const tryFit = (attempt = 0) => {
      if (cancelled) return;
      map.invalidateSize();
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 6);
      } else {
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 8 });
      }
      if (attempt < 2) {
        setTimeout(() => tryFit(attempt + 1), 250);
      }
    };
    const t = setTimeout(() => tryFit(0), 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [points, map]);
  return null;
}

export default function DayMiniMap({
  coordinates,
  label,
  location,
  allDays,
}) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  // Points : tous les jours valides + le point courant en plus si besoin
  const points = useMemo(() => {
    const list = [];
    if (Array.isArray(allDays)) {
      for (const d of allDays) {
        if (isValidCoord(d?.coordinates)) {
          list.push({
            lat: d.coordinates.lat,
            lng: d.coordinates.lng,
            label: d.label,
          });
        }
      }
    }
    // Garantit que le jour courant est dans la liste (au cas où il manquerait)
    if (isValidCoord(coordinates)) {
      const here = { lat: coordinates.lat, lng: coordinates.lng, label };
      const already = list.find(
        (p) => Math.abs(p.lat - here.lat) < 0.01 && Math.abs(p.lng - here.lng) < 0.01
      );
      if (!already) list.push(here);
    }
    return list;
  }, [allDays, coordinates, label]);

  if (!isValidCoord(coordinates) || points.length === 0) return null;

  const currentKey = `${coordinates.lat.toFixed(3)},${coordinates.lng.toFixed(3)}`;

  return (
    <div
      ref={containerRef}
      className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 w-full print:hidden relative"
      style={{ aspectRatio: '16 / 9' }}
      aria-label={`Carte : ${location || ''}`}
    >
      {visible ? (
        <MapContainer
          center={[coordinates.lat, coordinates.lng]}
          zoom={5}
          scrollWheelZoom={false}
          dragging={true}
          doubleClickZoom={true}
          touchZoom={true}
          zoomControl={true}
          attributionControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <FitToBounds points={points} />
          <TileLayer url={getTileUrl()} />
          {/* Autres jours en petits points gris (contexte) */}
          {points.map((p, i) => {
            const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
            if (key === currentKey) return null;
            return (
              <Marker
                key={`dot-${i}`}
                position={[p.lat, p.lng]}
                icon={smallDot()}
                interactive={false}
              />
            );
          })}
          {/* Jour courant en gros marker (rendu en dernier pour être au-dessus) */}
          <Marker
            position={[coordinates.lat, coordinates.lng]}
            icon={bigPin(label)}
            interactive={false}
            zIndexOffset={1000}
          />
        </MapContainer>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
          🗺️
        </div>
      )}
    </div>
  );
}
