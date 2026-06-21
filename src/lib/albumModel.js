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

function estimateHeaderMm(title, note, firstPage, contentWmm) {
  if (!firstPage) return 18;
  let hh = 12;
  if (title) {
    const perLine = Math.max(14, Math.floor(contentWmm / 4.6));
    hh += Math.max(1, Math.ceil((title || '').length / perLine)) * 9.5;
  }
  if (note) {
    const perLine = Math.max(24, Math.floor(contentWmm / 2.0));
    hh += 6 + Math.ceil((note || '').length / perLine) * 6;
  }
  return hh + 12;
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

// Renvoie les rectangles des photos d'UNE page, en FRACTIONS de la page (0..1),
// afin que l'éditeur affiche les photos là où le PDF les imprimera.
export function pageLayout(photos, format, title, note, firstPage) {
  const dims = FORMAT_DIMS[format] || FORMAT_DIMS.carre;
  const pageW = mm(dims.trimW + BLEED_MM * 2);
  const pageH = mm(dims.trimH + BLEED_MM * 2);
  const pad = mm(PAD_MM);
  const gap = mm(GAP_MM);
  const contentW = pageW - pad * 2;
  const headerMm = estimateHeaderMm(title, note, firstPage, contentW / MM);
  const availH = Math.max(mm(45), pageH - pad * 2 - mm(headerMm) - mm(4));
  const rows = buildFillLayout(photos, contentW, availH, gap);
  const vgaps = gap * Math.max(0, rows.length - 1);
  const sumNatural = rows.reduce((s, r) => s + r.naturalH, 0);
  let f = sumNatural > 0 ? (availH - vgaps) / sumNatural : 1;
  if (!Number.isFinite(f) || f <= 0) f = 1;
  f = Math.min(f, 1.18);
  const cells = [];
  let y = pad + mm(headerMm) + gap;
  for (const row of rows) {
    const h = row.naturalH * f;
    let x = pad;
    for (const ar of row.ars) {
      const w = ar * row.naturalH;
      cells.push({ xf: x / pageW, yf: y / pageH, wf: w / pageW, hf: h / pageH });
      x += w + gap;
    }
    y += h + gap;
  }
  return { ratio: pageW / pageH, cells };
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

// Effets/filtres applicables à une photo.
//  - cat   : 'filtre' (couleur) ou 'cadre' (décoratif) — pour le rangement ;
//  - css   : filtre couleur (syntaxe CSS, réutilisée pour le canvas) ;
//  - frame : cadre dessiné dans le PDF.
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
  { id: 'noircadre', label: 'Cadre fin noir', cat: 'cadre', css: '', frame: 'thin' },
  { id: 'bois', label: 'Cadre bois', cat: 'cadre', css: '', frame: 'wood' },
  { id: 'or', label: 'Cadre doré', cat: 'cadre', css: '', frame: 'gold' },
  { id: 'stamp', label: 'Timbre', cat: 'cadre', css: '', frame: 'stamp' },
  { id: 'film', label: 'Pellicule', cat: 'cadre', css: '', frame: 'film' },
  { id: 'parchemin', label: 'Parchemin', cat: 'cadre', css: 'sepia(0.6) contrast(0.95) brightness(1.05)', frame: 'parchment' },
];

export function getPhotoEffect(id) {
  return PHOTO_EFFECTS.find((e) => e.id === id) || PHOTO_EFFECTS[0];
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

// Stickers/emojis proposés pour décorer les photos.
export const STICKER_EMOJIS = [
  '❤️', '💛', '💚', '💙', '💜', '🧡', '⭐', '✨', '🌟', '💫',
  '😍', '😎', '🥰', '😂', '🤩', '😜', '🥳', '😘', '🤗', '😌',
  '✈️', '🧳', '🗺️', '📍', '🏖️', '⛰️', '🏝️', '🚗', '🚂', '⛵',
  '☀️', '🌈', '⛅', '🌙', '🔥', '❄️', '🌊', '🌴', '🌸', '🍀',
  '📷', '🎉', '🎈', '🍷', '🍕', '🍦', '☕', '🍔', '🥐', '🍓',
  '👍', '🙌', '👏', '💪', '🤙', '✌️', '💋', '💖', '🏆', '🗯️',
];

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
