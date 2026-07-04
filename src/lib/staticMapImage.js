// Fabrique une IMAGE (PNG data URL) de la carte du parcours à partir des
// mêmes tuiles que l'app (getTileUrl) — donc avec la clé qui FONCTIONNE.
// Utilisé pour la brochure PDF (react-pdf ne sait afficher qu'une image).
// On assemble les tuiles sur un <canvas>, puis on dessine le tracé + les
// marqueurs numérotés, et on exporte en PNG.
import { getTileUrl } from './mapTiles';
import { getMapTransport } from './albumModel';

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

  // Tracé reliant les étapes : chaque segment est une COURBE douce (léger arc)
  // — pointillés pour les liaisons aériennes/maritimes. `opts.transports[i]`
  // est le mode de transport du trajet étape i → étape i+1.
  const transports = Array.isArray(opts.transports) ? opts.transports : [];
  // Point de contrôle (arc) et milieu de la courbe d'un segment.
  const segGeom = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const bow = Math.min(len * 0.16, 55); // courbure douce, bornée
    const cx = (a.x + b.x) / 2 - (dy / (len || 1)) * bow;
    const cy = (a.y + b.y) / 2 + (dx / (len || 1)) * bow;
    // milieu de la courbe quadratique (t = 0,5)
    const mx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
    const my = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
    return { cx, cy, mx, my, len };
  };
  if (proj.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < proj.length - 1; i += 1) {
      const a = proj[i];
      const b = proj[i + 1];
      const t = getMapTransport(transports[i]);
      const g = segGeom(a, b);
      // léger halo blanc sous le trait → lisible sur tout fond de carte
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(g.cx, g.cy, b.x, b.y);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      // trait principal
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(g.cx, g.cy, b.x, b.y);
      ctx.setLineDash(t?.dash ? [11, 9] : []);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
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

  // Pastilles transport : au MILIEU de chaque trajet, un rond blanc avec
  // l'emoji du mode de transport choisi (dessinées après les marqueurs pour
  // rester bien visibles).
  if (proj.length > 1) {
    for (let i = 0; i < proj.length - 1; i += 1) {
      const t = getMapTransport(transports[i]);
      if (!t) continue;
      const g = segGeom(proj[i], proj[i + 1]);
      if (g.len < 30) continue; // trajet minuscule : pas la place
      ctx.beginPath();
      ctx.arc(g.mx, g.my, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.font = '18px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.emoji, g.mx, g.my + 1);
    }
  }

  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    // canvas « tainted » (tuiles sans CORS) → on renonce proprement
    return null;
  }
}
