/**
 * AlbumPdfDoc.jsx — Album de voyage imprimable (livre photo).
 * Construit avec @react-pdf/renderer.
 *
 * Props :
 *   - album  : { title, days: { [i]: { title, note, photos:[{full,display,caption}] } } }
 *   - days   : tableau des journées du voyage (pour l'ordre et le lieu)
 *   - format : 'carre' (21×21 cm) | 'a4paysage' (29,7×21 cm)
 *
 * Contraintes d'impression respectées :
 *   - dimensions définies en MILLIMÈTRES (pas en pixels) ;
 *   - fond perdu (bleed) de 3 mm sur chaque bord → la page est plus grande que
 *     le format final, les photos pleine page débordent jusqu'au bord ;
 *   - les photos utilisent leur version PLEINE QUALITÉ (champ .full) → 300 DPI ;
 *   - couleurs en RVB (la plupart des imprimeurs photo convertissent eux-mêmes).
 */
import {
  Document, Page, View, Text, Image, StyleSheet, Font,
  Svg, Rect, Circle, Defs, LinearGradient, Stop,
} from '@react-pdf/renderer';
import { getPhotoEffect } from '../lib/albumModel';

const CDN = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl';

Font.register({
  family: 'AlbumDisplay',
  fonts: [
    { src: `${CDN}/spectral/Spectral-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/spectral/Spectral-Medium.ttf`, fontWeight: 500 },
    { src: `${CDN}/spectral/Spectral-SemiBold.ttf`, fontWeight: 600 },
    { src: `${CDN}/spectral/Spectral-LightItalic.ttf`, fontWeight: 300, fontStyle: 'italic' },
  ],
});
Font.register({
  family: 'AlbumBody',
  fonts: [
    { src: `${CDN}/lato/Lato-Light.ttf`, fontWeight: 300 },
    { src: `${CDN}/lato/Lato-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/lato/Lato-Italic.ttf`, fontWeight: 400, fontStyle: 'italic' },
    { src: `${CDN}/lato/Lato-Bold.ttf`, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

// Conversion millimètres → points PDF (1 pt = 1/72 pouce ; 1 pouce = 25,4 mm).
const MM = 72 / 25.4;
const mm = (v) => v * MM;

const BLEED_MM = 3; // fond perdu sur chaque bord

// Dimensions FINALES (après découpe) de chaque format, en millimètres.
const FORMATS = {
  carre: { trimW: 210, trimH: 210, label: 'Livre carré 21 × 21 cm' },
  a4paysage: { trimW: 297, trimH: 210, label: 'A4 paysage 29,7 × 21 cm' },
  a4portrait: { trimW: 210, trimH: 297, label: 'A4 portrait 21 × 29,7 cm' },
};

const PALETTE = {
  ink: '#1C2B2D',
  text: '#41433F',
  soft: '#8A8A82',
  accent: '#C8643C',
  paper: '#FBF8F3',
  line: '#E7E0D4',
};

const imgFull = (p) => p?.full || p?.display || '';

const PAD_MM = 12; // marge depuis le bord de page (3 mm de fond perdu + 9 mm)
const GAP_MM = 2; // espace entre les photos de la mosaïque

function fmtDay(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return ''; }
}

// « 12 – 18 juin 2025 » si possible, sinon une seule date, sinon rien.
function fmtDateRange(summary) {
  const a = fmtDay(summary?.start_date);
  const b = fmtDay(summary?.end_date);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b || '';
}

// Découpe N photos en R rangées CONTIGUËS, en équilibrant la « largeur »
// (somme des proportions) de chaque rangée. Chaque rangée a au moins une photo.
function partitionRows(ars, R) {
  const total = ars.reduce((a, b) => a + b, 0);
  const target = total / R;
  const rows = [];
  let i = 0;
  for (let r = 0; r < R; r++) {
    const remainingRows = R - r;
    const row = [];
    let acc = 0;
    // On laisse toujours assez de photos pour les rangées suivantes.
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

// Choisit la mise en page qui REMPLIT la page : on cherche le nombre de rangées
// dont la hauteur « naturelle » (quand chaque rangée occupe toute la largeur)
// se rapproche le plus de la hauteur disponible. Les hauteurs sont ensuite
// réparties proportionnellement via flexbox pour remplir exactement la page,
// largeur ET hauteur, chaque photo gardant ses proportions (recadrage minime).
function buildFillLayout(photos, contentW, availH, gap) {
  const items = photos.map((p) => ({
    photo: p,
    ar: p.w && p.h ? p.w / p.h : 4 / 3,
  }));
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
      const h = w / sumAr; // hauteur si la rangée remplit toute la largeur
      naturalTotal += h;
      return { idxs, naturalH: h };
    });
    const diff = Math.abs(naturalTotal - availH);
    if (!best || diff < best.diff) best = { rows, diff };
  }

  return best.rows.map((r) => ({
    naturalH: r.naturalH,
    items: r.idxs.map((k) => items[k]),
  }));
}

// Au-delà de ce nombre de photos, une journée continue sur une nouvelle page.
const PHOTOS_PER_PAGE = 6;

// Répartit `total` photos sur `pages` pages, le plus équitablement possible.
function balancedSplit(total, pages) {
  const p = Math.max(1, pages);
  const base = Math.floor(total / p);
  const rem = total - base * p;
  return Array.from({ length: p }, (_, k) => base + (k < rem ? 1 : 0));
}

// Nombre de photos par page : choix manuel de l'utilisateur s'il est valide,
// sinon répartition automatique équilibrée (ex. 8 photos → 4 + 4).
function computeSplit(total, manual) {
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

function splitPhotos(photos, manual) {
  const counts = computeSplit(photos.length, manual);
  const out = [];
  let idx = 0;
  for (const c of counts) {
    out.push(photos.slice(idx, idx + c));
    idx += c;
  }
  return out.length ? out : [[]];
}

// Estime (en mm) la hauteur prise par l'en-tête d'une page, pour dimensionner
// la mosaïque sans déborder (ce qui créait des pages blanches).
function estimateHeaderMm(title, note, firstPage, contentWmm, onPlate) {
  // On SUR-estime volontairement : si l'en-tête réel est plus petit, il reste
  // juste un léger espace en bas ; s'il était sous-estimé, le contenu
  // déborderait et créerait une page fantôme / d'un autre format.
  const plate = onPlate ? 8 : 0; // la plaque (fond coloré/photo) ajoute du rembourrage
  if (!firstPage) return 18 + plate; // pages « suite » : petit intitulé
  let h = 12; // kicker + marges
  if (title) {
    const perLine = Math.max(14, Math.floor(contentWmm / 4.6));
    h += Math.max(1, Math.ceil((title || '').length / perLine)) * 9.5;
  }
  if (note) {
    const perLine = Math.max(24, Math.floor(contentWmm / 2.0));
    h += 6 + Math.ceil((note || '').length / perLine) * 6;
  }
  return h + 12 + plate; // sécurité
}

// Résout le fond à appliquer à une page donnée d'une journée :
//   bg = { mode:'perPage'|'spread', spread:<spec>, pages:[<spec>...] }
//   spec = { type:'none'|'color'|'photo', color?, photo?, toned? }
function resolveBg(bg, pageIndex, pageCount) {
  if (!bg) return { type: 'none' };
  // Ancien format éventuel : bg était directement une photo.
  if (bg.full) return { type: 'photo', photo: bg, toned: true };
  if (bg.mode === 'spread') {
    const s = bg.spread || { type: 'none' };
    // Une photo en mode « étiré » : on note l'indice de page pour découper le
    // panorama. Une couleur (ou aucun) est identique sur toutes les pages.
    if (s.type === 'photo' && s.photo) {
      return { ...s, spreadIndex: pageIndex, spreadCount: pageCount };
    }
    return s;
  }
  return (bg.pages && bg.pages[pageIndex]) || { type: 'none' };
}

// Couche de fond d'une page (couleur unie, photo pleine page, ou photo étirée
// sur plusieurs pages). Le voile beige est appliqué si la photo est « atténuée ».
function PageBackground({ spec, pageW, pageH, st }) {
  if (!spec || spec.type === 'none') return null;
  if (spec.type === 'color') {
    return <View style={[st.bgWrap, { backgroundColor: spec.color }]} />;
  }
  if (spec.type === 'photo' && imgFull(spec.photo)) {
    const src = imgFull(spec.photo);
    const toned = spec.toned !== false;
    if (spec.spreadCount > 1) {
      // Panorama : l'image couvre toute la largeur des N pages, on n'en montre
      // que la tranche correspondant à la page courante.
      return (
        <>
          <View style={st.bgWrap}>
            <Image
              src={src}
              style={{
                position: 'absolute',
                top: 0,
                left: -spec.spreadIndex * pageW,
                width: pageW * spec.spreadCount,
                height: pageH,
                objectFit: 'cover',
              }}
            />
          </View>
          {toned && <View style={st.bgScrim} />}
        </>
      );
    }
    return (
      <>
        <View style={st.bgWrap}>
          <Image src={src} style={st.coverImg} />
        </View>
        {toned && <View style={st.bgScrim} />}
      </>
    );
  }
  return null;
}

const COVER_IMG = { width: '100%', height: '100%', objectFit: 'cover' };

// Cadres « simples » (fond + marge + éventuelle bordure) → style du conteneur.
function simpleFrameStyle(frame, w, h) {
  const pad = Math.max(4, Math.min(w, h) * 0.05);
  switch (frame) {
    case 'border': return { backgroundColor: '#FFFFFF', padding: pad };
    case 'postcard': return { backgroundColor: '#FFFFFF', padding: pad, borderWidth: 0.7, borderColor: '#E2DDD0' };
    case 'polaroid': return { backgroundColor: '#FFFFFF', paddingTop: pad, paddingHorizontal: pad, paddingBottom: pad * 3 };
    case 'wood': return { backgroundColor: '#7C4A21', padding: Math.max(6, Math.min(w, h) * 0.06) };
    case 'gold': return { backgroundColor: '#C9A227', padding: pad };
    case 'parchment': return { backgroundColor: '#EFE2C4', padding: pad, borderWidth: 0.8, borderColor: '#CDBD97' };
    default: return null;
  }
}

// Timbre : bordure blanche + trous de perforation (gris) le long des 4 bords.
function StampFrame({ src, w, h }) {
  const b = Math.max(6, Math.min(w, h) * 0.07); // épaisseur du bord blanc
  const r = b * 0.32;
  const stepX = Math.max(8, w / Math.round(w / (r * 3)));
  const stepY = Math.max(8, h / Math.round(h / (r * 3)));
  const holes = [];
  for (let x = stepX / 2; x < w; x += stepX) {
    holes.push(['t' + x, x, b / 2], ['b' + x, x, h - b / 2]);
  }
  for (let y = stepY / 2; y < h; y += stepY) {
    holes.push(['l' + y, b / 2, y, true], ['r' + y, w - b / 2, y, true]);
  }
  return (
    <View style={{ width: '100%', height: '100%', backgroundColor: '#FFFFFF', position: 'relative' }}>
      <View style={{ position: 'absolute', top: b, left: b, right: b, bottom: b }}>
        <Image src={src} style={COVER_IMG} />
      </View>
      <Svg style={{ position: 'absolute', top: 0, left: 0 }} width={w} height={h}>
        {holes.map(([k, cx, cy]) => (
          <Circle key={k} cx={cx} cy={cy} r={r} fill="#D9D4C8" />
        ))}
      </Svg>
    </View>
  );
}

// Pellicule : bandes noires haut/bas avec perforations blanches (style 35 mm).
function FilmFrame({ src, w, h }) {
  const strip = Math.max(10, h * 0.12);
  const hole = strip * 0.42;
  const stepX = Math.max(10, w / Math.round(w / (hole * 1.9)));
  const holes = [];
  for (let x = stepX / 2 - hole / 2; x < w - hole; x += stepX) {
    holes.push(['t' + x, x], ['b' + x, x]);
  }
  return (
    <View style={{ width: '100%', height: '100%', backgroundColor: '#141414', position: 'relative' }}>
      <View style={{ position: 'absolute', top: strip, left: 4, right: 4, bottom: strip }}>
        <Image src={src} style={COVER_IMG} />
      </View>
      <Svg style={{ position: 'absolute', top: 0, left: 0 }} width={w} height={h}>
        {holes.map(([k, x], i) => (
          <Rect
            key={k}
            x={x}
            y={i % 2 === 0 ? (strip - hole) / 2 : h - strip + (strip - hole) / 2}
            width={hole}
            height={hole}
            rx={hole * 0.18}
            fill="#FFFFFF"
          />
        ))}
      </Svg>
    </View>
  );
}

// Motif décoratif léger d'un thème, dessiné en fond de page (derrière le
// contenu). Posé seulement quand la page n'a pas son propre fond.
function PagePattern({ theme, pageW, pageH }) {
  const kind = theme?.pattern;
  if (!kind || kind === 'none') return null;
  const c = theme.patternColor || '#E7DDCB';
  const els = [];
  if (kind === 'dots') {
    const step = 34;
    for (let x = step / 2; x < pageW; x += step)
      for (let y = step / 2; y < pageH; y += step)
        els.push(<Circle key={`${x}-${y}`} cx={x} cy={y} r={2.1} fill={c} />);
  } else if (kind === 'grid') {
    const step = 30;
    for (let x = step; x < pageW; x += step) els.push(<Rect key={`v${x}`} x={x} y={0} width={0.6} height={pageH} fill={c} />);
    for (let y = step; y < pageH; y += step) els.push(<Rect key={`h${y}`} x={0} y={y} width={pageW} height={0.6} fill={c} />);
  } else if (kind === 'diagonal') {
    const step = 26;
    for (let d = -pageH; d < pageW; d += step)
      els.push(<Rect key={`d${d}`} x={d} y={0} width={0.8} height={pageH * 1.5} fill={c} transform={`rotate(20 ${d} 0)`} />);
  } else if (kind === 'confetti') {
    const accent = theme.accent || '#EC4899';
    const cols = [c, accent, '#7FB3D5'];
    const step = 46;
    let i = 0;
    for (let x = step / 2; x < pageW; x += step)
      for (let y = step / 2; y < pageH; y += step) {
        i += 1;
        const col = cols[i % cols.length];
        if (i % 3 === 0) els.push(<Circle key={`c${x}-${y}`} cx={x} cy={y} r={2.4} fill={col} />);
        else els.push(<Rect key={`r${x}-${y}`} x={x} y={y} width={4} height={4} rx={1} fill={col} transform={`rotate(35 ${x} ${y})`} />);
      }
  }
  return (
    <Svg style={{ position: 'absolute', top: 0, left: 0 }} width={pageW} height={pageH}>
      {els}
    </Svg>
  );
}

// Une photo de la mosaïque : applique l'effet choisi (cadre + filtre couleur
// déjà « cuit » dans _fx) en utilisant les dimensions réelles de la case.
function PdfPhoto({ photo, st, w, h }) {
  const effect = getPhotoEffect(photo.effect);
  const src = photo._fx || imgFull(photo);
  const frame = effect.frame;
  if (!frame) return <Image src={src} style={st.mosaicImg} />;
  if (frame === 'stamp') return <StampFrame src={src} w={w} h={h} />;
  if (frame === 'film') return <FilmFrame src={src} w={w} h={h} />;
  if (frame === 'rounded') {
    const rad = Math.min(w, h) * 0.06;
    return (
      <View style={{ width: '100%', height: '100%', borderRadius: rad, overflow: 'hidden' }}>
        <Image src={src} style={COVER_IMG} />
      </View>
    );
  }
  if (frame === 'thin') {
    return <Image src={src} style={{ ...COVER_IMG, borderWidth: 1.2, borderColor: '#111111' }} />;
  }
  const fs = simpleFrameStyle(frame, w, h);
  return (
    <View style={{ width: '100%', height: '100%', ...fs }}>
      <Image src={src} style={COVER_IMG} />
    </View>
  );
}

// Mosaïque d'une page : TOUTES les tailles sont calculées en points (jamais en
// pourcentage), pour que react-pdf ne déborde jamais (sinon il crée des pages
// fantômes/vides et ne respecte plus la répartition). Les rangées remplissent
// la largeur ; l'ensemble remplit la hauteur dispo (léger recadrage via cover).
function Mosaic({ photos, contentW, availH, gap, st }) {
  const rows = buildFillLayout(photos, contentW, availH, gap);
  if (!rows.length) return null;
  const vgaps = gap * Math.max(0, rows.length - 1);
  const sumNatural = rows.reduce((s, r) => s + r.naturalH, 0);
  // Facteur d'étirement vertical pour remplir exactement la hauteur dispo.
  // Borné pour éviter un recadrage trop fort (mieux vaut un petit espace).
  let f = sumNatural > 0 ? (availH - vgaps) / sumNatural : 1;
  if (!Number.isFinite(f) || f <= 0) f = 1;
  f = Math.min(f, 1.18);
  return (
    <View style={st.mosaic}>
      {rows.map((row, ri) => {
        const h = row.naturalH * f; // hauteur (points) de la rangée
        return (
          <View
            key={ri}
            style={{ height: h, flexDirection: 'row', marginBottom: ri < rows.length - 1 ? gap : 0 }}
          >
            {row.items.map((it, ci) => {
              const cw = it.ar * row.naturalH;
              return (
              <View
                key={ci}
                style={{
                  width: cw, // largeur (points) : remplit la ligne
                  height: h,
                  marginRight: ci < row.items.length - 1 ? gap : 0,
                  position: 'relative',
                }}
              >
                <PdfPhoto photo={it.photo} st={st} w={cw} h={h} />
                {it.photo.caption ? (
                  <View style={st.capWrap}>
                    <Text style={st.capTxt}>{it.photo.caption}</Text>
                  </View>
                ) : null}
              </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function CoverFade({ color = '#1C2B2D' }) {
  return (
    <Svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '60%' }}>
      <Defs>
        <LinearGradient id="albFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0" />
          <Stop offset="0.55" stopColor={color} stopOpacity="0.5" />
          <Stop offset="1" stopColor={color} stopOpacity="0.92" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#albFade)" />
    </Svg>
  );
}

export default function AlbumPdfDoc({ album, days = [], format = 'carre', summary = null, routeMap = null, stops = [], endNote = '', endPhoto = null, theme = null }) {
  const fmt = FORMATS[format] || FORMATS.carre;
  // Page = format final + 3 mm de fond perdu sur chaque bord.
  const pageW = mm(fmt.trimW + BLEED_MM * 2);
  const pageH = mm(fmt.trimH + BLEED_MM * 2);
  const contentW = pageW - mm(PAD_MM) * 2;
  // Palette effective : thème éventuel par-dessus la palette par défaut.
  const P = {
    ...PALETTE,
    ...(theme ? { paper: theme.paper, ink: theme.ink, accent: theme.accent } : {}),
  };
  const st = makeStyles(pageW, pageH, P);

  const dateRange = fmtDateRange(summary);

  const entries = days
    .map((d, i) => ({
      i,
      location: d?.location || '',
      ...(album?.days?.[i] || { title: '', note: '', photos: [] }),
    }))
    .map((e) => ({ ...e, photos: (e.photos || []).filter((p) => imgFull(p)) }))
    // On ne crée une page que si la journée a des photos ou un texte écrit par
    // l'utilisateur. (Le titre seul, repris automatiquement du programme, ne
    // suffit pas : sinon chaque jour sans photo créerait une page quasi vide.)
    .filter((e) => e.photos.length > 0 || (e.note || '').trim());

  // Couverture : celle choisie par l'utilisateur, sinon la première photo
  // disponible de l'album.
  let cover = album?.cover || null;
  if (!cover) {
    for (const e of entries) {
      if (e.photos.length) { cover = e.photos[0]; break; }
    }
  }

  return (
    <Document title={`${album?.title || 'Album'} — TravelO`} author="TravelO">
      {/* COUVERTURE — photo pleine page jusqu'au fond perdu */}
      <Page size={[pageW, pageH]} style={st.coverPage}>
        {cover && (
          <View style={st.coverImgWrap}>
            <Image src={imgFull(cover)} style={st.coverImg} />
          </View>
        )}
        <CoverFade color={P.ink} />
        <View style={st.coverContent}>
          <Text style={st.coverKicker}>Album de voyage</Text>
          <Text style={st.coverTitle}>{album?.title || 'Mon voyage'}</Text>
          {dateRange ? (
            <>
              <View style={st.coverRule} />
              <Text style={st.coverDates}>{dateRange}</Text>
            </>
          ) : null}
        </View>
      </Page>

      {/* CARTE DU VOYAGE */}
      {routeMap && (() => {
        const nStops = stops.filter(Boolean).length;
        // Hauteur réservée à la liste des étapes (2 colonnes) + à l'en-tête,
        // pour donner à la carte une hauteur FIXE (sinon l'image s'affiche à sa
        // taille d'origine et déborde sur plusieurs pages).
        const stopsMm = nStops ? Math.ceil(nStops / 2) * 7 + 6 : 0;
        const mapH = pageH - mm(PAD_MM) * 2 - mm(20) - mm(stopsMm) - mm(6);
        return (
          <Page size={[pageW, pageH]} style={st.page}>
            <View style={st.header}>
              <Text style={st.dayKicker}>Itinéraire</Text>
              <Text style={st.dayTitle}>La carte du voyage</Text>
            </View>
            <View style={[st.mapWrap, { height: mapH }]}>
              <Image src={routeMap} style={st.mapImg} />
            </View>
            {nStops > 0 && (
              <View style={st.stops}>
                {stops.map((s, k) =>
                  s ? (
                    <View key={k} style={st.stopItem}>
                      <View style={st.stopNum}>
                        <Text style={st.stopNumTxt}>{k + 1}</Text>
                      </View>
                      <Text style={st.stopLabel}>{s}</Text>
                    </View>
                  ) : null
                )}
              </View>
            )}
          </Page>
        );
      })()}

      {/* UNE OU PLUSIEURS PAGES PAR JOURNÉE */}
      {entries.flatMap((e) => {
        // On ne garde que les pages contenant réellement des photos → aucune
        // page vide ne peut apparaître (même si une répartition en prévoyait
        // une de trop).
        const chunks = splitPhotos(e.photos, e.split).filter((c) => c.length > 0);
        const pageCount = chunks.length;
        const contentWmm = contentW / MM;
        return chunks.map((chunk, p) => {
          const spec = resolveBg(e.bg, p, pageCount);
          const firstPage = p === 0;
          const onPlate = spec.type !== 'none';
          const headerMm = estimateHeaderMm(e.title, e.note, firstPage, contentWmm, onPlate);
          // Marge de sécurité (mm) : on garde le contenu strictement sous la
          // hauteur de page → react-pdf ne crée jamais de page de continuation.
          const availH = Math.max(
            mm(45),
            pageH - mm(PAD_MM) * 2 - mm(headerMm) - mm(4)
          );
          return (
            <Page key={`${e.i}-${p}`} size={[pageW, pageH]} style={st.page}>
              {spec.type === 'none' && <PagePattern theme={theme} pageW={pageW} pageH={pageH} />}
              <PageBackground spec={spec} pageW={pageW} pageH={pageH} st={st} />
              <View style={onPlate ? st.headerPlate : st.header}>
                <Text style={st.dayKicker}>
                  Jour {e.i + 1}{e.location ? ` · ${e.location}` : ''}
                  {!firstPage ? ' · suite' : ''}
                </Text>
                {firstPage && e.title ? <Text style={st.dayTitle}>{e.title}</Text> : null}
                {firstPage && e.note ? <Text style={st.note}>{e.note}</Text> : null}
              </View>
              <Mosaic
                photos={chunk}
                contentW={contentW}
                availH={availH}
                gap={mm(GAP_MM)}
                st={st}
              />
            </Page>
          );
        });
      })}

      {/* PAGE DE FIN — quatrième de couverture (personnalisable) */}
      <Page size={[pageW, pageH]} style={st.endPage}>
        {endPhoto && imgFull(endPhoto) && (
          <>
            <View style={st.endImgWrap}>
              <Image src={imgFull(endPhoto)} style={st.coverImg} />
            </View>
            {/* voile sombre pour garder le texte lisible sur la photo */}
            <View style={st.endScrim} />
          </>
        )}
        <View style={st.endInner}>
          <Text style={st.endKicker}>Fin du voyage</Text>
          <Text style={st.endTitle}>{album?.title || 'Mon voyage'}</Text>
          {dateRange ? <Text style={st.endDates}>{dateRange}</Text> : null}
          <View style={st.endRule} />
          <Text style={st.endQuote}>
            {(endNote || '').trim() || '« Les voyages finissent, les souvenirs restent. »'}
          </Text>
          <Text style={st.endBrand}>Album réalisé avec TravelO</Text>
        </View>
      </Page>
    </Document>
  );
}

function makeStyles(pageW, pageH, P = PALETTE) {
  // Marge de sécurité depuis le BORD DE PAGE : 3 mm de fond perdu + 9 mm pour
  // que le texte ne soit jamais coupé à la découpe = 12 mm.
  const pad = mm(12);
  return StyleSheet.create({
    page: {
      width: pageW,
      height: pageH,
      flexDirection: 'column',
      paddingTop: pad,
      paddingBottom: pad,
      paddingHorizontal: pad,
      backgroundColor: P.paper,
      fontFamily: 'AlbumBody',
      color: P.text,
      overflow: 'hidden',
    },

    coverPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: P.ink },
    coverImgWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
    // Plaque sombre semi-transparente derrière le texte : garantit que le titre
    // (blanc) reste lisible, même si la photo a des zones claires à cet endroit.
    coverContent: {
      position: 'absolute',
      left: pad,
      right: pad,
      bottom: pad,
      backgroundColor: 'rgba(18,26,26,0.52)',
      borderRadius: 6,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    coverKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#FFFFFF', marginBottom: 8, opacity: 0.9 },
    coverTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 38, lineHeight: 1.05, color: '#FFFFFF' },
    coverRule: { width: mm(16), height: 2, backgroundColor: P.accent, marginTop: 12, marginBottom: 10 },
    coverDates: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 11, letterSpacing: 1, color: '#FFFFFF', opacity: 0.95 },

    // Fond de page (photo) + voile clair par-dessus.
    bgWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
    bgScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(251,248,243,0.80)' },

    header: { flexShrink: 0, marginBottom: mm(4) },
    // En-tête posé sur une plaque claire (quand la page a un fond coloré/photo).
    headerPlate: { flexShrink: 0, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: 'rgba(251,248,243,0.85)', borderRadius: 6, paddingVertical: 9, paddingHorizontal: 13, marginBottom: mm(4) },
    dayKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 8.5, letterSpacing: 2, textTransform: 'uppercase', color: P.accent, marginBottom: 5 },
    dayTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 22, color: P.ink, lineHeight: 1.1 },
    note: { fontFamily: 'AlbumBody', fontWeight: 300, fontSize: 10.5, lineHeight: 1.5, color: P.text, marginTop: 6 },

    // Carte du voyage : la carte occupe l'espace, la liste des étapes dessous.
    mapWrap: { flexShrink: 0, marginTop: mm(2), borderWidth: 1, borderColor: P.line, backgroundColor: '#e9e6df' },
    mapImg: { width: '100%', height: '100%', objectFit: 'contain' },
    stops: { flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', marginTop: mm(4) },
    stopItem: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 6, paddingRight: 8 },
    stopNum: { width: 16, height: 16, borderRadius: 8, backgroundColor: P.accent, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
    stopNumTxt: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 7.5, color: '#FFFFFF' },
    stopLabel: { flex: 1, fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 9.5, color: P.ink },

    // La mosaïque occupe la hauteur restante et est centrée (les photos
    // gardent leurs proportions, donc un léger espace peut subsister).
    // La mosaïque est dimensionnée en points (pas de flexGrow) pour ne jamais
    // déborder. Sa hauteur = somme des rangées ≈ espace dispo.
    mosaic: { flexDirection: 'column', marginTop: mm(2), overflow: 'hidden' },
    mosaicImg: { width: '100%', height: '100%', objectFit: 'cover' },
    capWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 4, paddingHorizontal: 5 },
    capTxt: { fontFamily: 'AlbumBody', fontWeight: 400, fontStyle: 'italic', fontSize: 10, textAlign: 'center', color: '#FFFFFF' },

    // Page de fin (quatrième de couverture) : fond sombre, texte centré.
    endPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: P.ink, justifyContent: 'center', alignItems: 'center', paddingHorizontal: pad },
    endImgWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    endScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,22,22,0.58)' },
    endInner: { alignItems: 'center' },
    endKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: P.accent, marginBottom: 14 },
    endTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 28, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.1 },
    endDates: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 11, letterSpacing: 1, color: '#FFFFFF', opacity: 0.85, marginTop: 8 },
    endRule: { width: mm(20), height: 2, backgroundColor: P.accent, marginVertical: 20 },
    endQuote: { fontFamily: 'AlbumDisplay', fontWeight: 300, fontStyle: 'italic', fontSize: 14, color: '#FFFFFF', opacity: 0.92, textAlign: 'center', maxWidth: mm(120) },
    endBrand: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 8.5, letterSpacing: 2, textTransform: 'uppercase', color: '#FFFFFF', opacity: 0.6, marginTop: 28 },
  });
}
