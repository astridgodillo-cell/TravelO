import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet marker icons (Vite ne packe pas leurs URL).
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

  const polyline = points.map((p) => [p.lat, p.lng]);

  return (
    <div className="card p-0 overflow-hidden">
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom={false}
        style={{ height: '500px', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={polyline}
          pathOptions={{ color: '#2573eb', weight: 3, opacity: 0.7, dashArray: '6,8' }}
        />
        {points.map((p, i) => (
          <Marker
            key={i}
            position={[p.lat, p.lng]}
            icon={dayIcon(
              p.label,
              i === 0,
              i === points.length - 1
            )}
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
  );
}

// Force Vite to bundle these style files for the print export.
export function ensureLeafletStyles() {
  return null;
}
