// Sélection centralisée du fournisseur de tiles de carte.
//
// Priorité :
//   1. Si VITE_MAPTILER_KEY est définie → MapTiler streets-v2 avec lang=fr
//      → labels en français dans le monde entier (Japon → "Tokyo", etc.)
//      → gratuit jusqu'à 100k tiles/mois, clé à créer sur maptiler.com
//   2. Sinon → tile.openstreetmap.fr (OSM France)
//      → labels en français pour l'Europe / pays francophones
//      → ailleurs (Asie, etc.) garde la langue locale
//
// Pour activer le mode 1, ajouter dans Vercel → Settings → Environment Variables :
//   VITE_MAPTILER_KEY = <ta_clé_maptiler>
// puis redéployer.

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

export function getTileUrl() {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}&lang=fr`;
  }
  return 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png';
}

export function getTileAttribution() {
  if (MAPTILER_KEY) {
    return '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  }
  return '&copy; <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a>';
}

// Indique si une clé MapTiler est dispo (les cartes statiques pour la
// brochure imprimable nécessitent MapTiler — les tiles Leaflet ne
// s'impriment pas de façon fiable).
export function hasStaticMaps() {
  return Boolean(MAPTILER_KEY);
}

// Carte statique (image PNG) centrée sur un point — pour l'impression /
// la brochure. Retourne null si aucune clé MapTiler n'est configurée.
export function getStaticMapUrl(lat, lng, { zoom = 11, width = 800, height = 450 } = {}) {
  if (!MAPTILER_KEY || lat == null || lng == null) return null;
  // Format MapTiler : /static/{lon},{lat},{zoom}/{w}x{h}@2x.png
  return (
    `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},${zoom}/${width}x${height}@2x.png` +
    `?key=${MAPTILER_KEY}&markers=${lng},${lat}`
  );
}

// Carte statique d'ensemble : cadrage automatique sur tous les points, avec
// un marqueur par étape. Retourne null sans clé.
export function getStaticRouteMapUrl(points, { width = 800, height = 600 } = {}) {
  if (!MAPTILER_KEY || !Array.isArray(points) || points.length === 0) return null;
  const valid = points.filter((p) => p && p.lat != null && p.lng != null);
  if (!valid.length) return null;
  const markers = valid.map((p) => `${p.lng},${p.lat}`).join('|');
  // Un seul point : on centre dessus ; sinon cadrage auto sur les marqueurs.
  if (valid.length === 1) {
    const p = valid[0];
    return (
      `https://api.maptiler.com/maps/streets-v2/static/${p.lng},${p.lat},9/${width}x${height}@2x.png` +
      `?key=${MAPTILER_KEY}&markers=${markers}`
    );
  }
  return (
    `https://api.maptiler.com/maps/streets-v2/static/auto/${width}x${height}@2x.png` +
    `?key=${MAPTILER_KEY}&markers=${markers}`
  );
}

// Lien Google Maps "itinéraire" passant par toutes les étapes dans l'ordre.
export function getGoogleMapsRouteLink(points) {
  const valid = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  if (!valid.length) return null;
  const path = valid.map((p) => `${p.lat},${p.lng}`).join('/');
  return `https://www.google.com/maps/dir/${path}`;
}
