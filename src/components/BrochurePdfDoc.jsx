/**
 * BrochurePdfDoc.jsx — Brochure PDF « agence de voyage » (style tour-opérateur)
 * Construit avec @react-pdf/renderer. Adapté aux données TravelO (trip.itinerary).
 *
 * Props :
 *   - itinerary : objet { summary, days[], budget_summary, notes }
 *   - photos    : { cover, overview, days:{[idx]:[url,...]}, food:{[idx]:url} }
 *
 * Polices chargées depuis un CDN public (jsDelivr / google fonts) — pas de
 * fichier local à fournir. Les ambiances (couleurs) sont déduites de la
 * destination, ou forcées via itinerary.themeKey.
 */
import React from 'react';
import {
  Document, Page, View, Text, Image, StyleSheet, Font,
  Svg, Path, Circle, Rect, Line, Defs, LinearGradient, Stop,
} from '@react-pdf/renderer';

const WHITE = '#FFFFFF';
const CDN = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl';

/* Polices — enregistrées une fois au chargement du module (depuis le CDN). */
Font.register({
  family: 'Spectral',
  fonts: [
    { src: `${CDN}/spectral/Spectral-Light.ttf`, fontWeight: 300 },
    { src: `${CDN}/spectral/Spectral-LightItalic.ttf`, fontWeight: 300, fontStyle: 'italic' },
    { src: `${CDN}/spectral/Spectral-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/spectral/Spectral-Medium.ttf`, fontWeight: 500 },
    { src: `${CDN}/spectral/Spectral-SemiBold.ttf`, fontWeight: 600 },
  ],
});
Font.register({
  family: 'Lato',
  fonts: [
    { src: `${CDN}/lato/Lato-Light.ttf`, fontWeight: 300 },
    { src: `${CDN}/lato/Lato-LightItalic.ttf`, fontWeight: 300, fontStyle: 'italic' },
    { src: `${CDN}/lato/Lato-Regular.ttf`, fontWeight: 400 },
    { src: `${CDN}/lato/Lato-Italic.ttf`, fontWeight: 400, fontStyle: 'italic' },
    { src: `${CDN}/lato/Lato-Bold.ttf`, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

/* ----------------------------- THÈMES ----------------------------- */
const THEMES = {
  mediterranee: {
    palette: { ink: '#1C2B2D', primary: '#0F4C45', accent: '#C8A04B', paper: '#FAF6EF', text: '#4A4640', line: '#E4DCCD', panel: '#F3ECDD' },
    fonts: { display: 'Spectral', body: 'Lato' },
  },
  asie: {
    palette: { ink: '#1E2233', primary: '#27408B', accent: '#D7482F', paper: '#F7F1E6', text: '#4A4A52', line: '#E5DCCB', panel: '#F2E9DA' },
    fonts: { display: 'Spectral', body: 'Lato' },
  },
  nordique: {
    palette: { ink: '#1E2A30', primary: '#2F4858', accent: '#5E8CA7', paper: '#F4F6F7', text: '#46535B', line: '#DCE3E6', panel: '#EAF0F3' },
    fonts: { display: 'Spectral', body: 'Lato' },
  },
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function resolveTheme(itinerary) {
  const key = itinerary?.themeKey || itinerary?.summary?.themeKey;
  if (key && THEMES[key]) return THEMES[key];
  const hay = norm(`${itinerary?.summary?.destinations || ''} ${itinerary?.summary?.country || ''}`);
  const ASIE = ['japon', 'japan', 'asie', 'chine', 'china', 'thailande', 'vietnam', 'coree', 'korea', 'bali', 'indonesie', 'inde', 'cambodge', 'laos'];
  const NORD = ['norvege', 'suede', 'islande', 'finlande', 'danemark', 'scandinavie', 'laponie', 'groenland', 'feroe'];
  if (ASIE.some((k) => hay.includes(k))) return THEMES.asie;
  if (NORD.some((k) => hay.includes(k))) return THEMES.nordique;
  return THEMES.mediterranee;
}

/* ----------------------------- ICÔNES ----------------------------- */
function Icon({ type, size = 13, color = '#0F4C45' }) {
  const s = { stroke: color, strokeWidth: 1.6, fill: 'none' };
  const inner = {
    transport: (<><Path d="M5 13 L6.5 8 L17.5 8 L19 13" {...s} /><Rect x="4" y="13" width="16" height="4.5" rx="1.2" {...s} /><Circle cx="8" cy="18.5" r="1.6" {...s} /><Circle cx="16" cy="18.5" r="1.6" {...s} /></>),
    repas: (<><Line x1="8" y1="4" x2="8" y2="20" {...s} /><Line x1="6" y1="4" x2="6" y2="8" {...s} /><Line x1="10" y1="4" x2="10" y2="8" {...s} /><Line x1="6" y1="8" x2="10" y2="8" {...s} /><Path d="M16 4 C18 6 18 9.5 16 11 L16 20" {...s} /></>),
    visite: (<><Path d="M12 3 C8.2 3 5.5 6 5.5 9.6 C5.5 14 12 21 12 21 C12 21 18.5 14 18.5 9.6 C18.5 6 15.8 3 12 3 Z" {...s} /><Circle cx="12" cy="9.6" r="2.4" {...s} /></>),
    detente: (<><Path d="M5 9 L17 9 L16 16.5 C16 18 14.8 19 13.3 19 L8.7 19 C7.2 19 6 18 6 16.5 Z" {...s} /><Path d="M17 10.5 C19.5 10.5 19.5 14.5 17 14.5" {...s} /></>),
    hebergement: (<><Path d="M4 8 L4 18" {...s} /><Path d="M4 12.5 L20 12.5 L20 18" {...s} /><Path d="M4 18 L20 18" {...s} /><Path d="M7 12.5 L7 10.2 C7 9.6 7.5 9.2 8 9.2 L12 9.2 C12.5 9.2 13 9.6 13 10.2 L13 12.5" {...s} /></>),
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24">{inner[type] || inner.visite}</Svg>;
}

function FadeOverlay({ height = 320, color = '#1C2B2D' }) {
  return (
    <Svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height }}>
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0" />
          <Stop offset="0.55" stopColor={color} stopOpacity="0.55" />
          <Stop offset="1" stopColor={color} stopOpacity="0.92" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
    </Svg>
  );
}

/* --------------------------- HELPERS DATA -------------------------- */
const MOMENTS = [
  ['morning', 'Matin', 'visite'],
  ['noon', 'Midi', 'repas'],
  ['afternoon', 'Après-midi', 'visite'],
  ['evening', 'Soir', 'detente'],
];

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}
function travelersLabel(s) {
  const a = s?.travellers?.adults || 0;
  const c = s?.travellers?.children_ages?.length || 0;
  if (!a && !c) return '';
  return `${a} adulte${a > 1 ? 's' : ''}${c ? ` · ${c} enfant${c > 1 ? 's' : ''}` : ''}`;
}
// Formatage € avec une espace normale (la police PDF ne gère pas l'espace
// fine insécable de toLocaleString → affichait « 1/405 »).
const eur = (n) => {
  if (n == null || isNaN(Number(n))) return null;
  return `${Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
};

/* ============================== DOCUMENT =========================== */
export default function BrochurePdfDoc({ itinerary, photos = {} }) {
  const s = itinerary?.summary || {};
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const notes = itinerary?.notes || {};
  const budget = itinerary?.budget_summary || {};
  const theme = resolveTheme(itinerary);
  const P = theme.palette;
  const st = makeStyles(theme);

  const dayPhotos = (i) => (photos.days && photos.days[i]) || [];
  const meta = {
    duration: s.duration_days ? `${s.duration_days} jours` : '',
    travelers: travelersLabel(s),
    season: s.start_date ? `${fmtDate(s.start_date)} → ${fmtDate(s.end_date)}` : '',
  };
  const highlights = days.slice(0, 5).map((d) => d.day_title || d.location).filter(Boolean);

  const Eyebrow = ({ children, color = P.accent }) => (
    <Text style={[st.eyebrow, { color }]}>{children}</Text>
  );
  const Footer = () => (
    <View style={st.footer} fixed>
      <View style={st.footerLine} />
      <View style={st.footerRow}>
        <Text style={st.footerTxt}>TravelO · {s.destinations || ''}</Text>
        <Text style={st.footerTxt} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  );

  return (
    <Document title={`${s.destinations || 'Voyage'} — TravelO`} author="TravelO">
      {/* 1. COUVERTURE */}
      <Page size="A4" style={st.coverPage}>
        {photos.cover && (
          <View style={st.coverBg}><Image src={photos.cover} style={st.coverImg} /></View>
        )}
        <FadeOverlay height={440} color={P.ink} />
        <View style={st.coverContent}>
          <View style={st.coverTop}>
            <Text style={st.coverBrand}>TravelO</Text>
            <View style={st.coverBrandLine} />
            <Text style={st.coverTagline}>Voyages sur mesure</Text>
          </View>
          <View>
            <Eyebrow>Votre itinéraire sur mesure</Eyebrow>
            <Text style={st.coverTitle}>{s.destinations || 'Votre voyage'}</Text>
            {s.headline ? <Text style={st.coverSub}>{s.headline}</Text> : null}
            <View style={st.coverRule} />
            <View style={st.coverMeta}>
              {[meta.duration, meta.travelers, meta.season].filter(Boolean).map((m, i) => (
                <View key={i} style={st.coverMetaItem}>
                  {i > 0 && <Text style={st.coverMetaSep}>·</Text>}
                  <Text style={st.coverMetaTxt}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Page>

      {/* 2. EN UN COUP D'ŒIL */}
      <Page size="A4" style={st.page}>
        <Eyebrow>Présentation</Eyebrow>
        <Text style={st.h1}>En un coup d'œil</Text>
        {s.headline ? <Text style={st.lead}>{s.headline}</Text> : null}
        {photos.overview && <Image src={photos.overview} style={st.overviewImg} />}
        {highlights.length > 0 && (
          <>
            <Text style={st.h3}>Les temps forts du voyage</Text>
            <View>
              {highlights.map((h, i) => (
                <View key={i} style={st.hlItem}>
                  <View style={st.hlMark} />
                  <Text style={st.hlTxt}>{h}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={st.metaCards}>
          {[['Durée', meta.duration], ['Voyageurs', meta.travelers], ['Période', meta.season], ['Budget', eur(budget.grand_total_eur)]]
            .filter(([, v]) => v)
            .map(([k, v], i) => (
              <View key={i} style={st.metaCard}>
                <Text style={st.metaCardK}>{k}</Text>
                <Text style={st.metaCardV}>{v}</Text>
              </View>
            ))}
        </View>
        <Footer />
      </Page>

      {/* 2bis. VOTRE ITINÉRAIRE (carte du parcours) */}
      {photos.routeMap && (
        <Page size="A4" style={st.page}>
          <Eyebrow>Itinéraire</Eyebrow>
          <Text style={st.h1}>Votre parcours</Text>
          <Text style={st.lead}>Le tracé complet de votre voyage, étape par étape.</Text>
          <Image src={photos.routeMap} style={st.routeImg} />
          <View style={st.routeList}>
            {days.map((d, i) => (
              <View key={i} style={st.routeItem}>
                <View style={st.routeNum}><Text style={st.routeNumTxt}>{i + 1}</Text></View>
                <Text style={st.routeLabel}>{d.location}</Text>
              </View>
            ))}
          </View>
          <Footer />
        </Page>
      )}

      {/* 3. UNE PAGE PAR JOUR */}
      {days.map((d, i) => {
        const ph = dayPhotos(i);
        const activities = MOMENTS
          .map(([k, label, type]) => {
            const m = d[k];
            if (!m || (!m.title && !m.description)) return null;
            return { time: label, type, title: m.title || label, text: m.description || '' };
          })
          .filter(Boolean);
        return (
          <Page key={i} size="A4" style={st.dayPage}>
            <View style={st.dayHero}>
              {ph[0] && <Image src={ph[0]} style={st.dayHeroImg} />}
              <FadeOverlay height={180} color={P.ink} />
              <View style={st.dayHeroTxt}>
                <Eyebrow color={WHITE}>Jour {String(i + 1).padStart(2, '0')} · {d.location}</Eyebrow>
              </View>
            </View>
            <View style={st.dayBody}>
              <Text style={st.dayTitle}>{d.day_title || d.location}</Text>
              {d.weather?.description ? <Text style={st.daySummary}>{d.weather.description}</Text> : null}

              {ph.length > 1 && (
                <View style={st.photoStrip}>
                  {ph.slice(1, 3).map((u, k) => (
                    <Image key={k} src={u} style={st.photoStripImg} />
                  ))}
                </View>
              )}

              <View style={st.timeline}>
                <View style={st.timelineRail} />
                {activities.map((a, k) => (
                  <View key={k} style={st.tlRow} wrap={false}>
                    <Text style={st.tlTime}>{a.time}</Text>
                    <View style={st.tlChip}><Icon type={a.type} color={P.primary} /></View>
                    <View style={st.tlContent}>
                      <Text style={st.tlTitle}>{a.title}</Text>
                      {a.text ? <Text style={st.tlText}>{a.text}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>

              {Array.isArray(d.trips) && d.trips.filter((t) => t && (t.from || t.to)).map((t, k) => (
                <View key={k} style={st.stayRow}>
                  <View style={st.tripIcon}><Icon type="transport" color={WHITE} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.stayK}>Trajet</Text>
                    <Text style={st.stayV}>{t.from} → {t.to}</Text>
                    {(() => {
                      const meta = [
                        t.distance_km ? `${t.distance_km} km` : null,
                        t.duration || null,
                        t.estimated_cost_eur ? eur(t.estimated_cost_eur) : null,
                      ].filter(Boolean).join('   ·   ');
                      return meta ? <Text style={st.tripMeta}>{meta}</Text> : null;
                    })()}
                  </View>
                </View>
              ))}

              {d.accommodation?.name && (
                <View style={st.stayRow}>
                  <View style={st.stayIcon}><Icon type="hebergement" color={WHITE} /></View>
                  <View>
                    <Text style={st.stayK}>Nuit</Text>
                    <Text style={st.stayV}>
                      {d.accommodation.name}
                      {d.accommodation.price_eur ? ` · ${eur(d.accommodation.price_eur)}` : ''}
                    </Text>
                  </View>
                </View>
              )}

              {d.culinary_specialties?.[0]?.name && (
                <View style={st.tipBox}>
                  <Text style={st.tipLabel}>À goûter</Text>
                  <Text style={st.tipTxt}>
                    {d.culinary_specialties[0].name}
                    {d.culinary_specialties[0].description ? ` — ${d.culinary_specialties[0].description}` : ''}
                  </Text>
                </View>
              )}
            </View>
            <Footer />
          </Page>
        );
      })}

      {/* 4. INFOS PRATIQUES */}
      <Page size="A4" style={st.page}>
        <Eyebrow>Pour finir</Eyebrow>
        <Text style={st.h1}>Informations pratiques</Text>

        {budget.grand_total_eur != null && (
          <View style={st.budgetBox}>
            <Text style={st.h3}>Budget prévisionnel</Text>
            {[
              ['Transports', budget.trips_eur],
              ['Carburant', budget.fuel_eur],
              ['Péages', budget.tolls_eur],
              ['Ferries', budget.ferries_eur],
              ['Hébergement', budget.accommodation_eur],
              ['Repas', budget.meals_eur],
              ['Activités / excursions', budget.activities_eur],
            ]
              .filter(([, v]) => v != null && Number(v) !== 0)
              .map(([k, v], i) => (
                <View key={i} style={st.budgetLine}>
                  <Text style={st.budgetLineK}>{k}</Text>
                  <Text style={st.budgetLineV}>{eur(v)}</Text>
                </View>
              ))}
            <View style={st.budgetTotalLine}>
              <Text style={st.budgetTotalK}>Total estimé</Text>
              <Text style={st.budgetTotalV}>{eur(budget.grand_total_eur)}</Text>
            </View>
            {budget.per_person_eur != null && (
              <View style={st.budgetLine}>
                <Text style={st.budgetPP}>par personne</Text>
                <Text style={st.budgetPP}>{eur(budget.per_person_eur)}</Text>
              </View>
            )}
          </View>
        )}

        {notes.practical_tips?.length > 0 && (
          <>
            <Text style={st.h3}>Bon à savoir</Text>
            {notes.practical_tips.slice(0, 8).map((t, i) => (
              <View key={i} style={st.checkItem}>
                <Text style={[st.checkMark, { color: P.primary }]}>•</Text>
                <Text style={st.checkTxt}>{t}</Text>
              </View>
            ))}
          </>
        )}

        {notes.packing_list && (
          <>
            <Text style={st.h3}>À emporter</Text>
            <View style={st.twoCol}>
              {[['Essentiels', notes.packing_list.essentials], ['Vêtements', notes.packing_list.clothing], ['Papiers & tech', notes.packing_list.tech_and_papers]]
                .filter(([, arr]) => arr?.length)
                .map(([label, arr], i) => (
                  <View key={i} style={st.col}>
                    <Text style={st.packK}>{label}</Text>
                    {arr.slice(0, 6).map((x, k) => (
                      <Text key={k} style={st.packTxt}>· {x}</Text>
                    ))}
                  </View>
                ))}
            </View>
          </>
        )}

        <Text style={st.closing}>Bon voyage.</Text>
        <Footer />
      </Page>
    </Document>
  );
}

/* ----------------------------- STYLES ----------------------------- */
function makeStyles(theme) {
  const P = theme.palette;
  const D = theme.fonts.display;
  const B = theme.fonts.body;
  return StyleSheet.create({
    page: { backgroundColor: P.paper, paddingTop: 54, paddingHorizontal: 50, paddingBottom: 60, fontFamily: B, color: P.text },

    coverPage: { position: 'relative' },
    coverBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
    coverContent: { minHeight: '100%', paddingTop: 46, paddingBottom: 64, paddingHorizontal: 50, justifyContent: 'space-between' },
    coverTop: { alignItems: 'center' },
    coverBrand: { fontFamily: D, fontWeight: 500, fontSize: 22, color: WHITE, letterSpacing: 4 },
    coverBrandLine: { width: 34, height: 1.4, backgroundColor: P.accent, marginVertical: 8 },
    coverTagline: { fontFamily: B, fontWeight: 300, fontSize: 8.5, color: WHITE, letterSpacing: 3, textTransform: 'uppercase' },
    coverTitle: { fontFamily: D, fontWeight: 600, fontSize: 52, color: WHITE, lineHeight: 1.05, marginTop: 8 },
    coverSub: { fontFamily: B, fontWeight: 300, fontSize: 11.5, color: WHITE, marginTop: 14, maxWidth: 380, lineHeight: 1.5 },
    coverRule: { width: 48, height: 2, backgroundColor: P.accent, marginTop: 18, marginBottom: 14 },
    coverMeta: { flexDirection: 'row', alignItems: 'center' },
    coverMetaItem: { flexDirection: 'row', alignItems: 'center' },
    coverMetaSep: { color: P.accent, marginHorizontal: 9, fontSize: 10 },
    coverMetaTxt: { fontFamily: B, fontWeight: 400, fontSize: 9.5, color: WHITE, letterSpacing: 1, textTransform: 'uppercase' },

    eyebrow: { fontFamily: B, fontWeight: 700, fontSize: 8.5, letterSpacing: 2.5, textTransform: 'uppercase' },
    h1: { fontFamily: D, fontWeight: 600, fontSize: 32, color: P.ink, marginTop: 6, marginBottom: 14 },
    h3: { fontFamily: D, fontWeight: 600, fontSize: 14, color: P.primary, marginTop: 14, marginBottom: 10 },
    lead: { fontFamily: B, fontWeight: 300, fontSize: 11, lineHeight: 1.65, color: P.text, marginBottom: 16 },

    overviewImg: { width: '100%', height: 150, objectFit: 'cover', marginBottom: 6 },
    hlItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 },
    hlMark: { width: 5, height: 5, backgroundColor: P.accent, borderRadius: 2.5, marginTop: 4, marginRight: 10 },
    hlTxt: { flex: 1, fontFamily: B, fontSize: 10.5, lineHeight: 1.5, color: P.text },
    routeImg: { width: '100%', height: 360, objectFit: 'cover', borderWidth: 1, borderColor: P.line, marginTop: 4, marginBottom: 16 },
    routeList: { flexDirection: 'row', flexWrap: 'wrap' },
    routeItem: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 7, paddingRight: 8 },
    routeNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: P.accent, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
    routeNumTxt: { fontFamily: B, fontWeight: 700, fontSize: 8, color: WHITE },
    routeLabel: { flex: 1, fontFamily: B, fontWeight: 400, fontSize: 10.5, color: P.ink },

    metaCards: { flexDirection: 'row', marginTop: 22, gap: 10 },
    metaCard: { flex: 1, borderTopWidth: 2, borderTopColor: P.accent, paddingTop: 8 },
    metaCardK: { fontFamily: B, fontWeight: 700, fontSize: 7.5, letterSpacing: 1.5, textTransform: 'uppercase', color: P.primary, marginBottom: 3 },
    metaCardV: { fontFamily: D, fontWeight: 500, fontSize: 11, color: P.ink },

    dayPage: { backgroundColor: P.paper, fontFamily: B, color: P.text, paddingBottom: 60 },
    dayHero: { position: 'relative', height: 210 },
    dayHeroImg: { width: '100%', height: '100%', objectFit: 'cover' },
    dayHeroTxt: { position: 'absolute', bottom: 16, left: 50 },
    dayBody: { paddingHorizontal: 50, paddingTop: 20 },
    dayTitle: { fontFamily: D, fontWeight: 600, fontSize: 24, color: P.ink, lineHeight: 1.1 },
    daySummary: { fontFamily: B, fontWeight: 300, fontStyle: 'italic', fontSize: 10.5, lineHeight: 1.5, color: P.text, marginTop: 6, marginBottom: 14 },
    photoStrip: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    photoStripImg: { flex: 1, height: 90, objectFit: 'cover', borderRadius: 2 },

    timeline: { position: 'relative' },
    timelineRail: { position: 'absolute', left: 53, top: 6, bottom: 6, width: 1.2, backgroundColor: P.line },
    tlRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
    tlTime: { width: 50, fontFamily: B, fontWeight: 700, fontSize: 8.5, color: P.primary, textAlign: 'right', marginTop: 5, textTransform: 'uppercase' },
    tlChip: { width: 24, height: 24, borderRadius: 12, backgroundColor: WHITE, borderWidth: 1.2, borderColor: P.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 7, marginRight: 14 },
    tlContent: { flex: 1, paddingTop: 1 },
    tlTitle: { fontFamily: B, fontWeight: 700, fontSize: 10.5, color: P.ink, marginBottom: 2 },
    tlText: { fontFamily: B, fontWeight: 300, fontSize: 9.5, lineHeight: 1.5, color: P.text },

    stayRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 14 },
    stayIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: P.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    tripIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: P.accent, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    tripMeta: { fontFamily: B, fontWeight: 700, fontSize: 9.5, color: P.primary, marginTop: 1 },
    stayK: { fontFamily: B, fontWeight: 700, fontSize: 7.5, letterSpacing: 1.5, textTransform: 'uppercase', color: P.primary },
    stayV: { fontFamily: D, fontWeight: 500, fontSize: 11.5, color: P.ink },

    tipBox: { backgroundColor: P.panel, borderLeftWidth: 3, borderLeftColor: P.accent, paddingVertical: 12, paddingHorizontal: 16 },
    tipLabel: { fontFamily: B, fontWeight: 700, fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase', color: P.accent, marginBottom: 4 },
    tipTxt: { fontFamily: B, fontWeight: 400, fontStyle: 'italic', fontSize: 10, lineHeight: 1.5, color: P.ink },

    budgetBox: { backgroundColor: P.panel, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 6 },
    budgetLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    budgetLineK: { fontFamily: B, fontWeight: 400, fontSize: 10, color: P.text },
    budgetLineV: { fontFamily: B, fontWeight: 700, fontSize: 10, color: P.ink },
    budgetTotalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: P.line },
    budgetTotalK: { fontFamily: B, fontWeight: 700, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: P.primary },
    budgetTotalV: { fontFamily: D, fontWeight: 600, fontSize: 18, color: P.ink },
    budgetPP: { fontFamily: B, fontWeight: 400, fontSize: 9, color: P.text },

    twoCol: { flexDirection: 'row', gap: 24 },
    col: { flex: 1 },
    packK: { fontFamily: B, fontWeight: 700, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', color: P.primary, marginBottom: 5 },
    packTxt: { fontFamily: B, fontWeight: 400, fontSize: 9.5, lineHeight: 1.5, color: P.text },
    checkItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
    checkMark: { width: 12, fontFamily: B, fontWeight: 700, fontSize: 11, marginTop: 0.5 },
    checkTxt: { flex: 1, fontFamily: B, fontSize: 10, lineHeight: 1.45, color: P.text },

    closing: { fontFamily: D, fontWeight: 300, fontStyle: 'italic', fontSize: 18, color: P.primary, textAlign: 'center', marginTop: 30 },

    footer: { position: 'absolute', bottom: 28, left: 50, right: 50 },
    footerLine: { height: 0.8, backgroundColor: P.line, marginBottom: 7 },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    footerTxt: { fontFamily: B, fontWeight: 400, fontSize: 7.5, letterSpacing: 0.8, textTransform: 'uppercase', color: P.text },
  });
}
