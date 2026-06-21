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
import React from 'react';
import {
  Document, Page, View, Text, Image, StyleSheet, Font,
  Svg, Rect, Defs, LinearGradient, Stop,
} from '@react-pdf/renderer';

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
// Hauteur réservée à l'en-tête (titre + texte) + numéro de page, pour estimer
// l'espace photos lors du choix du nombre de rangées.
const HEADER_RESERVE_MM = 32;

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

export default function AlbumPdfDoc({ album, days = [], format = 'carre', summary = null, routeMap = null, stops = [], endNote = '', endPhoto = null }) {
  const fmt = FORMATS[format] || FORMATS.carre;
  // Page = format final + 3 mm de fond perdu sur chaque bord.
  const pageW = mm(fmt.trimW + BLEED_MM * 2);
  const pageH = mm(fmt.trimH + BLEED_MM * 2);
  const contentW = pageW - mm(PAD_MM) * 2;
  // Hauteur estimée disponible pour les photos (sert à choisir le nombre de
  // rangées qui remplira au mieux la page).
  const photoAvailH = pageH - mm(PAD_MM) * 2 - mm(HEADER_RESERVE_MM);
  const st = makeStyles(pageW, pageH);

  const dateRange = fmtDateRange(summary);

  const entries = days
    .map((d, i) => ({
      i,
      location: d?.location || '',
      ...(album?.days?.[i] || { title: '', note: '', photos: [] }),
    }))
    .map((e) => ({ ...e, photos: (e.photos || []).filter((p) => imgFull(p)) }))
    // On ne crée pas de page pour une journée totalement vide.
    .filter((e) => e.photos.length > 0 || (e.note || '').trim() || (e.title || '').trim());

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
        <CoverFade color={PALETTE.ink} />
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
      {routeMap && (
        <Page size={[pageW, pageH]} style={st.page}>
          <View style={st.header}>
            <Text style={st.dayKicker}>Itinéraire</Text>
            <Text style={st.dayTitle}>La carte du voyage</Text>
          </View>
          <View style={st.mapWrap}>
            <Image src={routeMap} style={st.mapImg} />
          </View>
          {stops.filter(Boolean).length > 0 && (
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
      )}

      {/* UNE PAGE PAR JOURNÉE */}
      {entries.map((e) => {
        const rows = buildFillLayout(e.photos, contentW, photoAvailH, mm(GAP_MM));
        return (
          <Page key={e.i} size={[pageW, pageH]} style={st.page}>
            <View style={st.header}>
              <Text style={st.dayKicker}>
                Jour {e.i + 1}{e.location ? ` · ${e.location}` : ''}
              </Text>
              {e.title ? <Text style={st.dayTitle}>{e.title}</Text> : null}
              {e.note ? <Text style={st.note}>{e.note}</Text> : null}
            </View>

            {rows.length > 0 && (
              // flexGrow:1 → la mosaïque occupe TOUTE la hauteur restante.
              <View style={st.mosaic}>
                {rows.map((row, ri) => (
                  <View
                    key={ri}
                    style={{
                      flexGrow: row.naturalH,
                      flexBasis: 0,
                      flexDirection: 'row',
                      marginBottom: ri < rows.length - 1 ? mm(GAP_MM) : 0,
                    }}
                  >
                    {row.items.map((it, ci) => (
                      <View
                        key={ci}
                        style={{
                          flexGrow: it.ar,
                          flexBasis: 0,
                          marginRight: ci < row.items.length - 1 ? mm(GAP_MM) : 0,
                          position: 'relative',
                        }}
                      >
                        <Image src={imgFull(it.photo)} style={st.mosaicImg} />
                        {it.photo.caption ? (
                          <View style={st.capWrap}>
                            <Text style={st.capTxt}>{it.photo.caption}</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Page>
        );
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

function makeStyles(pageW, pageH) {
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
      backgroundColor: PALETTE.paper,
      fontFamily: 'AlbumBody',
      color: PALETTE.text,
    },

    coverPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: PALETTE.ink },
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
    coverRule: { width: mm(16), height: 2, backgroundColor: PALETTE.accent, marginTop: 12, marginBottom: 10 },
    coverDates: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 11, letterSpacing: 1, color: '#FFFFFF', opacity: 0.95 },

    header: { flexShrink: 0, marginBottom: mm(4) },
    dayKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 8.5, letterSpacing: 2, textTransform: 'uppercase', color: PALETTE.accent, marginBottom: 5 },
    dayTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 22, color: PALETTE.ink, lineHeight: 1.1 },
    note: { fontFamily: 'AlbumBody', fontWeight: 300, fontSize: 10.5, lineHeight: 1.5, color: PALETTE.text, marginTop: 6 },

    // Carte du voyage : la carte occupe l'espace, la liste des étapes dessous.
    mapWrap: { flexGrow: 1, marginTop: mm(2), borderWidth: 1, borderColor: PALETTE.line, backgroundColor: '#e9e6df' },
    mapImg: { width: '100%', height: '100%', objectFit: 'contain' },
    stops: { flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', marginTop: mm(4) },
    stopItem: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 6, paddingRight: 8 },
    stopNum: { width: 16, height: 16, borderRadius: 8, backgroundColor: PALETTE.accent, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
    stopNumTxt: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 7.5, color: '#FFFFFF' },
    stopLabel: { flex: 1, fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 9.5, color: PALETTE.ink },

    // flexGrow:1 → la mosaïque prend toute la hauteur restante de la page.
    mosaic: { flexGrow: 1, flexDirection: 'column', marginTop: mm(2) },
    mosaicImg: { width: '100%', height: '100%', objectFit: 'cover' },
    capWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.42)', paddingVertical: 2, paddingHorizontal: 4 },
    capTxt: { fontFamily: 'AlbumBody', fontWeight: 400, fontStyle: 'italic', fontSize: 7.5, color: '#FFFFFF' },

    // Page de fin (quatrième de couverture) : fond sombre, texte centré.
    endPage: { position: 'relative', width: pageW, height: pageH, backgroundColor: PALETTE.ink, justifyContent: 'center', alignItems: 'center', paddingHorizontal: pad },
    endImgWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    endScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,22,22,0.58)' },
    endInner: { alignItems: 'center' },
    endKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: PALETTE.accent, marginBottom: 14 },
    endTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 28, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.1 },
    endDates: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 11, letterSpacing: 1, color: '#FFFFFF', opacity: 0.85, marginTop: 8 },
    endRule: { width: mm(20), height: 2, backgroundColor: PALETTE.accent, marginVertical: 20 },
    endQuote: { fontFamily: 'AlbumDisplay', fontWeight: 300, fontStyle: 'italic', fontSize: 14, color: '#FFFFFF', opacity: 0.92, textAlign: 'center', maxWidth: mm(120) },
    endBrand: { fontFamily: 'AlbumBody', fontWeight: 400, fontSize: 8.5, letterSpacing: 2, textTransform: 'uppercase', color: '#FFFFFF', opacity: 0.6, marginTop: 28 },
  });
}
