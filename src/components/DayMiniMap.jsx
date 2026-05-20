import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTileUrl } from '../lib/mapTiles';

// Lazy-mount via IntersectionObserver : on n'instancie le composant Leaflet
// que quand la carte est sur le point d'apparaître à l'écran. Sans ça,
// 20+ cartes simultanées plombent les longs voyages.

function pinIcon(label) {
  return L.divIcon({
    className: 'travelo-day-mini-marker',
    html: `<div style="
      background:#2573eb;
      color:white;
      border-radius:50%;
      width:26px;
      height:26px;
      display:grid;
      place-items:center;
      font-weight:700;
      font-size:11px;
      border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
    ">${label || '📍'}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function DayMiniMap({ coordinates, label, location }) {
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

  // Garde-fou : pas de coordonnées valides → on ne montre rien
  const c = coordinates;
  if (
    !c ||
    typeof c.lat !== 'number' ||
    typeof c.lng !== 'number' ||
    (Math.abs(c.lat) < 0.5 && Math.abs(c.lng) < 0.5) ||
    c.lat < -90 ||
    c.lat > 90 ||
    c.lng < -180 ||
    c.lng > 180
  ) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 print:hidden"
      style={{ height: 140 }}
      aria-label={`Carte : ${location || ''}`}
    >
      {visible ? (
        <MapContainer
          center={[c.lat, c.lng]}
          zoom={6}
          scrollWheelZoom={false}
          dragging={false}
          doubleClickZoom={false}
          touchZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url={getTileUrl()} />
          <Marker
            position={[c.lat, c.lng]}
            icon={pinIcon(label)}
            interactive={false}
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
