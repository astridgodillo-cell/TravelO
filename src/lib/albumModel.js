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

// Palette de couleurs de fond proposée : neutres/beiges en tête, puis un large
// éventail de teintes (chaudes, froides, pastel, foncées).
export const BG_COLORS = [
  // Neutres & beiges
  '#FFFFFF', '#FBF8F3', '#F3ECDD', '#E7E0D4', '#D9C9A8', '#CDBFA6',
  '#F5F5F4', '#E5E7EB', '#9CA3AF', '#4B5563', '#1C2B2D', '#000000',
  // Rouges / oranges / jaunes
  '#FFE4E1', '#F8B4B4', '#E11D48', '#C8643C', '#EA580C', '#F59E0B',
  '#FDE68A', '#FACC15',
  // Verts / turquoise
  '#DCFCE7', '#86EFAC', '#22C55E', '#0F4C45', '#14B8A6', '#99F6E4',
  // Bleus
  '#DBEAFE', '#93C5FD', '#3B82F6', '#27408B', '#1E3A8A', '#0EA5E9',
  // Violets / roses
  '#EDE9FE', '#C4B5FD', '#8B5CF6', '#A21CAF', '#F0ABFC', '#EC4899',
  // Bruns / sable
  '#FEF3C7', '#D2B48C', '#A0522D', '#7C4A21',
];

// Renvoie un objet de fond exploitable (gère l'ancien format où bg était
// directement une photo).
export function normalizeBg(bg) {
  if (bg && bg.full) {
    return { mode: 'perPage', spread: { type: 'none' }, pages: [{ type: 'photo', photo: bg, toned: true }] };
  }
  return bg || { mode: 'perPage', spread: { type: 'none' }, pages: [] };
}
