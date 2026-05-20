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
