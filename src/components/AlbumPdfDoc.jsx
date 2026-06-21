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

function CoverFade({ color = '#1C2B2D' }) {
  return (
    <Svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '60%' }}>
      <Defs>
        <LinearGradient id="albFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0" />
          <Stop offset="0.6" stopColor={color} stopOpacity="0.45" />
          <Stop offset="1" stopColor={color} stopOpacity="0.85" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#albFade)" />
    </Svg>
  );
}

export default function AlbumPdfDoc({ album, days = [], format = 'carre' }) {
  const fmt = FORMATS[format] || FORMATS.carre;
  // Page = format final + 3 mm de fond perdu sur chaque bord.
  const pageW = mm(fmt.trimW + BLEED_MM * 2);
  const pageH = mm(fmt.trimH + BLEED_MM * 2);
  const st = makeStyles(pageW, pageH);

  const entries = days.map((d, i) => ({
    i,
    location: d?.location || '',
    ...(album?.days?.[i] || { title: '', note: '', photos: [] }),
  }));

  // Couverture : celle choisie par l'utilisateur, sinon la première photo
  // disponible de l'album.
  let cover = album?.cover || null;
  if (!cover) {
    for (const e of entries) {
      if (e.photos?.length) { cover = e.photos[0]; break; }
    }
  }

  return (
    <Document title={`${album?.title || 'Album'} — TravelO`} author="TravelO">
      {/* COUVERTURE — photo pleine page jusqu'au fond perdu */}
      <Page size={[pageW, pageH]} style={st.coverPage}>
        {cover ? (
          <Image src={imgFull(cover)} style={st.coverImg} />
        ) : (
          <View style={st.coverPlain} />
        )}
        <CoverFade color={PALETTE.ink} />
        <View style={st.coverContent}>
          <Text style={st.coverKicker}>Album de voyage</Text>
          <Text style={st.coverTitle}>{album?.title || 'Mon voyage'}</Text>
        </View>
      </Page>

      {/* UNE PAGE PAR JOURNÉE */}
      {entries.map((e) => {
        const photos = (e.photos || []).filter((p) => imgFull(p));
        const single = photos.length === 1;
        return (
          <Page key={e.i} size={[pageW, pageH]} style={st.page} wrap>
            <View style={st.header}>
              <Text style={st.dayKicker}>
                Jour {e.i + 1}{e.location ? ` · ${e.location}` : ''}
              </Text>
              {e.title ? <Text style={st.dayTitle}>{e.title}</Text> : null}
              {e.note ? <Text style={st.note}>{e.note}</Text> : null}
            </View>

            {photos.length > 0 && (
              <View style={st.grid}>
                {photos.map((p, k) => (
                  <View
                    key={k}
                    style={single ? st.cellFull : st.cellHalf}
                    wrap={false}
                  >
                    <Image
                      src={imgFull(p)}
                      style={single ? st.photoFull : st.photoHalf}
                    />
                    {p.caption ? (
                      <Text style={st.caption}>{p.caption}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}

            <Text
              style={st.pageNum}
              render={({ pageNumber }) => String(pageNumber)}
              fixed
            />
          </Page>
        );
      })}
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
      paddingTop: pad,
      paddingBottom: pad,
      paddingHorizontal: pad,
      backgroundColor: PALETTE.paper,
      fontFamily: 'AlbumBody',
      color: PALETTE.text,
    },

    coverPage: { position: 'relative', width: pageW, height: pageH },
    coverImg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' },
    coverPlain: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: PALETTE.ink },
    coverContent: { position: 'absolute', left: pad, right: pad, bottom: pad },
    coverKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#FFFFFF', marginBottom: 8, opacity: 0.9 },
    coverTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 38, lineHeight: 1.05, color: '#FFFFFF' },

    header: { marginBottom: mm(6) },
    dayKicker: { fontFamily: 'AlbumBody', fontWeight: 700, fontSize: 8.5, letterSpacing: 2, textTransform: 'uppercase', color: PALETTE.accent, marginBottom: 5 },
    dayTitle: { fontFamily: 'AlbumDisplay', fontWeight: 600, fontSize: 22, color: PALETTE.ink, lineHeight: 1.1 },
    note: { fontFamily: 'AlbumBody', fontWeight: 300, fontSize: 10.5, lineHeight: 1.55, color: PALETTE.text, marginTop: 7 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: mm(2) },
    cellFull: { width: '100%', marginBottom: mm(4) },
    cellHalf: { width: '50%', padding: mm(1.5) },
    photoFull: { width: '100%', height: mm(120), objectFit: 'cover' },
    photoHalf: { width: '100%', height: mm(62), objectFit: 'cover' },
    caption: { fontFamily: 'AlbumBody', fontWeight: 400, fontStyle: 'italic', fontSize: 8.5, color: PALETTE.soft, marginTop: 4 },

    pageNum: { position: 'absolute', bottom: mm(5), left: 0, right: 0, textAlign: 'center', fontFamily: 'AlbumBody', fontSize: 7.5, color: PALETTE.soft },
  });
}
