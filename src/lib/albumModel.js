// Constantes et fonctions partagées entre l'album d'un voyage (AlbumPage) et
// l'album créé de zéro (StandaloneAlbumPage). Regroupées ici pour que les
// fichiers de pages n'exportent que des composants (fast refresh).

export const FORMAT_LABELS = {
  carre: 'Livre carré 21 × 21 cm',
  a4paysage: 'A4 paysage 29,7 × 21 cm',
  a4portrait: 'A4 portrait 21 × 29,7 cm',
};

// Doit correspondre à PHOTOS_PER_PAGE dans AlbumPdfDoc.jsx.
export const PHOTOS_PER_PAGE = 6;

export function balancedSplit(total, pages) {
  const p = Math.max(1, pages);
  const base = Math.floor(total / p);
  const rem = total - base * p;
  return Array.from({ length: p }, (_, k) => base + (k < rem ? 1 : 0));
}

// Nombre de photos par page : choix manuel valide, sinon réparti équitablement.
export function computeSplit(total, manual) {
  if (total <= PHOTOS_PER_PAGE) return [total];
  if (
    Array.isArray(manual) &&
    manual.length &&
    manual.every((n) => n > 0) &&
    manual.reduce((a, b) => a + b, 0) === total
  ) {
    return manual;
  }
  return balancedSplit(total, Math.ceil(total / PHOTOS_PER_PAGE));
}

// Palette de couleurs de fond proposée (beiges, neutres, et quelques teintes).
export const BG_COLORS = ['#FBF8F3', '#F3ECDD', '#E7E0D4', '#D9C9A8', '#C8643C', '#0F4C45', '#27408B', '#1C2B2D'];

// Renvoie un objet de fond exploitable (gère l'ancien format où bg était
// directement une photo).
export function normalizeBg(bg) {
  if (bg && bg.full) {
    return { mode: 'perPage', spread: { type: 'none' }, pages: [{ type: 'photo', photo: bg, toned: true }] };
  }
  return bg || { mode: 'perPage', spread: { type: 'none' }, pages: [] };
}
