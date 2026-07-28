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

// Nombre de photos par page : choix manuel valide TOUJOURS prioritaire (aucune
// limite par page ; 0 autorisé = page vide en cours de composition) ; sinon
// répartition automatique à PHOTOS_PER_PAGE max.
export function computeSplit(total, manual) {
  if (
    Array.isArray(manual) &&
    manual.length &&
    manual.every((n) => Number.isFinite(n) && n >= 0) &&
    manual.reduce((a, b) => a + b, 0) === total
  ) {
    return manual;
  }
  if (total <= PHOTOS_PER_PAGE) return [total];
  return balancedSplit(total, Math.ceil(total / PHOTOS_PER_PAGE));
}

// ---- Mise en page d'une journée : deux modes ----
// « auto »   : l'appli répartit toute seule (~PHOTOS_PER_PAGE par page).
// « manuel » : les pages sont des BOÎTES stables — chaque page garde ses
//              photos, rien ne se déplace jamais tout seul.
// Les anciens albums sans champ layoutMode : toute personnalisation
// (répartition, verrou, disposition libre) => manuel, pour figer l'existant.
export function isManualLayout(entry) {
  if (!entry) return false;
  if (entry.layoutMode === 'manuel') return true;
  if (entry.layoutMode === 'auto') return false;
  return (
    (Array.isArray(entry.split) && entry.split.length > 0) ||
    Object.values(entry.lockedPages || {}).some(Boolean) ||
    Object.keys(entry.freePages || {}).length > 0
  );
}

// Rend une répartition manuelle VALIDE (somme = nombre de photos), en
// absorbant tout écart sur la dernière page — jamais de recalcul global.
export function repairSplit(split, total) {
  const counts = Array.isArray(split) && split.length && split.every((n) => Number.isFinite(n) && n >= 0)
    ? [...split]
    : [Math.max(0, total)];
  let sum = counts.reduce((a, b) => a + b, 0);
  if (sum < total) counts[counts.length - 1] += total - sum;
  else if (sum > total) {
    let over = sum - total;
    for (let k = counts.length - 1; k >= 0 && over > 0; k -= 1) {
      const take = Math.min(counts[k], over);
      counts[k] -= take;
      over -= take;
    }
  }
  return counts;
}

// Ajoute des photos à une journée en respectant son mode :
// - auto : simple ajout à la fin (la répartition se refait toute seule) ;
// - manuel : sur la page cible (targetPage) ou sur une NOUVELLE page à la fin
//   — les pages existantes gardent exactement leurs photos.
// Retire la photo d'index gi d'une journée en respectant son mode : en manuel,
// seule sa page est décomptée (page vidée conservée = boîte stable) ; en auto,
// la répartition se refait toute seule.
export function removePhotoFromEntry(entry, gi) {
  const total = (entry.photos || []).length;
  const photos = (entry.photos || []).filter((_, k) => k !== gi);
  if (!isManualLayout(entry)) return { photos, split: null };
  const counts = repairSplit(entry.split, total);
  let acc = 0;
  let page = counts.length - 1;
  for (let k = 0; k < counts.length; k += 1) {
    acc += counts[k];
    if (gi < acc) { page = k; break; }
  }
  counts[page] = Math.max(0, counts[page] - 1);
  return { photos, split: counts, layoutMode: 'manuel' };
}

// Applique un même effet/cadre à toutes les photos d'une journée/étape (ou
// d'une seule de ses pages avec `onlyPage`). Les pages VERROUILLÉES ne sont
// jamais modifiées.
export function applyEffectToEntry(entry, effectKey, onlyPage = null) {
  const total = (entry.photos || []).length;
  if (!total) return entry;
  const counts = isManualLayout(entry) ? repairSplit(entry.split, total) : computeSplit(total, null);
  const locked = entry.lockedPages || {};
  const pageOf = (gi) => {
    let acc = 0;
    for (let k = 0; k < counts.length; k += 1) {
      acc += counts[k];
      if (gi < acc) return k;
    }
    return counts.length - 1;
  };
  const photos = entry.photos.map((ph, gi) => {
    const p = pageOf(gi);
    if (locked[p]) return ph;
    if (onlyPage != null && p !== onlyPage) return ph;
    return { ...ph, effect: effectKey };
  });
  return { ...entry, photos };
}

export function addPhotosToEntry(entry, added, targetPage = null) {
  if (!isManualLayout(entry)) {
    return { photos: [...(entry.photos || []), ...added], split: null };
  }
  const counts = repairSplit(entry.split, (entry.photos || []).length);
  if (targetPage == null || targetPage < 0 || targetPage >= counts.length) {
    return { photos: [...(entry.photos || []), ...added], split: [...counts, added.length], layoutMode: 'manuel' };
  }
  const at = counts.slice(0, targetPage + 1).reduce((a, b) => a + b, 0); // fin de la page cible
  const photos = [...(entry.photos || [])];
  photos.splice(at, 0, ...added);
  const next = [...counts];
  next[targetPage] += added.length;
  return { photos, split: next, layoutMode: 'manuel' };
}

// ---- Disposition des photos (partagée éditeur ⇄ PDF) ----
// Ces fonctions DOIVENT rester synchronisées avec AlbumPdfDoc (même algo).
const MM = 72 / 25.4;
const mm = (v) => v * MM;
const BLEED_MM = 3;
const PAD_MM = 12;
const GAP_MM = 2;
export const FORMAT_DIMS = {
  carre: { trimW: 210, trimH: 210 },
  a4paysage: { trimW: 297, trimH: 210 },
  a4portrait: { trimW: 210, trimH: 297 },
};

function partitionRows(ars, R) {
  const total = ars.reduce((a, b) => a + b, 0);
  const target = total / R;
  const rows = [];
  let i = 0;
  for (let r = 0; r < R; r++) {
    const remainingRows = R - r;
    const row = [];
    let acc = 0;
    while (i < ars.length && ars.length - i > remainingRows - 1) {
      row.push(i);
      acc += ars[i];
      i += 1;
      if (acc >= target && r < R - 1) break;
    }
    rows.push(row);
  }
  while (i < ars.length) rows[rows.length - 1].push(i++);
  return rows.filter((r) => r.length);
}

function buildFillLayout(photos, contentW, availH, gap) {
  const items = photos.map((p) => ({ ar: p.w && p.h ? p.w / p.h : 4 / 3 }));
  const n = items.length;
  if (!n) return [];
  const ars = items.map((it) => it.ar);
  let best = null;
  for (let R = 1; R <= n; R++) {
    const groups = partitionRows(ars, R);
    let naturalTotal = gap * (groups.length - 1);
    const rows = groups.map((idxs) => {
      const sumAr = idxs.reduce((s, k) => s + ars[k], 0);
      const w = contentW - gap * (idxs.length - 1);
      const hh = w / sumAr;
      naturalTotal += hh;
      return { idxs, naturalH: hh };
    });
    const diff = Math.abs(naturalTotal - availH);
    if (!best || diff < best.diff) best = { rows, diff };
  }
  return best.rows.map((r) => ({ naturalH: r.naturalH, ars: r.idxs.map((k) => ars[k]) }));
}

function estimateHeaderMm(title, note, firstPage, contentWmm, onPlate) {
  const plate = onPlate ? 8 : 0;
  if (!firstPage) return 18 + plate;
  let hh = 12;
  if (title) {
    const perLine = Math.max(14, Math.floor(contentWmm / 4.6));
    hh += Math.max(1, Math.ceil((title || '').length / perLine)) * 9.5;
  }
  if (note) {
    const perLine = Math.max(24, Math.floor(contentWmm / 2.0));
    hh += 6 + Math.ceil((note || '').length / perLine) * 6;
  }
  return hh + 12 + plate;
}

export function splitPhotos(photos, manual) {
  const counts = computeSplit((photos || []).length, manual);
  const out = [];
  let idx = 0;
  for (const c of counts) {
    out.push((photos || []).slice(idx, idx + c));
    idx += c;
  }
  return out.length ? out : [[]];
}

// Résout le fond d'une page donnée d'une journée :
//   bg = { mode:'perPage'|'spread', spread:<spec>, pages:[<spec>...] }
//   spec = { type:'none'|'color'|'photo', color?, photo?, toned?, span? }
// En mode 'perPage', une photo peut porter span=N : elle est alors étirée sur
// N pages consécutives (panorama local), à partir de sa page.
export function resolveBg(bg, pageIndex, pageCount) {
  if (!bg) return { type: 'none' };
  if (bg.full) return { type: 'photo', photo: bg, toned: true };
  if (bg.mode === 'spread') {
    const s = bg.spread || { type: 'none' };
    if (s.type === 'photo' && s.photo) {
      return { ...s, spreadIndex: pageIndex, spreadCount: pageCount };
    }
    return s;
  }
  const pages = bg.pages || [];
  // La page courante est-elle couverte par un panorama démarré plus tôt ?
  for (let q = pageIndex; q >= 0; q -= 1) {
    const sp = pages[q];
    const span = sp && sp.type === 'photo' ? sp.span || 1 : 1;
    if (span > 1) {
      if (q + span > pageIndex) {
        return { ...sp, spreadIndex: pageIndex - q, spreadCount: span };
      }
      break; // un groupe se terminait avant cette page → fond propre
    }
    if (q < pageIndex && sp && sp.type === 'photo') break;
  }
  return pages[pageIndex] || { type: 'none' };
}

// Le fond d'une journée est-il « vide » (aucun choix de l'utilisateur) ? Sert à
// ne poser des fonds automatiques que si l'utilisateur n'a rien défini.
export function bgIsEmpty(bg) {
  if (!bg) return true;
  if (bg.full) return false;
  if (bg.mode === 'spread') return !(bg.spread && bg.spread.type !== 'none');
  return !(bg.pages || []).some((p) => p && p.type !== 'none');
}

// Construit un fond « par page » où chaque page reçoit une photo DIFFÉRENTE du
// jour, tirée au hasard (jamais deux fois la même tant qu'il y a assez de
// photos). `toned` : voile beige clair par-dessus (lisibilité) si true.
export function autoBgFromPhotos(photos, pageCount, { toned = false } = {}) {
  const usable = (photos || []).filter((p) => p && (p.full || p.display));
  const idx = usable.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const pages = [];
  for (let p = 0; p < pageCount; p += 1) {
    const photo = usable[idx[p]];
    pages.push(photo ? { type: 'photo', photo, toned } : { type: 'none' });
  }
  return { mode: 'perPage', spread: { type: 'none' }, pages };
}

// Disposition complète d'UNE page, en points (unité du PDF). Une SEULE source
// de vérité, utilisée par le PDF ET par l'éditeur de décoration → ce que l'on
// construit dans la sandbox sort à l'identique dans le PDF.
export function pageLayout(photos, format, opts = {}) {
  const { title = '', note = '', firstPage = true, onPlate = false } = opts;
  const dims = FORMAT_DIMS[format] || FORMAT_DIMS.carre;
  const pageW = mm(dims.trimW + BLEED_MM * 2);
  const pageH = mm(dims.trimH + BLEED_MM * 2);
  const pad = mm(PAD_MM);
  const gap = mm(GAP_MM);
  const contentW = pageW - pad * 2;
  const headerMm = estimateHeaderMm(title, note, firstPage, contentW / MM, onPlate);
  const headerH = mm(headerMm);
  const availH = Math.max(mm(45), pageH - pad * 2 - headerH - mm(4));
  const rows = buildFillLayout(photos, contentW, availH, gap);
  const vgaps = gap * Math.max(0, rows.length - 1);
  const sumNatural = rows.reduce((s, r) => s + r.naturalH, 0);
  let f = sumNatural > 0 ? (availH - vgaps) / sumNatural : 1;
  if (!Number.isFinite(f) || f <= 0) f = 1;
  f = Math.min(f, 1.18);
  const cells = [];
  let y = pad + headerH + gap;
  for (const row of rows) {
    const h = row.naturalH * f;
    let x = pad;
    for (const ar of row.ars) {
      const w = ar * row.naturalH;
      cells.push({ x, y, w, h, ar });
      x += w + gap;
    }
    y += h + gap;
  }
  return { pageW, pageH, pad, gap, contentW, headerH, cells };
}

// Boîtes de « disposition libre » initialisées depuis la grille. En libre, la
// boîte garde le RATIO de la photo (photo entière, non recadrée) : sa taille
// doit donc être calculée avec ce ratio pour tenir DANS la case de la grille
// (et donc dans la page). Avant, seule la largeur de la case était reprise :
// une photo verticale posée dans une case horizontale devenait bien trop haute
// et débordait de la page (coupée à l'écran comme à l'impression).
export function seedFreeBoxes(photos, lay) {
  const minPage = Math.min(lay.pageW, lay.pageH);
  return (photos || []).map((p, k) => {
    const c = lay.cells[k] || { x: lay.pad, y: lay.pad, w: minPage * 0.4, h: minPage * 0.3 };
    const ar = p.w && p.h ? p.w / p.h : 4 / 3;
    const w = Math.min(c.w, c.h * ar); // largeur max qui tient dans la case en gardant le ratio
    return { xf: (c.x + c.w / 2) / lay.pageW, yf: (c.y + c.h / 2) / lay.pageH, scale: w / minPage, rot: 0 };
  });
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

// ---------------------------------------------------------------------------
// Cadres « forme » : la photo est DÉCOUPÉE selon une silhouette (cœur, étoile…).
// Chaque silhouette est une liste de points en POURCENTAGE (0..100) d'une boîte.
// Ces mêmes points servent à l'IDENTIQUE :
//   - dans l'éditeur, via une découpe CSS (clip-path: polygon(...)) ;
//   - dans le PDF, via un <Polygon> SVG utilisé comme masque (clipPath).
// → l'aperçu à l'écran et le fichier imprimé sont rigoureusement identiques.
function ellipsePts(n, start = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = start + (i / n) * Math.PI * 2;
    pts.push([+(50 + 50 * Math.cos(a)).toFixed(2), +(50 + 50 * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}
function regularPts(n, rotDeg = -90) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = ((rotDeg + (i * 360) / n) * Math.PI) / 180;
    pts.push([+(50 + 50 * Math.cos(a)).toFixed(2), +(50 + 50 * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}
function starPts(branches, rIn = 21) {
  const pts = [];
  for (let i = 0; i < branches * 2; i += 1) {
    const r = i % 2 === 0 ? 50 : rIn;
    const a = ((-90 + (i * 180) / branches) * Math.PI) / 180;
    pts.push([+(50 + r * Math.cos(a)).toFixed(2), +(50 + r * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}
function heartPts(n = 56) {
  const raw = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    raw.push([
      16 * Math.sin(t) ** 3,
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    ]);
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return raw.map(([x, y]) => [
    +(((x - minX) / (maxX - minX)) * 100).toFixed(2),
    +((1 - (y - minY) / (maxY - minY)) * 100).toFixed(2), // y inversé : pointe en bas
  ]);
}
function flowerPts(petals = 6, n = 72) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 33 + 17 * Math.cos(petals * a);
    pts.push([+(50 + r * Math.cos(a)).toFixed(2), +(50 + r * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}
function archPts() {
  const pts = [[0, 100], [0, 50]];
  for (let a = 180; a >= 0; a -= 10) {
    const r = (a * Math.PI) / 180;
    pts.push([+(50 + 50 * Math.cos(r)).toFixed(2), +(50 - 50 * Math.sin(r)).toFixed(2)]);
  }
  pts.push([100, 100]);
  return pts;
}

export const FRAME_SHAPES = {
  coeur: { label: 'Cœur', pts: heartPts() },
  etoile: { label: 'Étoile', pts: starPts(5) },
  etoile6: { label: 'Étoile 6 branches', pts: starPts(6, 27) },
  cercle: { label: 'Cercle', pts: ellipsePts(48) },
  hexagone: { label: 'Hexagone', pts: regularPts(6) },
  octogone: { label: 'Octogone', pts: regularPts(8, -67.5) },
  losange: { label: 'Losange', pts: [[50, 0], [100, 50], [50, 100], [0, 50]] },
  fleur: { label: 'Fleur', pts: flowerPts(6) },
  arche: { label: 'Arche', pts: archPts() },
  bouclier: { label: 'Blason', pts: [[6, 6], [94, 6], [94, 48], [88, 66], [72, 84], [50, 96], [28, 84], [12, 66], [6, 48]] },
};
export function getFrameShape(id) {
  return FRAME_SHAPES[id] || null;
}
// Découpe CSS (éditeur).
export function shapeClipCss(pts) {
  return `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
}
// Points absolus pour un masque SVG de w×h (PDF).
export function shapePointsPx(pts, w, h) {
  return pts.map(([x, y]) => `${((x / 100) * w).toFixed(2)},${((y / 100) * h).toFixed(2)}`).join(' ');
}

// Effets/filtres applicables à une photo.
//  - cat   : 'filtre' (couleur), 'cadre' (décoratif) ou 'forme' (découpe) ;
//  - css   : filtre couleur (syntaxe CSS, réutilisée pour le canvas) ;
//  - frame : cadre dessiné dans le PDF ('shape' = découpe selon `shape`).
export const PHOTO_EFFECTS = [
  { id: 'none', label: 'Aucun', cat: '', css: '', frame: null },
  // Filtres couleur
  { id: 'noir', label: 'Noir & blanc', cat: 'filtre', css: 'grayscale(1)', frame: null },
  { id: 'sepia', label: 'Sépia', cat: 'filtre', css: 'sepia(0.75)', frame: null },
  { id: 'vintage', label: 'Vintage', cat: 'filtre', css: 'sepia(0.4) contrast(1.12) saturate(1.25)', frame: null },
  { id: 'argentique', label: 'Argentique', cat: 'filtre', css: 'grayscale(0.25) sepia(0.25) contrast(1.15)', frame: null },
  { id: 'eclatant', label: 'Éclatant', cat: 'filtre', css: 'saturate(1.6) contrast(1.05)', frame: null },
  { id: 'pastel', label: 'Pastel', cat: 'filtre', css: 'saturate(0.7) brightness(1.08)', frame: null },
  { id: 'delave', label: 'Délavé', cat: 'filtre', css: 'contrast(0.85) brightness(1.12) saturate(0.85)', frame: null },
  { id: 'dramatique', label: 'Dramatique', cat: 'filtre', css: 'contrast(1.35) saturate(1.1) brightness(0.95)', frame: null },
  { id: 'lumineux', label: 'Lumineux', cat: 'filtre', css: 'brightness(1.12) contrast(1.05)', frame: null },
  { id: 'chaud', label: 'Chaud', cat: 'filtre', css: 'sepia(0.25) saturate(1.3) brightness(1.03)', frame: null },
  { id: 'froid', label: 'Froid', cat: 'filtre', css: 'saturate(1.1) hue-rotate(-15deg) brightness(1.03)', frame: null },
  { id: 'dore', label: 'Doré', cat: 'filtre', css: 'sepia(0.5) saturate(1.4) brightness(1.05)', frame: null },
  // Cadres décoratifs
  { id: 'bordure', label: 'Bordure blanche', cat: 'cadre', css: '', frame: 'border' },
  { id: 'postcard', label: 'Carte postale', cat: 'cadre', css: '', frame: 'postcard' },
  { id: 'polaroid', label: 'Polaroïd', cat: 'cadre', css: '', frame: 'polaroid' },
  { id: 'arrondi', label: 'Coins arrondis', cat: 'cadre', css: '', frame: 'rounded' },
  { id: 'noircadre', label: 'Cadre fin noir', cat: 'cadre', css: '', frame: 'thin', frameColor: '#111111' },
  // Cadres fins colorés (même finesse que le noir)
  { id: 'cadreblanc', label: 'Cadre fin blanc', cat: 'cadre', css: '', frame: 'thin', frameColor: '#FFFFFF' },
  { id: 'cadrerouge', label: 'Cadre fin rouge', cat: 'cadre', css: '', frame: 'thin', frameColor: '#D92B2B' },
  { id: 'cadreorange', label: 'Cadre fin orange', cat: 'cadre', css: '', frame: 'thin', frameColor: '#EA580C' },
  { id: 'cadrejaune', label: 'Cadre fin jaune', cat: 'cadre', css: '', frame: 'thin', frameColor: '#F2C614' },
  { id: 'cadrevert', label: 'Cadre fin vert', cat: 'cadre', css: '', frame: 'thin', frameColor: '#1E9E4A' },
  { id: 'cadrebleu', label: 'Cadre fin bleu', cat: 'cadre', css: '', frame: 'thin', frameColor: '#2563EB' },
  { id: 'cadreviolet', label: 'Cadre fin violet', cat: 'cadre', css: '', frame: 'thin', frameColor: '#7C3AED' },
  { id: 'cadrerose', label: 'Cadre fin rose', cat: 'cadre', css: '', frame: 'thin', frameColor: '#EC4899' },
  { id: 'bois', label: 'Cadre bois', cat: 'cadre', css: '', frame: 'wood' },
  { id: 'or', label: 'Cadre doré', cat: 'cadre', css: '', frame: 'gold' },
  { id: 'stamp', label: 'Timbre', cat: 'cadre', css: '', frame: 'stamp' },
  { id: 'film', label: 'Pellicule', cat: 'cadre', css: '', frame: 'film' },
  { id: 'parchemin', label: 'Parchemin', cat: 'cadre', css: 'sepia(0.6) contrast(0.95) brightness(1.05)', frame: 'parchment' },
  // Découpes en forme (la photo prend la silhouette ; coins transparents)
  { id: 'fcoeur', label: 'Cœur', cat: 'forme', css: '', frame: 'shape', shape: 'coeur' },
  { id: 'fetoile', label: 'Étoile', cat: 'forme', css: '', frame: 'shape', shape: 'etoile' },
  { id: 'fetoile6', label: 'Étoile 6 branches', cat: 'forme', css: '', frame: 'shape', shape: 'etoile6' },
  { id: 'fcercle', label: 'Cercle', cat: 'forme', css: '', frame: 'shape', shape: 'cercle' },
  { id: 'fhexagone', label: 'Hexagone', cat: 'forme', css: '', frame: 'shape', shape: 'hexagone' },
  { id: 'foctogone', label: 'Octogone', cat: 'forme', css: '', frame: 'shape', shape: 'octogone' },
  { id: 'flosange', label: 'Losange', cat: 'forme', css: '', frame: 'shape', shape: 'losange' },
  { id: 'ffleur', label: 'Fleur', cat: 'forme', css: '', frame: 'shape', shape: 'fleur' },
  { id: 'farche', label: 'Arche', cat: 'forme', css: '', frame: 'shape', shape: 'arche' },
  { id: 'fbouclier', label: 'Blason', cat: 'forme', css: '', frame: 'shape', shape: 'bouclier' },
];

export function getPhotoEffect(id) {
  return PHOTO_EFFECTS.find((e) => e.id === id) || PHOTO_EFFECTS[0];
}

// Modes de transport proposés entre deux étapes de la carte du voyage.
// `dash: true` → trait en pointillés (liaisons aériennes/maritimes).
export const MAP_TRANSPORTS = [
  { id: 'avion', emoji: '✈️', label: 'Avion', dash: true },
  { id: 'voiture', emoji: '🚗', label: 'Voiture' },
  { id: 'train', emoji: '🚆', label: 'Train' },
  { id: 'bus', emoji: '🚌', label: 'Bus' },
  { id: 'bateau', emoji: '⛵', label: 'Bateau', dash: true },
  { id: 'velo', emoji: '🚲', label: 'Vélo' },
  { id: 'marche', emoji: '🚶', label: 'À pied' },
  { id: 'scooter', emoji: '🛵', label: 'Scooter' },
];
export const getMapTransport = (id) => MAP_TRANSPORTS.find((t) => t.id === id) || null;

// Cadrage d'une photo DANS sa case : point de mire (fx,fy ∈ 0..1) + zoom
// (fz ≥ 1). Permet de choisir la zone visible quand la photo est rognée
// (« cover ») ou découpée par un cadre/forme. Valeurs par défaut = centre.
export function photoFocal(p) {
  const c = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
  return { fx: c(p?.fx), fy: c(p?.fy), fz: Math.max(1, Number.isFinite(p?.fz) ? p.fz : 1) };
}

// Marge intérieure d'un cadre, en FRACTIONS de la case (haut/droite/bas/gauche).
// Source unique partagée éditeur ⇄ PDF → la zone photo est rigoureusement la
// même des deux côtés.
export function frameInsetFrac(frame) {
  switch (frame) {
    case 'border': case 'postcard': case 'gold': case 'parchment':
      return { t: 0.05, r: 0.05, b: 0.05, l: 0.05 };
    case 'wood': return { t: 0.06, r: 0.06, b: 0.06, l: 0.06 };
    case 'polaroid': return { t: 0.05, r: 0.05, b: 0.16, l: 0.05 };
    case 'stamp': return { t: 0.07, r: 0.07, b: 0.07, l: 0.07 };
    case 'film': return { t: 0.12, r: 0.012, b: 0.12, l: 0.012 };
    default: return { t: 0, r: 0, b: 0, l: 0 };
  }
}

// Calcule, en FRACTIONS de la case (conteneur de ratio cAr), la taille et la
// position d'une image (ratio iAr) affichée en « cover » avec point de mire
// (fx,fy) et zoom fz. Utilisé À L'IDENTIQUE par l'éditeur (CSS %) et le PDF.
export function coverFrac(cAr, iAr, fx = 0.5, fy = 0.5, fz = 1) {
  let w; let h;
  if (iAr > cAr) { h = 1; w = iAr / cAr; } else { w = 1; h = cAr / iAr; }
  w *= fz; h *= fz;
  return { w, h, left: -(w - 1) * fx, top: -(h - 1) * fy };
}

// Thèmes d'album : ambiance appliquée à tout l'album (fond + couleur d'accent +
// motif décoratif léger sur les pages qui n'ont pas leur propre fond).
//   pattern : 'none' | 'dots' | 'grid' | 'diagonal' | 'confetti'
export const ALBUM_THEMES = [
  { id: 'classique', label: 'Classique', paper: '#FBF8F3', ink: '#1C2B2D', accent: '#C8643C', pattern: 'none' },
  { id: 'kraft', label: 'Kraft', paper: '#DAC6A6', ink: '#43331F', accent: '#9C6B3F', pattern: 'none' },
  { id: 'pois', label: 'Pois', paper: '#FCF7F0', ink: '#26303A', accent: '#2A9D8F', pattern: 'dots', patternColor: '#E7DDCB' },
  { id: 'quadrille', label: 'Quadrillé', paper: '#FBFBF8', ink: '#2B2B2B', accent: '#3D6B9E', pattern: 'grid', patternColor: '#E6E6DF' },
  { id: 'marine', label: 'Marine', paper: '#EEF3F8', ink: '#16263B', accent: '#27496B', pattern: 'diagonal', patternColor: '#DAE5F0' },
  { id: 'tropical', label: 'Tropical', paper: '#F1FAF3', ink: '#14342B', accent: '#E0683C', pattern: 'dots', patternColor: '#D5EAD7' },
  { id: 'rose', label: 'Poudré', paper: '#FDF3F1', ink: '#3A2630', accent: '#D86C8E', pattern: 'dots', patternColor: '#F3DDDD' },
  { id: 'confetti', label: 'Confetti', paper: '#FFFDF6', ink: '#2A2A33', accent: '#EC4899', pattern: 'confetti', patternColor: '#F3C969' },
];

export function getTheme(id) {
  return ALBUM_THEMES.find((t) => t.id === id) || ALBUM_THEMES[0];
}

// Unité d'une section d'album : journée ou étape.
export function unitLabel(unit) {
  return unit === 'etape' ? 'Étape' : 'Jour';
}

// Polices proposées pour les textes et les bulles. `css` = pile de polices pour
// l'aperçu (navigateur) ; `pdf` = famille enregistrée dans AlbumPdfDoc.
export const FONT_CHOICES = [
  { key: 'display', label: 'Élégante', css: "'Spectral', Georgia, 'Times New Roman', serif", pdf: 'AlbumDisplay' },
  { key: 'sans', label: 'Simple', css: "'Lato', system-ui, Arial, sans-serif", pdf: 'AlbumBody' },
  { key: 'hand', label: 'Manuscrite', css: "'Patrick Hand', 'Segoe Script', cursive", pdf: 'AlbumHand' },
  { key: 'comic', label: 'BD', css: "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', cursive", pdf: 'AlbumComic' },
];
export function fontCss(key) {
  return (FONT_CHOICES.find((f) => f.key === key) || FONT_CHOICES[0]).css;
}
export function fontPdf(key) {
  return (FONT_CHOICES.find((f) => f.key === key) || FONT_CHOICES[0]).pdf;
}

// Géométrie d'une bulle de BD (ellipse + queue), dans un repère centré sur 0,
// base 100 (ellipse rx=50, ry=30). `tailAngleDeg` : direction de la queue
// (0 = droite, 90 = bas). `tailLen` : longueur de la queue (fraction de 100).
// Renvoie le viewBox (carré centré) et les points de la queue.
export function computeBubble(tailAngleDeg = 215, tailLen = 0.35) {
  const rx = 50;
  const ry = 30;
  const L = Math.max(0, tailLen) * 100;
  const baseHalf = 14 * (Math.PI / 180);
  const th = (tailAngleDeg * Math.PI) / 180;
  const edge = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2);
  };
  const Re = edge(th);
  const tip = { x: Math.cos(th) * (Re + L), y: Math.sin(th) * (Re + L) };
  const a1 = th - baseHalf;
  const a2 = th + baseHalf;
  const r1 = edge(a1) * 0.94;
  const r2 = edge(a2) * 0.94;
  const b1 = { x: Math.cos(a1) * r1, y: Math.sin(a1) * r1 };
  const b2 = { x: Math.cos(a2) * r2, y: Math.sin(a2) * r2 };
  const half = Math.max(rx, ry, Re + L) + 6;
  return { rx, ry, tip, b1, b2, vb: { x: -half, y: -half, w: 2 * half, h: 2 * half } };
}
export function formatDateRange(start, end) {
  const f = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return ''; }
  };
  const a = f(start);
  const b = f(end);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b || '';
}

// Emojis/stickers proposés pour décorer, classés par catégories.
export const STICKER_CATEGORIES = [
  {
    key: 'emotions', label: '😍', name: 'Émotions',
    emojis: ['😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '😜', '🤪', '😝', '🤗', '🤔', '🤨', '😐', '😴', '😌', '😏', '🙄', '😬', '😮', '😯', '😲', '🥹', '🥺', '😢', '😭', '😤', '😠', '🤯', '😳', '🥵', '🥶', '😱', '🤭', '🤫', '🤓', '🧐', '😶', '😺', '🙀', '💩', '🤡', '👻', '💀', '👽', '🤖'],
  },
  {
    key: 'coeurs', label: '❤️', name: 'Cœurs',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💖', '💗', '💓', '💞', '💕', '💘', '💝', '💟', '❣️', '💔', '❤️‍🔥', '💋', '⭐', '🌟', '✨', '💫', '🌠', '🔥', '💥', '💯', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🎀'],
  },
  {
    key: 'voyage', label: '✈️', name: 'Voyage',
    emojis: ['✈️', '🛫', '🛬', '🛩️', '🚀', '🚁', '⛵', '🚤', '🛥️', '🚢', '🚗', '🚕', '🚙', '🚐', '🏎️', '🚓', '🏍️', '🛵', '🚲', '🚂', '🚆', '🚊', '🚌', '🗺️', '🧭', '📍', '📌', '🧳', '🎒', '🏕️', '⛺', '🏖️', '🏝️', '🏜️', '⛰️', '🏔️', '🗻', '🌋', '🏞️', '🏛️', '🗽', '🗼', '🏰', '🎡', '🎢', '⛲', '🏨', '🏩', '⛱️', '🎫', '🛎️'],
  },
  {
    key: 'nature', label: '🌴', name: 'Nature & météo',
    emojis: ['☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '🌪️', '🌈', '☔', '💧', '🌊', '🌙', '🌛', '🌜', '🌝', '🌞', '⭐', '🌴', '🌳', '🌲', '🌵', '🌾', '🌻', '🌺', '🌸', '🌼', '🌷', '🌹', '💐', '🍀', '🍁', '🍂', '🍃', '🌿', '🌱', '🍄', '🐚', '🪸'],
  },
  {
    key: 'animaux', label: '🐶', name: 'Animaux',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄', '🐴', '🐔', '🐧', '🐦', '🦅', '🦉', '🦋', '🐝', '🐢', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐙', '🦀', '🐲', '🦕', '🐘', '🦒', '🦓', '🐪', '🦩', '🦜', '🕊️'],
  },
  {
    key: 'food', label: '🍕', name: 'Nourriture',
    emojis: ['☕', '🍵', '🧃', '🥤', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🍾', '🍽️', '🍕', '🍔', '🌭', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍣', '🍤', '🥟', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🧁', '🥐', '🥖', '🧀', '🍳', '🥞', '🍓', '🍒', '🍑', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🥥', '🍇'],
  },
  {
    key: 'activites', label: '🎉', name: 'Activités',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥊', '⛳', '⛷️', '🏂', '🏄', '🏊', '🚴', '🚵', '🧗', '🤿', '🎣', '🎿', '🛼', '🛹', '🎸', '🎺', '🎷', '🥁', '🎹', '🎤', '🎧', '🎬', '🎮', '🎲', '🎯', '🎨', '🎭', '🎪', '📸', '📷', '🎥', '🎟️'],
  },
  {
    key: 'symboles', label: '🔍', name: 'Symboles',
    emojis: ['🔍', '🔎', '💡', '🔦', '📣', '📢', '🔔', '✅', '☑️', '❌', '⭕', '❗', '❓', '💬', '🗯️', '💭', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '🔝', '🆕', '🆗', '🔥', '⚡', '💎', '🔑', '🗝️', '🔒', '⏰', '⌛', '📅', '📌', '📎', '✏️', '🖊️', '📝', '🏷️', '🎗️', '♻️', '⚠️', '☮️', '⚜️', '✔️', '➕', '➖', '✖️', '〰️', '©️'],
  },
  {
    key: 'drapeaux', label: '🏳️', name: 'Drapeaux',
    emojis: ['🏳️', '🏴', '🏁', '🚩', '🇫🇷', '🇧🇪', '🇨🇭', '🇨🇦', '🇪🇸', '🇮🇹', '🇩🇪', '🇬🇧', '🇺🇸', '🇵🇹', '🇳🇱', '🇬🇷', '🇮🇪', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇵🇱', '🇦🇹', '🇨🇿', '🇭🇺', '🇷🇴', '🇹🇷', '🇷🇺', '🇺🇦', '🇲🇦', '🇹🇳', '🇩🇿', '🇪🇬', '🇸🇳', '🇿🇦', '🇯🇵', '🇰🇷', '🇨🇳', '🇹🇭', '🇻🇳', '🇮🇩', '🇮🇳', '🇦🇺', '🇳🇿', '🇧🇷', '🇦🇷', '🇲🇽', '🇨🇱', '🇵🇪'],
  },
];

// Liste à plat (compat).
export const STICKER_EMOJIS = STICKER_CATEGORIES.flatMap((c) => c.emojis);

// URL d'image (Twemoji) pour un emoji → permet de l'imprimer en couleur dans
// le PDF (react-pdf n'affiche pas les emojis en couleur via une police).
export function twemojiUrl(emoji) {
  const cps = [...emoji]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((c) => c !== 'fe0f' && c !== '200d');
  if (!cps.length) return null;
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${cps.join('-')}.png`;
}

// Pour le PDF : renvoie une copie des photos où celles ayant un filtre couleur
// reçoivent une version filtrée (_fx, data URL). Les cadres décoratifs, eux,
// sont dessinés directement dans le PDF (pas besoin de retoucher l'image).
export async function bakePhotoEffects(photos) {
  const out = [];
  for (const p of photos || []) {
    const fx = getPhotoEffect(p.effect);
    if (fx.css) {
      const data = await renderEffectDataUrl(p.full || p.display, fx.css);
      out.push(data ? { ...p, _fx: data } : p);
    } else {
      out.push(p);
    }
  }
  return out;
}

// Applique un filtre couleur à une image (via canvas) et renvoie une data URL
// JPEG. Sert à « cuire » le filtre dans la photo pour le PDF (react-pdf ne sait
// pas appliquer de filtre CSS). Renvoie null en cas d'échec.
export function renderEffectDataUrl(srcUrl, cssFilter, maxDim = 2200) {
  return new Promise((resolve) => {
    if (!srcUrl || !cssFilter) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.filter = cssFilter;
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL('image/jpeg', 0.9));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = srcUrl;
  });
}
