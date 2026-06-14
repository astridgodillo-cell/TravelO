// Fabrique une IMAGE (PNG data URL) de la carte du parcours à partir des
// mêmes tuiles que l'app (getTileUrl) — donc avec la clé qui FONCTIONNE.
// Utilisé pour la brochure PDF (react-pdf ne sait afficher qu'une image).
// On assemble les tuiles sur un <canvas>, puis on dessine le tracé + les
// marqueurs numérotés, et on exporte en PNG.
import { getTileUrl } from './mapTiles';

const TILE = 256; // les tuiles de l'app sont en 256px (Leaflet par défaut)

const lngToX = (lng, z) => ((lng + 180) / 360) * Math.pow(2, z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
};

function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // indispensable pour exporter le canvas
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function renderRouteMapImage(points, opts = {}) {
  const pts = (points || []).filter(
    (p) => p && typeof p.lat === 'number' && typeof p.lng === 'number'
  );
  if (!pts.length || typeof document === 'undefined') return null;

  const W = opts.width || 1000;
  const H = opts.height || 620;
  const accent = opts.accent || '#C8A04B';
  const pad = opts.padding || 70;
  const tpl = getTileUrl();
  if (!tpl) return null;

  const minLng = Math.min(...pts.map((p) => p.lng));
  const maxLng = Math.max(...pts.map((p) => p.lng));
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));

  // Zoom maximal qui fait tenir toutes les étapes dans la zone (avec marge).
  let zoom = 2;
  for (let z = 18; z >= 2; z--) {
    const dx = (lngToX(maxLng, z) - lngToX(minLng, z)) * TILE;
    const dy = (latToY(minLat, z) - latToY(maxLat, z)) * TILE; // lat inversé
    if (dx <= W - 2 * pad && dy <= H - 2 * pad) { zoom = z; break; }
  }
  if (pts.length === 1) zoom = Math.min(zoom, 11);

  const centerX = lngToX((minLng + maxLng) / 2, zoom) * TILE;
  const centerY = latToY((minLat + maxLat) / 2, zoom) * TILE;
  const topLeftX = centerX - W / 2;
  const topLeftY = centerY - H / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9e6df';
  ctx.fillRect(0, 0, W, H);

  const n = Math.pow(2, zoom);
  const xT0 = Math.floor(topLeftX / TILE);
  const xT1 = Math.floor((topLeftX + W) / TILE);
  const yT0 = Math.floor(topLeftY / TILE);
  const yT1 = Math.floor((topLeftY + H) / TILE);

  const jobs = [];
  for (let xt = xT0; xt <= xT1; xt++) {
    for (let yt = yT0; yt <= yT1; yt++) {
      if (yt < 0 || yt >= n) continue;
      const X = ((xt % n) + n) % n;
      const url = tpl
        .replace('{z}', zoom).replace('{x}', X).replace('{y}', yt)
        .replace('{s}', 'a');
      jobs.push(
        loadImg(url).then((img) => {
          if (img) ctx.drawImage(img, xt * TILE - topLeftX, yt * TILE - topLeftY, TILE, TILE);
        })
      );
    }
  }
  await Promise.all(jobs);

  const proj = pts.map((p) => ({
    x: lngToX(p.lng, zoom) * TILE - topLeftX,
    y: latToY(p.lat, zoom) * TILE - topLeftY,
  }));

  // Tracé reliant les étapes
  if (proj.length > 1) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    proj.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Marqueurs numérotés
  proj.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), pt.x, pt.y + 0.5);
  });

  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    // canvas « tainted » (tuiles sans CORS) → on renonce proprement
    return null;
  }
}
