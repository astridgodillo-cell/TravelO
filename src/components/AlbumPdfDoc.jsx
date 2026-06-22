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
  Svg, Rect, Circle, Ellipse, Polygon, Polyline, Defs, ClipPath, LinearGradient, Stop,
} from '@react-pdf/renderer';
import { getPhotoEffect, twemojiUrl, splitPhotos, pageLayout, resolveBg, unitLabel, computeBubble, fontPdf, getFrameShape, shapePointsPx } from '../lib/albumModel';

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
Font.register({
  family: 'AlbumHand',
  fonts: [
    { src: `${CDN}/patrickhand/PatrickHand-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/patrickhand/PatrickHand-Regular.ttf`, fontWeight: 700 },
  ],
});
Font.register({
  family: 'AlbumComic',
  fonts: [
    { src: `${CDN}/comicneue/ComicNeue-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/comicneue/ComicNeue-Bold.ttf`, fontWeight: 700 },
  ],
});

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

// La répartition des photos en pages (splitPhotos) et la disposition d'une page
// (pageLayout : positions EXACTES en points, en-tête de hauteur fixe) vivent
// désormais dans lib/albumModel.js → une seule source de vérité partagée par le
// PDF et l'éditeur de décoration, pour que la sandbox soit le calque exact du PDF.

// resolveBg (fond d'une page donnée) est partagé dans lib/albumModel.js.

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
  // Calque de fond hors-flux (sinon le dessin pleine hauteur pousse le contenu
  // et provoque des pages de continuation vides).
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Svg width={pageW} height={pageH}>{els}</Svg>
    </View>
  );
}

// Découpe de la photo selon une silhouette (cœur, étoile…). La photo est
// dessinée en « cover » (sans déformation) puis masquée par le polygone de la
// forme — exactement comme l'éditeur (clip-path), coins transparents.
function ShapeFrame({ src, shape, w, h, ar }) {
  const sh = getFrameShape(shape);
  if (!sh) return <Image src={src} style={COVER_IMG} />;
  // Rectangle de dessin couvrant la case w×h en conservant le ratio de l'image.
  let dw = w; let dh = h; let dx = 0; let dy = 0;
  if (ar) {
    const cellAr = w / h;
    if (ar > cellAr) { dh = h; dw = h * ar; dx = -(dw - w) / 2; }
    else { dw = w; dh = w / ar; dy = -(dh - h) / 2; }
  }
  return (
    <Svg width={w} height={h}>
      <Defs>
        <ClipPath id="shp">
          <Polygon points={shapePointsPx(sh.pts, w, h)} />
        </ClipPath>
      </Defs>
      <Image src={src} x={dx} y={dy} style={{ width: dw, height: dh }} clipPath="url(#shp)" />
    </Svg>
  );
}

function FramedImage({ src, frame, shape, w, h, ar, st }) {
  if (!frame) return <Image src={src} style={st.mosaicImg} />;
  if (frame === 'shape') return <ShapeFrame src={src} shape={shape} w={w} h={h} ar={ar} />;
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

// Couche de décorations (emojis/stickers/textes) posée sur une zone de
// dimensions w×h. Positions en fractions (0..1) de cette zone.
function DecoLayer({ items, w, h }) {
  if (!items || !items.length) return null;
  return (
    <>
      {items.map((it, i) => {
        const size = it.scale * Math.min(w, h);
        const cx = it.xf * w;
        const cy = it.yf * h;
        if (it.type === 'text') {
          const fs = size;
          const estW = Math.max(1, (it.value || '').length) * fs * 0.62;
          return (
            <View key={i} style={{ position: 'absolute', left: cx - estW / 2, top: cy - fs * 0.7, width: estW, transform: `rotate(${it.rot}deg)`, transformOrigin: 'center' }}>
              <Text style={{ fontFamily: fontPdf(it.font), fontWeight: 700, fontSize: fs, color: it.color || '#FFFFFF', textAlign: 'center' }}>{it.value}</Text>
            </View>
          );
        }
        if (it.type === 'image') {
          if (!it.value) return null;
          const iw = size;
          const ih = size / (it.ar || 1);
          return (
            <Image key={i} src={it.value} style={{ position: 'absolute', width: iw, height: ih, left: cx - iw / 2, top: cy - ih / 2, transform: `rotate(${it.rot}deg)`, transformOrigin: 'center' }} />
          );
        }
        if (it.type === 'bubble') {
          const g = computeBubble(it.tailAngle ?? 215, it.tailLen ?? 0.35);
          const unit = size / 100; // 1 unité du repère = ... points
          const boxW = g.vb.w * unit;
          const fs = 9 * unit * (it.fontScale ?? 1);
          return (
            <View key={i} style={{ position: 'absolute', left: cx - boxW / 2, top: cy - boxW / 2, width: boxW, height: boxW, transform: `rotate(${it.rot}deg)`, transformOrigin: 'center', alignItems: 'center', justifyContent: 'center' }}>
              <Svg viewBox={`${g.vb.x} ${g.vb.y} ${g.vb.w} ${g.vb.h}`} style={{ position: 'absolute', top: 0, left: 0, width: boxW, height: boxW }}>
                <Ellipse cx="0" cy="0" rx="50" ry="30" fill="#FFFFFF" stroke="#1F2937" strokeWidth="2.4" />
                <Polygon points={`${g.b1.x},${g.b1.y} ${g.tip.x},${g.tip.y} ${g.b2.x},${g.b2.y}`} fill="#FFFFFF" />
                <Polyline points={`${g.b1.x},${g.b1.y} ${g.tip.x},${g.tip.y} ${g.b2.x},${g.b2.y}`} fill="none" stroke="#1F2937" strokeWidth="2.4" />
              </Svg>
              <View style={{ width: boxW * 0.78 * (100 / g.vb.w), alignItems: 'center' }}>
                <Text style={{ fontFamily: fontPdf(it.font || 'comic'), fontWeight: 700, fontSize: fs, color: it.color || '#111111', textAlign: 'center' }}>{it.value}</Text>
              </View>
            </View>
          );
        }
        const url = twemojiUrl(it.value);
        if (!url) return null;
        return (
          <Image key={i} src={url} style={{ position: 'absolute', width: size, height: size, left: cx - size / 2, top: cy - size / 2, transform: `rotate(${it.rot}deg)`, transformOrigin: 'center' }} />
        );
      })}
    </>
  );
}

// Une photo de la mosaïque : effet (cadre + filtre « cuit ») + décorations
// propres à la photo, en fractions de la case.
function PdfPhoto({ photo, st, w, h }) {
  const effect = getPhotoEffect(photo.effect);
  const src = photo._fx || imgFull(photo);
  const deco = photo.deco || [];
  const ar = photo.w && photo.h ? photo.w / photo.h : null;
  const framed = <FramedImage src={src} frame={effect.frame} shape={effect.shape} w={w} h={h} ar={ar} st={st} />;
  if (!deco.length) return framed;
  return (
    <View style={{ width: '100%', height: '100%', position: 'relative' }}>
      {framed}
      <DecoLayer items={deco} w={w} h={h} />
    </View>
  );
}

// Mosaïque d'une page : chaque photo est posée à une position ABSOLUE calculée
// par pageLayout (points). Plus aucun flux → react-pdf ne peut pas déborder ni
// créer de page fantôme, et l'éditeur (même pageLayout) est fidèle au pixel.
function Mosaic({ cells, photos, st }) {
  return (
    <>
      {photos.map((photo, i) => {
        const c = cells[i];
        if (!c) return null;
        return (
          <View key={i} style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h }}>
            <PdfPhoto photo={photo} st={st} w={c.w} h={c.h} />
            {photo.caption ? (
              <View style={st.capWrap}>
                <Text style={st.capTxt}>{photo.caption}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </>
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

// Photo de couverture : soit normale (pleine page), soit la MOITIÉ d'une photo
// étendue sur la 1re et la 4e de couverture (half 'left' = 1re, 'right' = 4e).
function CoverPhoto({ photo, spread, half, pageW, pageH, st }) {
  if (spread) {
    const src = imgFull(spread);
    const idx = half === 'right' ? 1 : 0;
    return (
      <View style={st.coverImgWrap}>
        <View style={{ position: 'absolute', top: 0, left: -idx * pageW, width: pageW * 2, height: pageH }}>
          <Image src={src} style={{ width: pageW * 2, height: pageH, objectFit: 'cover' }} />
        </View>
      </View>
    );
  }
  return photo && imgFull(photo) ? (
    <View style={st.coverImgWrap}><Image src={imgFull(photo)} style={st.coverImg} /></View>
  ) : null;
}

// Page blanche (2e et 3e de couverture, souvent imposées par les imprimeurs).
function BlankPage({ pageW, pageH }) {
  return <Page size={[pageW, pageH]} style={{ width: pageW, height: pageH, backgroundColor: '#FFFFFF' }} />;
}

export default function AlbumPdfDoc({ album, days = [], format = 'carre', summary = null, routeMap = null, stops = [], endNote = '', endPhoto = null, theme = null, unit = 'jour', coverLayout = {}, endLayout = {}, coverSpread = {}, opening = {} }) {
  const coverPos = coverLayout.pos || 'bottom';
  const coverAlign = coverLayout.align || 'left';
  const coverKicker = coverLayout.kicker != null ? coverLayout.kicker : 'Album de voyage';
  const coverShowDates = coverLayout.showDates !== false;
  const endPos = endLayout.pos || 'center';
  const endAlign = endLayout.align || 'center';
  const endKicker = endLayout.kicker != null ? endLayout.kicker : 'Fin du voyage';
  const endShowDates = endLayout.showDates !== false;
  const fmt = FORMATS[format] || FORMATS.carre;
  // Page = format final + 3 mm de fond perdu sur chaque bord.
  const pageW = mm(fmt.trimW + BLEED_MM * 2);
  const pageH = mm(fmt.trimH + BLEED_MM * 2);
  const pad = mm(PAD_MM);
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

  const spreadOn = !!(coverSpread.enabled && imgFull(coverSpread.photo));

  return (
    <Document title={`${album?.title || 'Album'} — TravelO`} author="TravelO">
      {/* 1RE DE COUVERTURE — photo pleine page jusqu'au fond perdu */}
      <Page size={[pageW, pageH]} style={st.coverPage}>
        <CoverPhoto photo={cover} spread={spreadOn ? coverSpread.photo : null} half="right" pageW={pageW} pageH={pageH} st={st} />
        <CoverFade color={P.ink} />
        <View
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: pad,
            bottom: pad,
            flexDirection: 'column',
            justifyContent: coverPos === 'top' ? 'flex-start' : coverPos === 'center' ? 'center' : 'flex-end',
          }}
        >
          <View style={[st.coverContent, { alignItems: coverAlign === 'center' ? 'center' : coverAlign === 'right' ? 'flex-end' : 'flex-start' }]}>
            <Text style={[st.coverKicker, { textAlign: coverAlign }]}>{coverKicker}</Text>
            <Text style={[st.coverTitle, { textAlign: coverAlign }]}>{album?.title || 'Mon voyage'}</Text>
            {coverShowDates && dateRange ? (
              <>
                <View style={st.coverRule} />
                <Text style={[st.coverDates, { textAlign: coverAlign }]}>{dateRange}</Text>
              </>
            ) : null}
          </View>
        </View>
      </Page>

      {/* 2E DE COUVERTURE — page blanche imposée */}
      <BlankPage pageW={pageW} pageH={pageH} />

      {/* PAGE D'OUVERTURE : la carte si elle existe, sinon page blanche /
          photo choisie / photo au hasard selon le réglage. */}
      {routeMap ? (() => {
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
      })() : (() => {
        const type = opening.type || 'blank';
        const photo = type === 'photo' || type === 'random' ? opening.photo : null;
        if (photo && imgFull(photo)) {
          return (
            <Page size={[pageW, pageH]} style={st.coverPage}>
              <View style={st.coverImgWrap}><Image src={imgFull(photo)} style={st.coverImg} /></View>
            </Page>
          );
        }
        return <BlankPage pageW={pageW} pageH={pageH} />;
      })()}

      {/* UNE OU PLUSIEURS PAGES PAR JOURNÉE */}
      {entries.flatMap((e) => {
        // On ne garde que les pages contenant réellement des photos → aucune
        // page vide ne peut apparaître (même si une répartition en prévoyait
        // une de trop).
        const chunks = splitPhotos(e.photos, e.split).filter((c) => c.length > 0);
        const pageCount = chunks.length;
        return chunks.map((chunk, p) => {
          const spec = resolveBg(e.bg, p, pageCount);
          const firstPage = p === 0;
          const onPlate = spec.type !== 'none';
          const lay = pageLayout(chunk, format, { title: e.title, note: e.note, firstPage, onPlate });
          const free = e.freePages?.[p];
          const freeValid = Array.isArray(free) && free.length === chunk.length && chunk.length > 0;
          const minPage = Math.min(pageW, pageH);
          return (
            <Page key={`${e.i}-${p}`} size={[pageW, pageH]} style={st.dayPage}>
              {spec.type === 'none' && <PagePattern theme={theme} pageW={pageW} pageH={pageH} />}
              <PageBackground spec={spec} pageW={pageW} pageH={pageH} st={st} />
              <View style={{ position: 'absolute', left: lay.pad, top: lay.pad, width: lay.contentW, height: lay.headerH, overflow: 'hidden' }}>
                <View style={onPlate ? st.headerPlate : st.header}>
                  <Text style={st.dayKicker}>
                    {unitLabel(unit)} {e.i + 1}{e.location ? ` · ${e.location}` : ''}
                    {!firstPage ? ' · suite' : ''}
                  </Text>
                  {firstPage && e.title ? <Text style={st.dayTitle}>{e.title}</Text> : null}
                  {firstPage && e.note ? <Text style={st.note}>{e.note}</Text> : null}
                </View>
              </View>
              {freeValid ? (
                chunk.map((photo, i) => {
                  const b = free[i];
                  const ar = photo.w && photo.h ? photo.w / photo.h : 4 / 3;
                  const bw = b.scale * minPage;
                  const bh = bw / ar;
                  return (
                    <View key={i} style={{ position: 'absolute', left: b.xf * pageW - bw / 2, top: b.yf * pageH - bh / 2, width: bw, height: bh, transform: `rotate(${b.rot}deg)`, transformOrigin: 'center' }}>
                      <PdfPhoto photo={photo} st={st} w={bw} h={bh} />
                      {photo.caption ? (
                        <View style={st.capWrap}><Text style={st.capTxt}>{photo.caption}</Text></View>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Mosaic cells={lay.cells} photos={chunk} st={st} />
              )}
              {e.pageDeco?.[p]?.length ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                  <DecoLayer items={e.pageDeco[p]} w={pageW} h={pageH} />
                </View>
              ) : null}
            </Page>
          );
        });
      })}

      {/* 3E DE COUVERTURE — page blanche imposée */}
      <BlankPage pageW={pageW} pageH={pageH} />

      {/* 4E DE COUVERTURE — page de fin (photo de fond ou moitié GAUCHE de la
          photo étendue sur les deux couvertures) */}
      <Page size={[pageW, pageH]} style={st.endPage}>
        {spreadOn ? (
          <>
            <CoverPhoto photo={null} spread={coverSpread.photo} half="left" pageW={pageW} pageH={pageH} st={st} />
            <CoverFade color={P.ink} />
          </>
        ) : endPhoto && imgFull(endPhoto) ? (
          <>
            <View style={st.endImgWrap}>
              <Image src={imgFull(endPhoto)} style={st.coverImg} />
            </View>
            <CoverFade color={P.ink} />
          </>
        ) : null}
        <View
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: pad,
            bottom: pad,
            flexDirection: 'column',
            justifyContent: endPos === 'top' ? 'flex-start' : endPos === 'bottom' ? 'flex-end' : 'center',
            alignItems: endAlign === 'left' ? 'flex-start' : endAlign === 'right' ? 'flex-end' : 'center',
          }}
        >
          <View style={[st.endInner, (spreadOn || (endPhoto && imgFull(endPhoto))) ? { backgroundColor: 'rgba(18,26,26,0.52)', borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16 } : null, endAlign === 'left' ? { alignItems: 'flex-start' } : endAlign === 'right' ? { alignItems: 'flex-end' } : null]}>
            <Text style={st.endKicker}>{endKicker}</Text>
            <Text style={[st.endTitle, endAlign === 'left' ? { textAlign: 'left' } : endAlign === 'right' ? { textAlign: 'right' } : null]}>{album?.title || 'Mon voyage'}</Text>
            {endShowDates && dateRange ? <Text style={st.endDates}>{dateRange}</Text> : null}
            <View style={st.endRule} />
            <Text style={[st.endQuote, endAlign === 'left' ? { textAlign: 'left' } : endAlign === 'right' ? { textAlign: 'right' } : null]}>
              {(endNote || '').trim() || '« Les voyages finissent, les souvenirs restent. »'}
            </Text>
            <Text style={st.endBrand}>Album réalisé avec TravelO</Text>
          </View>
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

    // Page jour : sans rembourrage (les positions sont absolues, en points,
    // calculées par pageLayout — voir Mosaic).
    dayPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: P.paper, fontFamily: 'AlbumBody', color: P.text, overflow: 'hidden' },

    coverPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: P.ink },
    coverImgWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
    // Plaque sombre semi-transparente derrière le texte : garantit que le titre
    // (blanc) reste lisible, même si la photo a des zones claires à cet endroit.
    coverContent: {
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
