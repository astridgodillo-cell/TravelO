import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTileUrl } from '../lib/mapTiles';
import { listItineraries } from '../lib/supabase';

function isValidCoord(c) {
  if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
  if (Math.abs(c.lat) < 0.5 && Math.abs(c.lng) < 0.5) return false; // (0,0)
  if (c.lat < -90 || c.lat > 90 || c.lng < -180 || c.lng > 180) return false;
  return true;
}

function dot() {
  return L.divIcon({
    className: 'travelo-travel-dot',
    html: `<div style="
      background:#2573eb;border-radius:50%;width:14px;height:14px;
      border:3px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.4);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function FitToBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (!points?.length) {
      map.setView([20, 10], 2);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 5);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
  }, [points, map]);
  return null;
}

export default function TravelMap() {
  const [trips, setTrips] = useState(null);

  useEffect(() => {
    listItineraries().then(({ data }) => setTrips(data || []));
  }, []);

  const { points, voyages, villes } = useMemo(() => {
    const list = trips || [];
    const pts = [];
    const cityNames = new Set();
    for (const t of list) {
      const days = t?.itinerary?.days || [];
      for (const day of days) {
        if (isValidCoord(day?.coordinates)) {
          pts.push({
            lat: day.coordinates.lat,
            lng: day.coordinates.lng,
            label: day.location,
          });
        }
        const name = (day?.location || '').toLowerCase().trim();
        if (name) cityNames.add(name);
      }
    }
    // Dédoublonne les points trop proches (mêmes coordonnées arrondies)
    const seen = new Set();
    const unique = [];
    for (const p of pts) {
      const k = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(p);
    }
    return { points: unique, voyages: list.length, villes: cityNames.size };
  }, [trips]);

  if (trips === null) {
    return <div className="text-center py-12 text-slate-500">Chargement…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat emoji="🌍" value={voyages} label={voyages > 1 ? 'voyages' : 'voyage'} />
        <Stat emoji="📍" value={villes} label={villes > 1 ? 'villes explorées' : 'ville explorée'} />
        <Stat emoji="🗺️" value={points.length} label="points sur la carte" />
      </div>

      {voyages === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          <div className="text-4xl mb-2">🧭</div>
          Ta carte est encore vierge ! Crée ton premier voyage et regarde le
          monde se remplir.
        </div>
      ) : (
        <>
          <div
            className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100"
            style={{ height: 420 }}
          >
            <MapContainer
              center={[20, 10]}
              zoom={2}
              scrollWheelZoom={false}
              worldCopyJump
              attributionControl={false}
              style={{ height: '100%', width: '100%' }}
            >
              <FitToBounds points={points} />
              <TileLayer url={getTileUrl()} />
              {points.map((p, i) => (
                <Marker
                  key={i}
                  position={[p.lat, p.lng]}
                  icon={dot()}
                  interactive={false}
                />
              ))}
            </MapContainer>
          </div>
          <p className="text-center text-sm text-slate-500">
            Chaque point est une étape de tes voyages. Continue à explorer le
            monde ! 🌏
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ emoji, value, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
      <div className="text-2xl">{emoji}</div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
