import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import {
  getItinerary,
  updateItinerary,
  uploadAlbumPhoto,
  uploadAlbumSticker,
  repairAlbumPhoto,
} from '../lib/supabase';
import { renderRouteMapImage } from '../lib/staticMapImage';
import { writeAlbumText, pixabaySearch, pixabayFetch } from '../lib/ai';
import AlbumPdfDoc from '../components/AlbumPdfDoc';
import PdfPagesPreview from '../components/PdfPagesPreview';
import { pdfBlobToImageFiles } from '../lib/pdfToImages';
import useBackClose from '../lib/useBackClose';
import {
  FORMAT_LABELS,
  PHOTOS_PER_PAGE,
  balancedSplit,
  computeSplit,
  BG_COLORS,
  normalizeBg,
  PHOTO_EFFECTS,
  getPhotoEffect,
  bakePhotoEffects,
  ALBUM_THEMES,
  getTheme,
  STICKER_CATEGORIES,
  splitPhotos,
  pageLayout,
  seedFreeBoxes,
  isManualLayout,
  repairSplit,
  addPhotosToEntry,
  resolveBg,
  unitLabel,
  bgIsEmpty,
  autoBgFromPhotos,
  formatDateRange,
  FORMAT_DIMS,
  computeBubble,
  FONT_CHOICES,
  fontCss,
  getFrameShape,
  shapeClipCss,
  photoFocal,
  coverFrac,
  frameInsetFrac,
} from '../lib/albumModel';

// Petit indicateur de chargement animé (réutilisé sur les boutons d'envoi).
export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// Aperçu fidèle d'une couverture (avant ou fin) + réglages de mise en page.
// variant : 'cover' (1re de couverture) ou 'end' (page de fin / 4e de couv).
export function CoverDesigner({ variant = 'cover', photo, title, dates, note, onChangeNote, format = 'carre', theme = null, layout = {}, onChangeLayout, onChoose, onClear, spreadHalf = null, spreadPhoto = null, compact = false, seamless = false }) {
  const isEnd = variant === 'end';
  const spreadSrc = spreadHalf && (spreadPhoto?.display || spreadPhoto?.full);
  const dims = FORMAT_DIMS[format] || FORMAT_DIMS.carre;
  const aspect = dims.trimW / dims.trimH;
  const pos = layout.pos || (isEnd ? 'center' : 'bottom');
  const align = layout.align || (isEnd ? 'center' : 'left');
  const kicker = layout.kicker != null ? layout.kicker : (isEnd ? 'Fin du voyage' : 'Album de voyage');
  const showDates = layout.showDates !== false;
  const ink = theme?.ink || '#1C2B2D';
  const accent = theme?.accent || '#C8643C';
  const set = (patch) => onChangeLayout({ ...layout, ...patch });
  const justify = pos === 'top' ? 'flex-start' : pos === 'bottom' ? 'flex-end' : 'center';
  const items = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const src = photo?.display || photo?.full || null;
  // Affichage de la photo : « cover » remplit la page (recadrée si besoin) ;
  // « contain » = photo ENTIÈRE, jamais découpée, taille réglable, fond coloré.
  const fit = layout.fit === 'contain' ? 'contain' : 'cover';
  const photoScale = Math.min(1, Math.max(0.3, layout.photoScale ?? 1));
  const photoBg = layout.photoBg || ink;

  const seg = (current, k, val, label) => (
    <button type="button" onClick={() => set({ [k]: val })}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${current === val ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <div className={`mt-4 flex flex-col gap-4 ${compact ? '' : 'sm:flex-row'}`}>
      {/* Aperçu */}
      <div className={compact ? '' : 'shrink-0'}>
        <div
          className={`relative ${compact ? 'w-full' : 'w-56'} max-w-full overflow-hidden ${seamless ? '' : 'rounded-lg border border-slate-200 shadow-sm'}`}
          style={{ aspectRatio: String(aspect), containerType: 'size', backgroundColor: !spreadHalf && fit === 'contain' ? photoBg : ink }}
        >
          {spreadHalf ? (
            spreadSrc ? (
              <div className="absolute inset-0 overflow-hidden">
                <img src={spreadSrc} alt="" draggable={false}
                  style={{ position: 'absolute', top: 0, height: '100%', width: '200%', maxWidth: 'none', objectFit: 'cover', ...(spreadHalf === 'right' ? { right: 0 } : { left: 0 }) }} />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-white/70">Choisis la photo des couvertures ↑</div>
            )
          ) : src ? (
            fit === 'contain' ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <img src={src} alt="" draggable={false}
                  style={{ maxWidth: `${photoScale * 100}%`, maxHeight: `${photoScale * 100}%`, objectFit: 'contain' }} />
              </div>
            ) : (
              <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
            )
          ) : null}
          {(spreadHalf || fit === 'cover') && (
            <div className="absolute inset-x-0 bottom-0 h-3/5" style={{ background: `linear-gradient(to top, ${ink}, transparent)` }} />
          )}
          <div className="absolute inset-0 flex flex-col p-[6%]" style={{ justifyContent: justify, alignItems: items }}>
            <div style={{ textAlign: align, maxWidth: '100%', backgroundColor: 'rgba(18,26,26,0.52)', padding: '4% 5%', borderRadius: 4 }}>
              {kicker ? <div style={{ color: accent, fontSize: '2.4cqmin', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{kicker}</div> : null}
              <div style={{ color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: isEnd ? '6cqmin' : '8cqmin', lineHeight: 1.05, marginTop: '3%' }}>{title || 'Mon voyage'}</div>
              {showDates && dates ? <div style={{ color: '#fff', opacity: 0.9, fontSize: '2.6cqmin', marginTop: '3%' }}>{dates}</div> : null}
              {isEnd && (
                <>
                  <div style={{ height: '0.6cqmin', width: '16%', backgroundColor: accent, margin: align === 'center' ? '5% auto' : align === 'right' ? '5% 0 5% auto' : '5% 0' }} />
                  <div style={{ color: '#fff', opacity: 0.92, fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: '3cqmin', lineHeight: 1.3 }}>
                    {(note || '').trim() || '« Les voyages finissent, les souvenirs restent. »'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {!spreadHalf && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onChoose}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">🖼️ {photo ? 'Changer' : 'Choisir'}</button>
            {photo && onClear && (
              <button type="button" onClick={onClear} className="text-xs font-medium text-slate-400 hover:text-red-600">Enlever</button>
            )}
          </div>
        )}
      </div>

      {/* Réglages de mise en page */}
      <div className="flex-1 space-y-2.5">
        <p className="text-sm font-medium text-slate-700">{isEnd ? 'Mise en page de la page de fin' : 'Mise en page de la couverture'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs text-slate-500">Position</span>
          {seg(pos, 'pos', 'top', 'Haut')}
          {seg(pos, 'pos', 'center', 'Centre')}
          {seg(pos, 'pos', 'bottom', 'Bas')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs text-slate-500">Alignement</span>
          {seg(align, 'align', 'left', 'Gauche')}
          {seg(align, 'align', 'center', 'Centré')}
          {seg(align, 'align', 'right', 'Droite')}
        </div>
        {!spreadHalf && photo && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-slate-500">Photo</span>
              {seg(fit, 'fit', 'cover', 'Remplir la page')}
              {seg(fit, 'fit', 'contain', 'Entière (sans découpe)')}
            </div>
            {fit === 'contain' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-slate-500">Taille</span>
                  <input type="range" min="0.3" max="1" step="0.01" value={photoScale}
                    onChange={(e) => set({ photoScale: parseFloat(e.target.value) })} className="min-w-0 flex-1" />
                  <span className="w-11 shrink-0 text-right text-xs font-semibold text-slate-600">{Math.round(photoScale * 100)} %</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-20 text-xs text-slate-500">Fond</span>
                  {BG_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => set({ photoBg: c })}
                      className={`h-6 w-6 rounded-full border ${photoBg === c ? 'ring-2 ring-coral-500 ring-offset-1' : 'border-slate-200'}`}
                      style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <label className="block text-xs text-slate-500">Texte d'intro
          <input value={kicker} onChange={(e) => set({ kicker: e.target.value })}
            placeholder={isEnd ? 'Fin du voyage' : 'Album de voyage'}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700" />
        </label>
        {isEnd && onChangeNote && (
          <label className="block text-xs text-slate-500">Mot de fin
            <textarea value={note || ''} onChange={(e) => onChangeNote(e.target.value)} rows={2}
              placeholder="Par défaut : une citation"
              className="mt-1 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700" />
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showDates} onChange={(e) => set({ showDates: e.target.checked })} />
          Afficher les dates
        </label>
        <p className="text-[11px] text-slate-400">Le titre affiché est le titre de l'album (modifiable en haut).</p>
      </div>
    </div>
  );
}

// Section « Couvertures » : 1re et 4e de couverture côte à côte, option photo
// unique étendue sur les deux, et réglage de la page d'ouverture (après la 2e
// de couverture, utilisée s'il n'y a pas de carte).
export function CoversSection({ album, format, theme, dates, hasMap, onPatch, onPick }) {
  const spread = album.coverSpread || {};
  const spreadOn = !!spread.enabled;
  const opening = album.opening || { type: 'blank' };
  const setSpread = (patch) => onPatch({ coverSpread: { ...spread, ...patch } });
  const setOpening = (patch) => onPatch({ opening: { ...opening, ...patch } });
  const segOpen = (val, label) => (
    <button type="button" onClick={() => setOpening({ type: val })}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${(opening.type || 'blank') === val ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-semibold text-slate-900">Couvertures</h2>
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={spreadOn} onChange={(e) => setSpread({ enabled: e.target.checked })} />
        Une seule photo étendue sur les deux couvertures (moitié gauche → 4e, moitié droite → 1re)
      </label>

      {spreadOn && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onPick('spread')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            🖼️ {spread.photo ? 'Changer la photo des couvertures' : 'Choisir la photo des couvertures'}
          </button>
          {spread.photo && (
            <button type="button" onClick={() => setSpread({ photo: null })} className="text-xs font-medium text-slate-400 hover:text-red-600">Enlever</button>
          )}
        </div>
      )}

      <div className={`mt-2 grid grid-cols-1 sm:grid-cols-2 ${spreadOn ? 'gap-x-0 gap-y-5' : 'gap-5'}`}>
        {(() => {
          const front = (
            <div key="front">
              <p className="text-xs font-semibold uppercase tracking-wide text-coral-600">1re de couverture (avant)</p>
              <CoverDesigner
                variant="cover" compact seamless={spreadOn}
                photo={album.cover} title={album.title} dates={dates}
                format={format} theme={theme}
                layout={album.coverLayout || {}}
                onChangeLayout={(l) => onPatch({ coverLayout: l })}
                onChoose={() => onPick('cover')}
                onClear={album.cover ? () => onPatch({ cover: null }) : null}
                spreadHalf={spreadOn ? 'right' : null}
                spreadPhoto={spread.photo}
              />
            </div>
          );
          const back = (
            <div key="back">
              <p className="text-xs font-semibold uppercase tracking-wide text-coral-600">4e de couverture (page de fin)</p>
              <CoverDesigner
                variant="end" compact seamless={spreadOn}
                photo={album.endPhoto} title={album.title} dates={dates}
                note={album.endNote} onChangeNote={(t) => onPatch({ endNote: t })}
                format={format} theme={theme}
                layout={album.endLayout || {}}
                onChangeLayout={(l) => onPatch({ endLayout: l })}
                onChoose={() => onPick('end')}
                onClear={album.endPhoto ? () => onPatch({ endPhoto: null }) : null}
                spreadHalf={spreadOn ? 'left' : null}
                spreadPhoto={spread.photo}
              />
            </div>
          );
          // Photo étendue : 4e à gauche + 1re à droite → la photo se lit en
          // continu. Deux photos différentes : 1re à gauche, 4e à droite.
          return spreadOn ? [back, front] : [front, back];
        })()}
      </div>

      {/* Page d'ouverture (après la 2e de couverture blanche) */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-sm font-medium text-slate-700">Page d'ouverture</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Juste après la couverture (la 2e de couverture est une page blanche imposée).
          {hasMap ? ' Ici, c’est la carte du voyage qui s’affiche.' : ' Sans carte, choisis ce qui s’affiche :'}
        </p>
        {!hasMap && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {segOpen('blank', 'Page blanche')}
            {segOpen('photo', 'Photo choisie')}
            {segOpen('random', 'Photo au hasard')}
            {(opening.type || 'blank') === 'photo' && (
              <button type="button" onClick={() => onPick('opening')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                🖼️ {opening.photo ? 'Changer la photo' : 'Choisir la photo'}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Choix du format de l'album (toute la création s'y adapte).
export function FormatPicker({ value, onChange }) {
  const opts = [
    ['carre', 'Carré 21 × 21 cm', 'Le format classique des livres photo.'],
    ['a4paysage', 'A4 paysage 29,7 × 21 cm', 'Allongé, comme une feuille couchée.'],
    ['a4portrait', 'A4 portrait 21 × 29,7 cm', 'Vertical, comme une feuille debout.'],
  ];
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">Format de l'album</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {opts.map(([k, label, desc]) => (
          <button key={k} type="button" onClick={() => onChange(k)}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${value === k ? 'border-coral-400 bg-coral-50 text-coral-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
            <span className="block font-semibold">{label}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Sélecteur de thème (ambiance appliquée à tout l'album).
export function ThemePicker({ value, onChange }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-slate-700">Thème de l'album</p>
      <div className="flex flex-wrap gap-2">
        {ALBUM_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
              value === t.id ? 'border-coral-400 ring-2 ring-coral-200' : 'border-slate-200 hover:border-slate-300'
            }`}
            title={t.label}
          >
            <span className="flex h-5 w-8 items-center justify-end overflow-hidden rounded border border-slate-200" style={{ backgroundColor: t.paper }}>
              <span className="mr-0.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.accent }} />
            </span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Réglage d'un fond (aucun / couleur / photo + atténuée ou pleines couleurs).
export function BgSpecEditor({ spec, onChange, onPickPhoto }) {
  const type = spec?.type || 'none';
  const toned = spec?.toned !== false;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {[
          ['none', 'Aucun (beige)'],
          ['color', 'Couleur'],
          ['photo', 'Photo'],
        ].map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              onChange(
                t === 'none'
                  ? { type: 'none' }
                  : t === 'color'
                    ? { type: 'color', color: spec?.color || BG_COLORS[1] }
                    : { type: 'photo', photo: spec?.photo || null, toned }
              )
            }
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              type === t ? 'bg-coral-500 text-white' : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {type === 'color' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ type: 'color', color: c })}
              style={{ backgroundColor: c }}
              className={`h-7 w-7 rounded-full border ${
                spec?.color === c ? 'ring-2 ring-coral-400 ring-offset-1' : 'border-slate-300'
              }`}
              title={c}
            />
          ))}
        </div>
      )}

      {type === 'photo' && (
        <div className="mt-2 flex items-center gap-3">
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {spec?.photo ? (
              <img src={spec.photo.display || spec.photo.full} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                Aucune
              </span>
            )}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={onPickPhoto}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {spec?.photo ? 'Changer la photo' : 'Choisir la photo'}
            </button>
            <div className="mt-1.5 flex gap-1">
              <button
                type="button"
                onClick={() => onChange({ ...spec, type: 'photo', toned: true })}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  toned ? 'bg-coral-500 text-white' : 'border border-slate-300 bg-white text-slate-600'
                }`}
              >
                Atténuée (beige)
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...spec, type: 'photo', toned: false })}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  !toned ? 'bg-coral-500 text-white' : 'border border-slate-300 bg-white text-slate-600'
                }`}
              >
                Pleines couleurs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Album de voyage — mode « pendant le voyage » (carnet de bord).
// Route : /itineraire/:id/album
//
// L'utilisateur remplit son album jour après jour : pour chaque journée du
// voyage, il peut écrire un titre, un petit texte (journal) et ajouter des
// photos avec une légende sous chacune. Tout est enregistré dans le voyage
// (clé travel_album), donc il peut s'arrêter et reprendre quand il veut.
//
// Chaque photo est stockée en deux qualités : une légère pour l'affichage
// ici, une haute définition conservée pour l'impression (300 DPI). On prévient
// l'utilisateur si une photo est trop petite pour bien rendre à l'impression.

// Largeur (en pixels) en-dessous de laquelle une photo risque d'être floue
// imprimée en grand : 21 cm à 300 DPI ≈ 2480 px. On reste tolérant (la
// plupart des photos servent en demi/quart de page) et on alerte sous 1500 px.
const MIN_PRINT_PX = 1500;

function isLowRes(photo) {
  const longEdge = Math.max(photo?.w || 0, photo?.h || 0);
  return longEdge > 0 && longEdge < MIN_PRINT_PX;
}

// Styles d'un effet (HTML) découpés en trois rôles :
//   frameWrap : décor du cadre (fond/bordure) AUTOUR de la zone photo ;
//   clip      : découpe appliquée à la zone photo (forme, coins arrondis…) ;
//   filter    : filtre couleur appliqué à l'image.
// La marge intérieure du cadre vient de frameInsetFrac (partagée avec le PDF).
function effectStyles(effect, radiusPx = 10) {
  const ins = frameInsetFrac(effect.frame);
  const pad = `${ins.t * 100}% ${ins.r * 100}% ${ins.b * 100}% ${ins.l * 100}%`;
  const frameWrap = {};
  const clip = {};
  const filter = effect.css || '';
  switch (effect.frame) {
    case 'border': Object.assign(frameWrap, { padding: pad, background: '#fff' }); break;
    case 'postcard': Object.assign(frameWrap, { padding: pad, background: '#fff', border: '1px solid #e2ddd0' }); break;
    case 'polaroid': Object.assign(frameWrap, { padding: pad, background: '#fff' }); break;
    case 'rounded': clip.borderRadius = radiusPx; break;
    case 'thin': clip.border = `2px solid ${effect.frameColor || '#111'}`; break;
    case 'wood': Object.assign(frameWrap, { padding: pad, background: 'linear-gradient(135deg,#a06a33,#6e4423)' }); break;
    case 'gold': Object.assign(frameWrap, { padding: pad, background: 'linear-gradient(135deg,#e7c66a,#b8901f)' }); break;
    case 'stamp': Object.assign(frameWrap, { padding: pad, background: '#fff', border: '2px dashed #b9b2a3' }); break;
    case 'film': Object.assign(frameWrap, { padding: pad, background: '#141414' }); break;
    case 'parchment': Object.assign(frameWrap, { padding: pad, background: '#efe2c4', border: '1px solid #cdbd97' }); break;
    case 'shape': {
      const sh = getFrameShape(effect.shape);
      if (sh) clip.clipPath = shapeClipCss(sh.pts);
      break;
    }
    default: break;
  }
  return { frameWrap, clip, filter };
}

// Remplit une case (son conteneur parent, de ratio containerAr) avec une photo :
// cadre + filtre + CADRAGE (point de mire fx,fy + zoom fz) → on voit exactement
// la zone choisie. Géométrie identique au PDF (coverFrac/frameInsetFrac).
function PhotoFill({ photo, containerAr = 4 / 3, radiusPx = 10 }) {
  const effect = getPhotoEffect(photo.effect);
  const { frameWrap, clip, filter } = effectStyles(effect, radiusPx);
  const ins = frameInsetFrac(effect.frame);
  const innerAr = containerAr * (1 - ins.l - ins.r) / (1 - ins.t - ins.b);
  const iAr = photo.w && photo.h ? photo.w / photo.h : innerAr;
  const { fx, fy, fz } = photoFocal(photo);
  const f = coverFrac(innerAr, iAr, fx, fy, fz);
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden" style={frameWrap}>
      <div className="relative h-full w-full overflow-hidden" style={clip}>
        <img
          src={photo.display || photo.full}
          alt=""
          draggable={false}
          style={{ position: 'absolute', left: `${f.left * 100}%`, top: `${f.top * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, maxWidth: 'none', filter: filter || undefined }}
        />
      </div>
    </div>
  );
}

// Fenêtre de choix d'effet : choix du filtre/cadre/forme + CADRAGE de la photo
// (glisser pour déplacer la zone visible, curseur pour zoomer). onChange reçoit
// un correctif partiel : { effect } ou { fx, fy, fz }.
export function EffectPicker({ photo, current, onChange, onClose }) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  const f0 = photoFocal(photo);
  const [fx, setFx] = useState(f0.fx);
  const [fy, setFy] = useState(f0.fy);
  const [fz, setFz] = useState(f0.fz);
  const boxRef = useRef(null);
  const drag = useRef(null);

  const effect = getPhotoEffect(current);
  const ins = frameInsetFrac(effect.frame);
  const PREVIEW_AR = 4 / 3;
  const innerAr = (PREVIEW_AR * (1 - ins.l - ins.r)) / (1 - ins.t - ins.b);
  const iAr = photo.w && photo.h ? photo.w / photo.h : innerAr;

  const apply = (patch) => {
    if ('fx' in patch) setFx(patch.fx);
    if ('fy' in patch) setFy(patch.fy);
    if ('fz' in patch) setFz(patch.fz);
    onChange(patch);
  };
  const recenter = () => apply({ fx: 0.5, fy: 0.5, fz: 1 });

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx, fy };
  };
  const onPointerMove = (e) => {
    if (!drag.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const cv = coverFrac(innerAr, iAr, drag.current.fx, drag.current.fy, fz);
    const ow = cv.w - 1;
    const oh = cv.h - 1;
    let nfx = drag.current.fx;
    let nfy = drag.current.fy;
    if (ow > 0.0001) nfx = Math.min(1, Math.max(0, drag.current.fx - (e.clientX - drag.current.x) / r.width / ow));
    if (oh > 0.0001) nfy = Math.min(1, Math.max(0, drag.current.fy - (e.clientY - drag.current.y) / r.height / oh));
    apply({ fx: nfx, fy: nfy });
  };
  const onPointerUp = () => { drag.current = null; };

  const previewPhoto = { ...photo, fx, fy, fz };
  const groups = [
    ['Filtres de couleur', PHOTO_EFFECTS.filter((e) => e.cat === 'filtre')],
    ['Cadres', PHOTO_EFFECTS.filter((e) => e.cat === 'cadre')],
    ['Formes (découpe)', PHOTO_EFFECTS.filter((e) => e.cat === 'forme')],
  ];
  const Tile = ({ e }) => (
    <button
      type="button"
      onClick={() => onChange({ effect: e.id })}
      className={`overflow-hidden rounded-xl border-2 ${current === e.id ? 'border-coral-500' : 'border-transparent'}`}
    >
      <div className="aspect-[4/3] w-full bg-slate-100" style={{ containerType: 'size' }}>
        <PhotoFill photo={{ ...photo, effect: e.id, fx, fy, fz }} containerAr={4 / 3} radiusPx={8} />
      </div>
      <div className="truncate px-1 py-1 text-center text-[11px] font-medium text-slate-700">{e.label}</div>
    </button>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Effet de la photo</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          {/* Cadrage : glisser pour déplacer, curseur pour zoomer */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Cadrage</p>
            <div className="mx-auto" style={{ maxWidth: '20rem' }}>
              <div
                ref={boxRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(e) => e.preventDefault()}
                className="relative w-full cursor-move touch-none select-none overflow-hidden rounded-xl bg-slate-100"
                style={{ aspectRatio: '4 / 3', containerType: 'size', WebkitTouchCallout: 'none' }}
              >
                <PhotoFill photo={previewPhoto} containerAr={4 / 3} radiusPx={10} />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-slate-500">Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={fz}
                  onChange={(ev) => apply({ fz: Number(ev.target.value) })}
                  className="h-1 flex-1 cursor-pointer accent-coral-500"
                />
                <button type="button" onClick={recenter} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Recentrer</button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Glisse la photo pour choisir la partie visible.</p>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => onChange({ effect: 'none' })}
              className={`mb-1 w-full rounded-lg border px-3 py-2 text-sm font-medium ${current === 'none' ? 'border-coral-400 bg-coral-50 text-coral-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              Aucun effet (photo d'origine)
            </button>
          </div>
          {groups.map(([label, list]) => (
            <div key={label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {list.map((e) => <Tile key={e.id} e={e} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-100 px-4 py-3">
          <button onClick={onClose} className="rounded-lg bg-coral-500 px-5 py-2 text-sm font-semibold text-white">Terminé</button>
        </div>
      </div>
    </div>
  );
}

// Éditeur de décorations réutilisable : un canevas (avec un fond fourni) sur
// lequel on pose des emojis/stickers/textes, déplaçables (glisser),
// redimensionnables et pivotables. Coordonnées en fractions du canevas.
// Affiche un élément de décoration (emoji, texte ou image). `sizeUnit` est
// l'unité de taille (cqmin dans un conteneur dimensionné).
function BubbleView({ it }) {
  const g = computeBubble(it.tailAngle ?? 215, it.tailLen ?? 0.35);
  const side = it.scale * g.vb.w; // en cqmin
  return (
    <div style={{ position: 'relative', width: `${side}cqmin`, height: `${side}cqmin` }}>
      <svg viewBox={`${g.vb.x} ${g.vb.y} ${g.vb.w} ${g.vb.h}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <ellipse cx="0" cy="0" rx="50" ry="30" fill="#ffffff" stroke="#1f2937" strokeWidth="2.4" />
        <polygon points={`${g.b1.x},${g.b1.y} ${g.tip.x},${g.tip.y} ${g.b2.x},${g.b2.y}`} fill="#ffffff" />
        <polyline points={`${g.b1.x},${g.b1.y} ${g.tip.x},${g.tip.y} ${g.b2.x},${g.b2.y}`} fill="none" stroke="#1f2937" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: `${it.scale * 78}cqmin`, textAlign: 'center', color: it.color || '#111111', fontWeight: 700, fontFamily: fontCss(it.font || 'comic'), fontSize: `${it.scale * 9 * (it.fontScale ?? 1)}cqmin`, lineHeight: 1.05, overflow: 'hidden', maxHeight: `${it.scale * 52}cqmin` }}>
        {it.value}
      </div>
    </div>
  );
}

function DecoItemView({ it }) {
  if (it.type === 'image') {
    return <img src={it.value} alt="" draggable={false} style={{ width: `${it.scale * 100}cqmin`, height: 'auto', display: 'block' }} />;
  }
  if (it.type === 'bubble') {
    return <BubbleView it={it} />;
  }
  return (
    <span style={{ fontSize: `${it.scale * 100}cqmin`, lineHeight: 1, color: it.color, fontWeight: it.type === 'text' ? 700 : 400, fontFamily: it.type === 'text' ? fontCss(it.font) : undefined, whiteSpace: 'nowrap', textShadow: it.type === 'text' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}>
      {it.value}
    </span>
  );
}

// Rendu d'un objet du canevas : une PHOTO (avec son effet, son cadre, sa
// légende et ses décos) ou une décoration (emoji/texte/image).
function ObjView({ it }) {
  if (it.kind === 'photo') {
    const p = it.photo;
    const pdeco = p.deco || [];
    // hs = hauteur du cadre (1 = ratio de la photo ; sinon recadrage).
    const boxAr = (it.ar || 4 / 3) / (it.hs || 1);
    return (
      <div className="relative overflow-hidden" style={{ width: `${it.scale * 100}cqmin`, aspectRatio: String(boxAr), containerType: 'size' }}>
        <PhotoFill photo={p} containerAr={boxAr} />
        {pdeco.map((d, k) => (
          <div key={k} className="absolute" style={{ left: `${d.xf * 100}%`, top: `${d.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${d.rot}deg)` }}>
            <DecoItemView it={d} />
          </div>
        ))}
        {p.caption ? (
          <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-center italic text-white" style={{ backgroundColor: 'rgba(0,0,0,0.45)', fontSize: '3cqmin' }}>{p.caption}</div>
        ) : null}
      </div>
    );
  }
  return <DecoItemView it={it} />;
}

// Panneau « ajouter une décoration » : texte, bulle, image importée, emojis par
// catégorie, et cliparts Pixabay. Autonome (gère sa propre recherche/import).
// onAddItem(item) reçoit l'objet prêt (positionné au centre par défaut).
function DecoAddPanel({ onAddItem }) {
  const [cat, setCat] = useState(STICKER_CATEGORIES[0].key);
  const [uploading, setUploading] = useState(false);
  const [pixQ, setPixQ] = useState('');
  const [pixHits, setPixHits] = useState([]);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixErr, setPixErr] = useState(null);
  const fileRef = useRef(null);
  const activeCat = STICKER_CATEGORIES.find((c) => c.key === cat) || STICKER_CATEGORIES[0];

  const addEmoji = (e) => onAddItem({ type: 'emoji', value: e, xf: 0.5, yf: 0.5, scale: 0.16, rot: 0 });
  const addText = () => onAddItem({ type: 'text', value: 'Texte', xf: 0.5, yf: 0.5, scale: 0.1, rot: 0, color: '#ffffff', font: 'display' });
  const addBubble = () => onAddItem({ type: 'bubble', value: 'Bla bla !', xf: 0.5, yf: 0.5, scale: 0.32, rot: 0, color: '#111111', tailAngle: 215, tailLen: 0.35, font: 'comic', fontScale: 1 });
  async function addImageFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { url, w, h } = await uploadAlbumSticker(file);
      onAddItem({ type: 'image', value: url, ar: w && h ? w / h : 1, xf: 0.5, yf: 0.5, scale: 0.25, rot: 0 });
    } catch {
      alert("L'import de l'image a échoué. Réessaie avec un fichier PNG ou JPG.");
    } finally {
      setUploading(false);
    }
  }
  async function runPixSearch() {
    const q = pixQ.trim();
    if (!q) return;
    setPixLoading(true);
    setPixErr(null);
    try {
      setPixHits(await pixabaySearch(q));
    } catch (e) {
      setPixErr(e.message || 'Recherche impossible.');
      setPixHits([]);
    } finally {
      setPixLoading(false);
    }
  }
  async function addPixabay(hit) {
    setUploading(true);
    try {
      const dataUrl = await pixabayFetch(hit.full);
      if (!dataUrl) throw new Error('Image indisponible.');
      const blob = await (await fetch(dataUrl)).blob();
      const { url, w, h } = await uploadAlbumSticker(blob);
      onAddItem({ type: 'image', value: url, ar: w && h ? w / h : (hit.w && hit.h ? hit.w / hit.h : 1), xf: 0.5, yf: 0.5, scale: 0.3, rot: 0 });
    } catch (e) {
      alert(e.message || "L'ajout de l'illustration a échoué.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button onClick={addText} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">➕ Texte</button>
        <button onClick={addBubble} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">💬 Bulle BD</button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60">
          {uploading && <Spinner className="h-3.5 w-3.5" />}
          {uploading ? 'Import…' : '🖼️ Importer une image (PNG)'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { addImageFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className="mb-1 flex flex-wrap gap-1">
        {STICKER_CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)} title={c.name}
            className={`rounded-md px-2 py-1 text-base leading-none ${cat === c.key ? 'bg-coral-500' : 'bg-slate-100 hover:bg-slate-200'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-2xl sm:grid-cols-10 sm:text-xl">
        {activeCat.emojis.map((e, idx) => (
          <button key={e + idx} onClick={() => addEmoji(e)} className="rounded py-1 hover:bg-slate-100 active:bg-slate-200">{e}</button>
        ))}
      </div>
      <div className="mt-3">
        <form onSubmit={(e) => { e.preventDefault(); runPixSearch(); }} className="flex gap-2">
          <input value={pixQ} onChange={(e) => setPixQ(e.target.value)}
            placeholder="Chercher un clipart / une illustration (Pixabay)…"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="submit" disabled={pixLoading} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {pixLoading ? '…' : 'Chercher'}
          </button>
        </form>
        {pixErr && <p className="mt-1 text-xs text-red-600">{pixErr}</p>}
        {pixHits.length > 0 && (
          <div className="mt-2 grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-5">
            {pixHits.map((hh) => (
              <button key={hh.id} type="button" onClick={() => addPixabay(hh)} disabled={uploading}
                className="aspect-square overflow-hidden rounded bg-white ring-1 ring-slate-200 hover:ring-coral-400 disabled:opacity-50"
                title="Ajouter cette illustration">
                <img src={hh.preview} alt={hh.tags || ''} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-slate-400">Illustrations fournies par Pixabay.</p>
      </div>
    </div>
  );
}

// Réglages d'un élément sélectionné (texte/couleur/police, bulle, taille,
// rotation). Réutilisé par l'éditeur plein écran ET par l'édition directe dans
// l'aperçu. onChange(patch) fusionne ; les boutons « ↺ initiale » sont
// optionnels (onResetScale/onResetRot).
function DecoItemControls({ item, onChange, onRemove, onResetScale, onResetRot, allowRemove = true }) {
  const isText = item.type === 'text' || item.type === 'bubble';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{item.kind === 'photo' ? 'Photo sélectionnée' : 'Élément sélectionné'}</span>
        {allowRemove && onRemove && (
          <button onClick={onRemove} className="text-xs font-medium text-red-600">Supprimer</button>
        )}
      </div>
      {isText && (
        <div className="mt-2 flex items-center gap-2">
          {item.type === 'bubble' ? (
            <textarea value={item.value} onChange={(e) => onChange({ value: e.target.value })} rows={2}
              placeholder="Texte de la bulle" className="min-w-0 flex-1 resize-y rounded border border-slate-300 px-2 py-1 text-sm" />
          ) : (
            <input value={item.value} onChange={(e) => onChange({ value: e.target.value })}
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          )}
          <input type="color" value={item.color || (item.type === 'bubble' ? '#111111' : '#ffffff')} onChange={(e) => onChange({ color: e.target.value })}
            className="h-8 w-10 rounded border border-slate-300" />
        </div>
      )}
      {isText && (
        <div className="mt-2">
          <span className="text-xs text-slate-600">Police</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {FONT_CHOICES.map((f) => (
              <button key={f.key} type="button" onClick={() => onChange({ font: f.key })} style={{ fontFamily: f.css }}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${(item.font || (item.type === 'bubble' ? 'comic' : 'display')) === f.key ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {item.type === 'bubble' && (
        <>
          <label className="mt-2 block text-xs text-slate-600">Taille du texte
            <input type="range" min="0.5" max="2" step="0.05" value={item.fontScale ?? 1}
              onChange={(e) => onChange({ fontScale: parseFloat(e.target.value) })} className="w-full" />
          </label>
          <label className="mt-2 block text-xs text-slate-600">Direction de la queue ({item.tailAngle ?? 215}°)
            <input type="range" min="0" max="359" step="1" value={item.tailAngle ?? 215}
              onChange={(e) => onChange({ tailAngle: parseInt(e.target.value, 10) })} className="w-full" />
          </label>
          <label className="block text-xs text-slate-600">Longueur de la queue
            <input type="range" min="0.1" max="0.8" step="0.01" value={item.tailLen ?? 0.35}
              onChange={(e) => onChange({ tailLen: parseFloat(e.target.value) })} className="w-full" />
          </label>
        </>
      )}
      <div className="mt-2 text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>Taille</span>
          {onResetScale && <button type="button" onClick={onResetScale} className="text-coral-600 hover:text-coral-700" title="Revenir à la taille initiale">↺ initiale</button>}
        </div>
        {/* Curseur + boutons −/+ : les boutons donnent un réglage fin, plus
            facile au doigt sur téléphone que le curseur. */}
        {(() => {
          const maxS = item.kind === 'photo' ? 1.3 : 0.6;
          const step = item.kind === 'photo' ? 0.02 : 0.01;
          const setScale = (v) => onChange({ scale: Math.min(maxS, Math.max(0.05, v)) });
          return (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setScale((item.scale || 0.05) - step)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 active:bg-slate-100"
                title="Réduire un peu">−</button>
              <input type="range" min="0.05" max={String(maxS)} step="0.01" value={item.scale}
                onChange={(e) => onChange({ scale: parseFloat(e.target.value) })} className="w-full flex-1" />
              <button type="button" onClick={() => setScale((item.scale || 0.05) + step)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 active:bg-slate-100"
                title="Agrandir un peu">+</button>
            </div>
          );
        })()}
      </div>
      <div className="text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>Rotation {item.rot ? `(${item.rot}°)` : '(0°)'}</span>
          {onResetRot && <button type="button" onClick={onResetRot} className="text-coral-600 hover:text-coral-700" title="Remettre droit">↺ initiale</button>}
        </div>
        {/* Curseur (rapide, aimanté à 0°) + boutons −/+ degré par degré (précis).
            Les boutons n'aimantent pas : on peut poser exactement 1°, 2°… */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onChange({ rot: Math.max(-180, (item.rot || 0) - 1) })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 active:bg-slate-100"
            title="Tourner de 1° vers la gauche">−</button>
          <input type="range" min="-180" max="180" step="1" value={item.rot}
            onChange={(e) => { const v = parseInt(e.target.value, 10); onChange({ rot: Math.abs(v) <= 3 ? 0 : v }); }} className="w-full flex-1" />
          <button type="button" onClick={() => onChange({ rot: Math.min(180, (item.rot || 0) + 1) })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 active:bg-slate-100"
            title="Tourner de 1° vers la droite">+</button>
        </div>
      </div>
    </div>
  );
}

export function DecoEditor({ title, aspect, background, initialItems, onChange, onClose, toolbar = null }) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  const [items, setItems] = useState(() => (initialItems || []).map((d) => ({ ...d })));
  const [sel, setSel] = useState(null);
  const canvasRef = useRef(null);
  const drag = useRef(null);
  // Valeurs INITIALES (taille/rotation) de chaque élément, pour le bouton
  // « retour à l'initiale ».
  const initials = useRef((initialItems || []).map((d) => ({ scale: d.scale, rot: d.rot || 0 })));

  const commit = (next) => { setItems(next); onChange(next); };
  const update = (i, patch) => commit(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = (it) => { const next = [...items, it]; initials.current = [...initials.current, { scale: it.scale, rot: it.rot || 0 }]; commit(next); setSel(next.length - 1); };
  const remove = (i) => { initials.current = initials.current.filter((_, k) => k !== i); commit(items.filter((_, k) => k !== i)); setSel(null); };
  const resetScale = (i) => update(i, { scale: initials.current[i]?.scale ?? items[i].scale });
  const resetRot = (i) => update(i, { rot: initials.current[i]?.rot ?? 0 });

  // Glisser au doigt OU à la souris : on utilise les évènements « pointer »
  // (souris + tactile) et on capture le pointeur sur le canevas pour suivre le
  // déplacement même si le doigt sort de l'élément.
  function pointerDown(e, i) {
    e.stopPropagation();
    e.preventDefault();
    setSel(i);
    drag.current = { i, rect: canvasRef.current.getBoundingClientRect() };
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function pointerMove(e) {
    if (!drag.current) return;
    const { i, rect } = drag.current;
    update(i, {
      xf: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      yf: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
  }
  const endDrag = () => { drag.current = null; };
  const selItem = sel != null ? items[sel] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-3">
      <div className="flex max-h-[100dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        {/* en-tête fixe */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {/* corps défilable */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          {toolbar}

          <div
            ref={canvasRef}
            className="relative mx-auto select-none touch-none overflow-hidden rounded-lg border border-slate-200 bg-slate-200"
            style={{ aspectRatio: String(aspect), width: `min(100%, calc(44vh * ${aspect}))`, maxWidth: '100%', containerType: 'size', WebkitTouchCallout: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={() => setSel(null)}
            onPointerMove={pointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="pointer-events-none absolute inset-0">{background}</div>
            {items.map((it, i) => (
              <div
                key={i}
                onPointerDown={(e) => pointerDown(e, i)}
                className={`absolute cursor-move touch-none ${sel === i ? 'outline outline-2 outline-coral-400 outline-offset-1' : ''}`}
                style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}
              >
                <ObjView it={it} />
              </div>
            ))}
          </div>

          {selItem ? (
            <div className="mt-3">
              <DecoItemControls
                item={selItem}
                onChange={(patch) => update(sel, patch)}
                onRemove={() => remove(sel)}
                onResetScale={() => resetScale(sel)}
                onResetRot={() => resetRot(sel)}
                allowRemove={selItem.kind !== 'photo'}
              />
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-slate-500">Touche un élément (photo, emoji, texte…) pour le déplacer, le redimensionner ou le pivoter.</p>
          )}

          <div className="mt-3">
            <DecoAddPanel onAddItem={addItem} />
          </div>
        </div>

        {/* pied fixe */}
        <div className="flex shrink-0 justify-end border-t border-slate-100 px-4 py-3">
          <button onClick={onClose} className="rounded-lg bg-coral-500 px-5 py-2 text-sm font-semibold text-white">Terminé</button>
        </div>
      </div>
    </div>
  );
}

// Décorer UNE photo (le fond du canevas est la photo).
export function DecorateModal({ photo, onChange, onClose }) {
  const ar = photo.w && photo.h ? photo.w / photo.h : 4 / 3;
  return (
    <DecoEditor
      title="Décorer la photo"
      aspect={ar}
      initialItems={photo.deco || []}
      onChange={onChange}
      onClose={onClose}
      background={<PhotoFill photo={photo} containerAr={ar} />}
    />
  );
}

// Fond CSS reproduisant le motif décoratif d'un thème (approximation visuelle).
function themePatternStyle(theme) {
  if (!theme || !theme.pattern || theme.pattern === 'none') return {};
  const c = theme.patternColor || '#E7DDCB';
  if (theme.pattern === 'dots' || theme.pattern === 'confetti') {
    return { backgroundImage: `radial-gradient(${c} 1.6px, transparent 1.7px)`, backgroundSize: '16px 16px' };
  }
  if (theme.pattern === 'grid') {
    return { backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, backgroundSize: '15px 15px' };
  }
  if (theme.pattern === 'diagonal') {
    return { backgroundImage: `repeating-linear-gradient(20deg, ${c} 0 1px, transparent 1px 13px)` };
  }
  return {};
}

// Aperçu STATIQUE d'une page (même mise en page que l'éditeur/PDF) : fond,
// en-tête, photos (grille ou disposition libre), légendes, décorations.
export function PagePreview({ photos, format, theme, title, note, firstPage, dayIndex, location, unit = 'jour', bg, pageIndex, pageCount, deco, free, width = '11rem', interactive = false, onFreeChange, onDecoChange, onSelect, selected = null }) {
  const spec = resolveBg(bg, pageIndex, pageCount);
  const onPlate = spec.type !== 'none';
  const lay = pageLayout(photos, format, { title, note, firstPage, onPlate });
  const pct = (v, total) => `${(v / total) * 100}%`;
  const ink = theme?.ink || '#1C2B2D';
  const accent = theme?.accent || '#C8643C';
  const minPage = Math.min(lay.pageW, lay.pageH);
  const freeValid = Array.isArray(free) && free.length === photos.length && photos.length > 0;
  let baseStyle = { backgroundColor: theme?.paper || '#FBF8F3', ...themePatternStyle(theme) };
  if (spec.type === 'color') baseStyle = { backgroundColor: spec.color };

  // --- Sélection + déplacement direct (glisser) dans l'aperçu ---
  // Toucher une photo/décoration la sélectionne (outils affichés dessous) ; la
  // glisser la déplace. Glisser une photo en grille bascule la page en
  // « disposition libre » (en repartant des positions de la grille).
  const rootRef = useRef(null);
  const drag = useRef(null);
  const boxesRef = useRef(null);
  const decosRef = useRef(null);
  const holdTimer = useRef(null);
  // Au doigt, on n'active le glissement qu'après un appui maintenu : pendant ce
  // temps le défilement de la page reste possible (touch-action pan-y). Une fois
  // le glissement actif, on bloque le défilement (touch-action none) pour que le
  // doigt déplace vraiment la photo sans faire défiler la page.
  const [touchDragging, setTouchDragging] = useState(false);
  const HOLD_MS = 240;   // durée d'appui avant de pouvoir déplacer
  const HOLD_TOL = 10;   // si le doigt bouge plus que ça avant l'appui, c'est un défilement
  // IMPORTANT : changer touch-action en cours de geste ne suffit pas — le
  // navigateur l'a figé au moment où le doigt s'est posé. Si on le laisse
  // faire, il « vole » le geste pour défiler la page et coupe le glissement
  // (pointercancel) : la photo bougeait un peu puis se figeait. On bloque donc
  // nous-mêmes le défilement (preventDefault sur touchmove, listener non
  // passif) tant qu'un glissement est actif.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !interactive) return undefined;
    const onTouchMove = (e) => {
      const d = drag.current;
      if (d && d.active) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [interactive]);
  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const seedBoxes = () => seedFreeBoxes(photos, lay);
  // Amorce un glissement : immédiat à la souris/stylet, après appui maintenu au doigt.
  const beginDrag = (e, base) => {
    // Empêche seulement la désélection par le fond (ne bloque pas le défilement,
    // qui dépend de touch-action / preventDefault, pas de la propagation React).
    e.stopPropagation();
    if (e.pointerType === 'touch') {
      // On mémorise l'intention sans capturer le pointeur : le défilement reste
      // possible tant que l'appui n'est pas maintenu.
      const pid = e.pointerId;
      drag.current = { ...base, x: e.clientX, y: e.clientY, moved: false, active: false, pending: true };
      clearHold();
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        const d = drag.current;
        if (!d || !d.pending) return;
        d.pending = false;
        d.active = true;
        rootRef.current?.setPointerCapture?.(pid);
        setTouchDragging(true);
        // Petite vibration : on SENT que la photo est prise et déplaçable.
        try { navigator.vibrate?.(15); } catch { /* non supporté */ }
      }, HOLD_MS);
    } else {
      rootRef.current?.setPointerCapture?.(e.pointerId);
      drag.current = { ...base, x: e.clientX, y: e.clientY, moved: false, active: true, pending: false };
    }
  };
  const startPhoto = (e, i) => {
    if (!interactive) return;
    onSelect?.('photo', i);
    const boxes = freeValid ? free.map((b) => ({ ...b })) : seedBoxes();
    boxesRef.current = boxes;
    beginDrag(e, { kind: 'photo', i, sx: boxes[i].xf, sy: boxes[i].yf });
  };
  const startDeco = (e, i) => {
    if (!interactive) return;
    onSelect?.('deco', i);
    const items = (deco || []).map((d) => ({ ...d }));
    decosRef.current = items;
    beginDrag(e, { kind: 'deco', i, sx: items[i].xf, sy: items[i].yf });
  };
  // Repères d'alignement : pendant un glissement, si le centre de l'élément
  // arrive au niveau du centre de la page ou du centre d'un autre élément, une
  // ligne rouge apparaît et l'élément s'aimante doucement dessus.
  const [guides, setGuides] = useState(null); // { v: xf | null, h: yf | null }
  const SNAP = 0.018; // distance (en fraction de page) d'aimantation
  const snapTargets = (d) => {
    const xs = [0.5];
    const ys = [0.5];
    if (d.kind === 'photo') {
      (boxesRef.current || []).forEach((b, k) => { if (k !== d.i && b) { xs.push(b.xf); ys.push(b.yf); } });
      (deco || []).forEach((it) => { xs.push(it.xf); ys.push(it.yf); });
    } else {
      (decosRef.current || []).forEach((it, k) => { if (k !== d.i && it) { xs.push(it.xf); ys.push(it.yf); } });
      if (freeValid) free.forEach((b) => { xs.push(b.xf); ys.push(b.yf); });
      else lay.cells.forEach((c) => { xs.push((c.x + c.w / 2) / lay.pageW); ys.push((c.y + c.h / 2) / lay.pageH); });
    }
    return { xs, ys };
  };
  const onCanvasMove = (e) => {
    const d = drag.current;
    if (!d || !rootRef.current) return;
    if (d.pending) {
      // Appui pas encore maintenu : si le doigt bouge, l'utilisateur fait défiler
      // la page → on annule le glissement et on laisse le navigateur défiler.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > HOLD_TOL) { clearHold(); drag.current = null; }
      return;
    }
    if (!d.active) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    const r = rootRef.current.getBoundingClientRect();
    let nxf = Math.min(1, Math.max(0, d.sx + (e.clientX - d.x) / r.width));
    let nyf = Math.min(1, Math.max(0, d.sy + (e.clientY - d.y) / r.height));
    // Aimantation sur le repère le plus proche (axe par axe).
    const { xs, ys } = snapTargets(d);
    let bestX = null;
    for (const t of xs) { const dd = Math.abs(nxf - t); if (dd <= SNAP && (!bestX || dd < bestX.dd)) bestX = { t, dd }; }
    let bestY = null;
    for (const t of ys) { const dd = Math.abs(nyf - t); if (dd <= SNAP && (!bestY || dd < bestY.dd)) bestY = { t, dd }; }
    if (bestX) nxf = bestX.t;
    if (bestY) nyf = bestY.t;
    setGuides(bestX || bestY ? { v: bestX ? bestX.t : null, h: bestY ? bestY.t : null } : null);
    if (d.kind === 'photo') {
      boxesRef.current[d.i] = { ...boxesRef.current[d.i], xf: nxf, yf: nyf };
      onFreeChange?.(boxesRef.current.map((b) => ({ ...b })));
    } else {
      decosRef.current[d.i] = { ...decosRef.current[d.i], xf: nxf, yf: nyf };
      onDecoChange?.(decosRef.current.map((x) => ({ ...x })));
    }
  };
  const onCanvasUp = () => { clearHold(); drag.current = null; setTouchDragging(false); setGuides(null); };
  const interactiveCells = interactive;
  const photoSel = (i) => selected && selected.kind === 'photo' && selected.i === i;
  const decoSel = (k) => selected && selected.kind === 'deco' && selected.i === k;

  const photoInner = (p, containerAr) => {
    return (
      <>
        <PhotoFill photo={p} containerAr={containerAr} />
        {(p.deco || []).map((it, k) => (
          <div key={k} className="absolute" style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}>
            <DecoItemView it={it} />
          </div>
        ))}
        {p.caption ? (
          <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-center italic text-white" style={{ backgroundColor: 'rgba(0,0,0,0.45)', fontSize: '3cqmin' }}>{p.caption}</div>
        ) : null}
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={interactive ? () => onSelect?.(null) : undefined}
      onPointerMove={interactiveCells ? onCanvasMove : undefined}
      onPointerUp={interactiveCells ? onCanvasUp : undefined}
      onPointerCancel={interactiveCells ? onCanvasUp : undefined}
      // Sur la zone d'édition, on désactive le menu « copier/télécharger
      // l'image » du navigateur (appui long) : sinon il s'ouvre pendant qu'on
      // essaie de déplacer une photo au doigt.
      onContextMenu={interactive ? (e) => e.preventDefault() : undefined}
      className={`relative overflow-hidden rounded-lg border border-slate-200 shadow-sm ${interactive ? 'select-none' : ''}`}
      style={{ width, maxWidth: '100%', aspectRatio: String(lay.pageW / lay.pageH), containerType: 'size', touchAction: interactive ? (touchDragging ? 'none' : 'pan-y') : undefined, ...(interactive ? { WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}), ...baseStyle }}
    >
      {spec.type === 'photo' && (spec.photo?.display || spec.photo?.full) && (
        <>
          {spec.spreadCount > 1 ? (
            <img src={spec.photo.display || spec.photo.full} alt="" draggable={false}
              style={{ position: 'absolute', top: 0, height: '100%', width: `${spec.spreadCount * 100}%`, maxWidth: 'none', left: `${-spec.spreadIndex * 100}%`, objectFit: 'cover' }} />
          ) : (
            <img src={spec.photo.display || spec.photo.full} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          )}
          {spec.toned !== false && <div className="absolute inset-0" style={{ backgroundColor: 'rgba(251,248,243,0.80)' }} />}
        </>
      )}
      {/* en-tête */}
      <div className="absolute overflow-hidden" style={{ left: pct(lay.pad, lay.pageW), top: pct(lay.pad, lay.pageH), width: pct(lay.contentW, lay.pageW), height: pct(lay.headerH, lay.pageH) }}>
        <div style={{ display: 'inline-block', maxWidth: '100%', ...(onPlate ? { backgroundColor: 'rgba(251,248,243,0.85)', borderRadius: '4px', padding: '1.5% 2.2%' } : {}) }}>
          <div style={{ color: accent, fontSize: '1.45cqmin', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            {unitLabel(unit)} {dayIndex + 1}{location ? ` · ${location}` : ''}{!firstPage ? ' · suite' : ''}
          </div>
          {firstPage && title ? <div style={{ color: ink, fontSize: '3.7cqmin', fontWeight: 700, lineHeight: 1.1, fontFamily: 'Georgia, serif' }}>{title}</div> : null}
          {firstPage && note ? <div style={{ color: '#41433F', fontSize: '1.75cqmin', lineHeight: 1.45, marginTop: '1%' }}>{note}</div> : null}
        </div>
      </div>
      {/* photos */}
      {freeValid
        ? photos.map((p, i) => {
            const b = free[i];
            const ar = p.w && p.h ? p.w / p.h : 4 / 3;
            // hs = hauteur du CADRE (1 = ratio de la photo, photo entière ;
            // autre valeur = la photo est recadrée dans le cadre, avec son
            // point de mire fx/fy/fz).
            const hs = b.hs || 1;
            const wPct = ((b.scale * minPage) / lay.pageW) * 100;
            const hPct = (((b.scale * minPage) / ar) * hs / lay.pageH) * 100;
            return (
              <div key={i} onPointerDown={interactiveCells ? (e) => startPhoto(e, i) : undefined}
                className={`absolute overflow-hidden ${interactiveCells ? 'cursor-grab hover:ring-2 active:cursor-grabbing' : ''} ${photoSel(i) ? 'ring-2 ring-coral-500' : 'ring-coral-400'}`}
                style={{ left: `${b.xf * 100}%`, top: `${b.yf * 100}%`, width: `${wPct}%`, height: `${hPct}%`, transform: `translate(-50%,-50%) rotate(${b.rot}deg)`, containerType: 'size' }}>
                {photoInner(p, ar / hs)}
              </div>
            );
          })
        : photos.map((p, i) => {
            const c = lay.cells[i];
            if (!c) return null;
            return (
              <div key={i} onPointerDown={interactiveCells ? (e) => startPhoto(e, i) : undefined}
                className={`absolute overflow-hidden ${interactiveCells ? 'cursor-grab hover:ring-2 active:cursor-grabbing' : ''} ${photoSel(i) ? 'ring-2 ring-coral-500' : 'ring-coral-400'}`}
                style={{ left: pct(c.x, lay.pageW), top: pct(c.y, lay.pageH), width: pct(c.w, lay.pageW), height: pct(c.h, lay.pageH), containerType: 'size' }}>
                {photoInner(p, c.w / c.h)}
              </div>
            );
          })}
      {/* décorations de page */}
      {(deco || []).map((it, k) => (
        <div key={k} onPointerDown={interactive ? (e) => startDeco(e, k) : undefined}
          className={`absolute ${interactive ? 'cursor-grab active:cursor-grabbing' : ''} ${decoSel(k) ? 'outline outline-2 outline-coral-500 outline-offset-1' : ''}`}
          style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}>
          <DecoItemView it={it} />
        </div>
      ))}
      {/* repères d'alignement (lignes rouges) pendant un glissement */}
      {guides?.v != null && (
        <div className="pointer-events-none absolute inset-y-0 z-20"
          style={{ left: `calc(${guides.v * 100}% - 1px)`, width: '2px', backgroundColor: '#FF3355', boxShadow: '0 0 0 0.5px rgba(255,255,255,0.8)' }} />
      )}
      {guides?.h != null && (
        <div className="pointer-events-none absolute inset-x-0 z-20"
          style={{ top: `calc(${guides.h * 100}% - 1px)`, height: '2px', backgroundColor: '#FF3355', boxShadow: '0 0 0 0.5px rgba(255,255,255,0.8)' }} />
      )}
    </div>
  );
}

// Décorer LA PAGE : le fond du canevas reproduit EXACTEMENT la page imprimée
// (fond, en-tête titre/description, photos disposées avec cadres et légendes),
// pour que rien ne se décale ensuite dans le PDF.
export function PageDecorateModal({
  photos, format, onFormatChange, theme, title, note, firstPage,
  dayIndex, location, bg, pageIndex, pageCount, unit = 'jour',
  initialItems, onChange, initialFree, onChangeFree, onClose,
}) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  const spec = resolveBg(bg, pageIndex, pageCount);
  const onPlate = spec.type !== 'none';
  const lay = pageLayout(photos, format, { title, note, firstPage, onPlate });
  const pct = (v, total) => `${(v / total) * 100}%`;
  const ink = theme?.ink || '#1C2B2D';
  const accent = theme?.accent || '#C8643C';
  const minPage = Math.min(lay.pageW, lay.pageH);

  // Disposition libre active si on a des boîtes valides pour cette page.
  const freeValid = Array.isArray(initialFree) && initialFree.length === photos.length && photos.length > 0;

  // Passage en disposition libre : on initialise les boîtes depuis la grille.
  const enableFree = () => onChangeFree(seedFreeBoxes(photos, lay));
  const disableFree = () => onChangeFree(null);

  // Fond de la page
  let baseStyle = { backgroundColor: theme?.paper || '#FBF8F3', ...themePatternStyle(theme) };
  let bgPhoto = null;
  if (spec.type === 'color') baseStyle = { backgroundColor: spec.color };
  else if (spec.type === 'photo' && (spec.photo?.display || spec.photo?.full)) {
    bgPhoto = (
      <>
        {spec.spreadCount > 1 ? (
          <img src={spec.photo.display || spec.photo.full} alt="" draggable={false}
            style={{ position: 'absolute', top: 0, height: '100%', width: `${spec.spreadCount * 100}%`, maxWidth: 'none', left: `${-spec.spreadIndex * 100}%`, objectFit: 'cover' }} />
        ) : (
          <img src={spec.photo.display || spec.photo.full} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        )}
        {spec.toned !== false && <div className="absolute inset-0" style={{ backgroundColor: 'rgba(251,248,243,0.80)' }} />}
      </>
    );
  }

  const headerInner = (
    <div style={{ display: 'inline-block', maxWidth: '100%', ...(onPlate ? { backgroundColor: 'rgba(251,248,243,0.85)', borderRadius: '4px', padding: '1.5% 2.2%' } : {}) }}>
      <div style={{ color: accent, fontSize: '1.45cqmin', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.8%' }}>
        {unitLabel(unit)} {dayIndex + 1}{location ? ` · ${location}` : ''}{!firstPage ? ' · suite' : ''}
      </div>
      {firstPage && title ? <div style={{ color: ink, fontSize: '3.7cqmin', fontWeight: 700, lineHeight: 1.1, fontFamily: 'Georgia, serif' }}>{title}</div> : null}
      {firstPage && note ? <div style={{ color: '#41433F', fontSize: '1.75cqmin', lineHeight: 1.45, marginTop: '1%' }}>{note}</div> : null}
    </div>
  );

  const background = (
    <div className="absolute inset-0" style={baseStyle}>
      {bgPhoto}
      {/* en-tête (même boîte que le PDF, hauteur fixe) */}
      <div className="absolute overflow-hidden" style={{ left: pct(lay.pad, lay.pageW), top: pct(lay.pad, lay.pageH), width: pct(lay.contentW, lay.pageW), height: pct(lay.headerH, lay.pageH) }}>
        {headerInner}
      </div>
      {/* photos en grille (en disposition libre, elles deviennent des objets
          déplaçables et ne sont donc plus dessinées dans le fond) */}
      {!freeValid && photos.map((p, i) => {
        const c = lay.cells[i];
        if (!c) return null;
        const pdeco = p.deco || [];
        return (
          <div key={i} className="absolute overflow-hidden" style={{ left: pct(c.x, lay.pageW), top: pct(c.y, lay.pageH), width: pct(c.w, lay.pageW), height: pct(c.h, lay.pageH), containerType: 'size' }}>
            <PhotoFill photo={p} containerAr={c.w / c.h} />
            {pdeco.map((it, k) => (
              <div key={k} className="absolute" style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}>
                <DecoItemView it={it} />
              </div>
            ))}
            {p.caption ? (
              <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-center italic text-white" style={{ backgroundColor: 'rgba(0,0,0,0.45)', fontSize: '3cqmin' }}>{p.caption}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  // Objets manipulables : en disposition libre, les photos en tête (z-order
  // derrière), puis les décorations.
  const photoObjs = freeValid
    ? photos.map((p, i) => ({ kind: 'photo', photo: p, ar: p.w && p.h ? p.w / p.h : 4 / 3, ...initialFree[i] }))
    : [];
  const objects = [...photoObjs, ...(initialItems || [])];

  const handleChange = (objs) => {
    const decos = objs.filter((o) => o.kind !== 'photo');
    const boxes = freeValid
      ? objs.filter((o) => o.kind === 'photo').map(({ xf, yf, scale, rot, hs }) => ({ xf, yf, scale, rot, ...(hs && hs !== 1 ? { hs } : {}) }))
      : undefined;
    // Une SEULE mise à jour (sinon le 2e appel écrase le 1er → décos perdues).
    onChange(decos, boxes);
  };

  const FORMAT_LABELS = { carre: '21 × 21 cm', a4paysage: 'A4 paysage', a4portrait: 'A4 portrait' };
  const toolbar = (
    <div className="mb-2 space-y-2">
      {onFormatChange && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600">Format :</span>
          {Object.entries(FORMAT_LABELS).map(([k, lbl]) => (
            <button key={k} onClick={() => onFormatChange(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${format === k ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {lbl}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Photos :</span>
        <button onClick={freeValid ? disableFree : enableFree}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${freeValid ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {freeValid ? '✓ Disposition libre (déplaçables)' : '✋ Disposer les photos librement'}
        </button>
        {freeValid && (
          <button onClick={enableFree} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200" title="Revenir à la disposition automatique en grille">
            ↺ Réinitialiser
          </button>
        )}
      </div>
    </div>
  );

  return (
    <DecoEditor
      key={freeValid ? `free-${photos.length}` : 'grid'}
      title="Composer la page"
      aspect={lay.pageW / lay.pageH}
      initialItems={objects}
      onChange={handleChange}
      onClose={onClose}
      background={background}
      toolbar={toolbar}
    />
  );
}

function PhotoTile({ photo, onCaption, onRemove, onMoveLeft, onMoveRight, canLeft, canRight, onEffect, onDeco, locked = false }) {
  const [fxOpen, setFxOpen] = useState(false);
  const [decoOpen, setDecoOpen] = useState(false);
  const effect = getPhotoEffect(photo.effect);
  const deco = photo.deco || [];
  return (
    <div className={`overflow-hidden rounded-xl border bg-white ${locked ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className="relative aspect-[4/3] bg-slate-100" style={{ containerType: 'size' }}>
        <PhotoFill photo={photo} containerAr={4 / 3} />
        {/* aperçu des décorations */}
        {deco.map((it, i) => (
          <div key={i} className="pointer-events-none absolute"
            style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}>
            <DecoItemView it={it} />
          </div>
        ))}
        {locked ? (
          /* Photo d'une page verrouillée : aucune action possible. */
          <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500/90 px-2 py-1 text-[10px] font-bold text-white"
            title="Photo sur une page verrouillée : déverrouille la page pour la modifier.">🔒 page verrouillée</span>
        ) : (
          <>
            <button
              type="button"
              onClick={onRemove}
              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
              title="Retirer cette photo"
            >
              ✕
            </button>
            <div className="absolute left-1.5 top-1.5 flex gap-1">
              <button type="button" onClick={onMoveLeft} disabled={!canLeft}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 disabled:opacity-30" title="Déplacer avant">‹</button>
              <button type="button" onClick={onMoveRight} disabled={!canRight}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 disabled:opacity-30" title="Déplacer après">›</button>
            </div>
            <button
              type="button"
              onClick={() => setFxOpen(true)}
              className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white hover:bg-black/75"
              title="Effet / filtre"
            >
              🎨 {effect.id === 'none' ? 'Effet' : effect.label}
            </button>
            <button
              type="button"
              onClick={() => setDecoOpen(true)}
              className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white hover:bg-black/75"
              title="Ajouter emojis / stickers / texte"
            >
              ✨ Décorer
            </button>
          </>
        )}
        {isLowRes(photo) && (
          <span className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
            title="Photo un peu petite : risque de flou à l'impression en grand.">⚠︎ petite</span>
        )}
      </div>
      <input
        value={photo.caption || ''}
        onChange={(e) => onCaption(e.target.value)}
        placeholder="Légende sous la photo"
        disabled={locked}
        className="w-full border-t border-slate-100 px-2.5 py-2 text-xs text-slate-700 outline-none disabled:bg-amber-50/50 disabled:text-slate-400"
      />
      {fxOpen && !locked && (
        <EffectPicker photo={photo} current={effect.id} onChange={onEffect} onClose={() => setFxOpen(false)} />
      )}
      {decoOpen && !locked && (
        <DecorateModal photo={photo} onChange={onDeco} onClose={() => setDecoOpen(false)} />
      )}
    </div>
  );
}

// Fenêtre « ajouter une décoration » à la page (autocollant, texte, bulle,
// image, clipart Pixabay). Réutilise le panneau d'ajout partagé.
function AddDecoSheet({ onAddItem, onClose }) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Ajouter une décoration</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <p className="mb-2 text-xs text-slate-500">L'élément ajouté apparaît au centre de la page ; tu peux ensuite le glisser, le redimensionner et le pivoter directement dans l'aperçu.</p>
          <DecoAddPanel onAddItem={onAddItem} />
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-100 px-4 py-3">
          <button onClick={onClose} className="rounded-lg bg-coral-500 px-5 py-2 text-sm font-semibold text-white">Terminé</button>
        </div>
      </div>
    </div>
  );
}

// Vrai quand l'écran est étroit (téléphone) : sert à cibler la bonne page
// quand l'aperçu n'affiche qu'une seule page à la fois.
function useIsMobile(breakpoint = 640) {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}

// Champ « nombre de photos sur cette page ». On laisse l'utilisateur taper
// librement (texte local) et on ne recalcule la répartition qu'à la validation
// (quand on quitte la case ou qu'on appuie sur Entrée) : sinon chaque frappe
// était bridée et la valeur retombait toujours sur le minimum ou le maximum.
function PageCountInput({ value, min = 1, max, onCommit }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { setEditing(true); setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center"
    />
  );
}

// Mode « Trier en grand » : plein écran, photos en grand pour comparer les
// détails (utile quand on a des doublons), suppression rapide, réorganisation
// par glisser-déposer, et appui sur une photo pour l'ouvrir en plein écran.
export function PhotoSortModal({ photos, onChange, onClose, unit = 'jour', frozenFlags = [] }) {
  const keyer = useRef(0);
  const [list, setList] = useState(() => photos.map((p) => ({ p, k: keyer.current++ })));
  const listRef = useRef(list);
  useEffect(() => { listRef.current = list; }, [list]);

  // Glisser-déposer (pointeur souris + tactile). Au doigt, on n'active le
  // glissement qu'après un bref appui maintenu, pour que le défilement de la
  // liste reste possible et qu'on ne déplace pas une photo par erreur.
  const [dragK, setDragK] = useState(null);
  const dragKRef = useRef(null);
  const pending = useRef(null);
  const holdTimer = useRef(null);
  const tileEls = useRef({});
  const [zoom, setZoom] = useState(null); // index affiché en plein écran, ou null
  const swipe = useRef(null);
  // « retour » : ferme d'abord la photo en plein écran, puis la fenêtre.
  useBackClose(() => {
    if (zoom != null) { setZoom(null); return false; }
    onClose();
  });

  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const activate = (k, el, pid) => {
    dragKRef.current = k; setDragK(k);
    try { el?.setPointerCapture?.(pid); } catch { /* ignore */ }
    // Petite vibration : on SENT que la photo est prise et déplaçable.
    try { navigator.vibrate?.(15); } catch { /* non supporté */ }
  };
  // Pendant un glissement actif, on empêche le navigateur de récupérer le
  // geste pour défiler (sinon il coupe le glissement : photo figée). Voir le
  // même correctif dans PagePreview.
  useEffect(() => {
    const onTouchMove = (e) => { if (dragKRef.current != null) e.preventDefault(); };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);
  // Photos « figées » (pages verrouillées) : visibles en grand, mais ni
  // déplaçables ni supprimables. `flags[i]` suit la POSITION i dans la liste :
  // les photos figées ne bougent jamais, et les libres ne permutent qu'entre
  // deux positions sans photo figée entre elles → chaque page verrouillée
  // garde exactement ses photos.
  const flags = useRef([...(frozenFlags || [])]);
  const frozenAt = (idx) => !!flags.current[idx];
  const isFrozen = (k) => {
    const idx = listRef.current.findIndex((x) => x.k === k);
    return idx >= 0 && frozenAt(idx);
  };
  const onTileDown = (e, k) => {
    const el = e.currentTarget;
    pending.current = { k, x: e.clientX, y: e.clientY, el, pid: e.pointerId, touch: e.pointerType === 'touch', moved: false };
    if (isFrozen(k)) return; // figée : appui = zoom seulement, pas de glissement
    if (e.pointerType === 'touch') {
      clearHold();
      const pid = e.pointerId;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (pending.current && pending.current.k === k) activate(k, el, pid);
      }, 240);
    }
  };
  const tileAt = (x, y) => {
    for (const k in tileEls.current) {
      const el = tileEls.current[k];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(k);
    }
    return null;
  };
  const reorderTo = (targetK) => {
    if (targetK == null || targetK === dragKRef.current) return;
    setList((cur) => {
      const from = cur.findIndex((x) => x.k === dragKRef.current);
      const to = cur.findIndex((x) => x.k === targetK);
      if (from < 0 || to < 0 || from === to) return cur;
      // Interdit : déposer sur une position figée, ou passer PAR-DESSUS une
      // photo figée (ça changerait le contenu d'une page verrouillée).
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      for (let i = lo; i <= hi; i += 1) if (frozenAt(i)) return cur;
      const next = [...cur];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };
  const onTileMove = (e) => {
    if (dragKRef.current != null) {
      e.preventDefault?.();
      reorderTo(tileAt(e.clientX, e.clientY));
      return;
    }
    const p = pending.current;
    if (!p) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (dist > 6) p.moved = true;
    if (p.touch) {
      // Le doigt bouge avant l'appui maintenu → c'est un défilement : on annule.
      if (dist > 10) { clearHold(); pending.current = null; }
    } else if (dist > 6 && !isFrozen(p.k)) {
      activate(p.k, p.el, p.pid);
    }
  };
  const onTileUp = () => {
    clearHold();
    if (dragKRef.current != null) {
      dragKRef.current = null; setDragK(null);
      onChange(listRef.current.map((x) => x.p));
      pending.current = null;
      return;
    }
    const p = pending.current;
    pending.current = null;
    if (p && !p.moved) {
      const idx = listRef.current.findIndex((x) => x.k === p.k);
      if (idx >= 0) setZoom(idx);
    }
  };
  const onTileCancel = () => {
    clearHold();
    if (dragKRef.current != null) { dragKRef.current = null; setDragK(null); }
    pending.current = null;
  };
  const removeAt = (idx) => {
    if (frozenAt(idx)) return; // photo d'une page verrouillée : intouchable
    flags.current = flags.current.filter((_, i) => i !== idx);
    const next = listRef.current.filter((_, i) => i !== idx);
    setList(next);
    onChange(next.map((x) => x.p));
    if (zoom != null) {
      if (next.length === 0) setZoom(null);
      else setZoom(Math.min(zoom, next.length - 1));
    }
  };
  const go = (d) => setZoom((z) => {
    if (z == null) return z;
    const n = z + d;
    return n >= 0 && n < listRef.current.length ? n : z;
  });

  useEffect(() => {
    if (zoom == null) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') setZoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const label = unit === 'etape' ? 'étape' : 'journée';
  const zp = zoom != null ? list[zoom]?.p : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
      {/* en-tête fixe */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">Trier les photos en grand</h3>
          <p className="text-[11px] text-white/60">{list.length} photo{list.length > 1 ? 's' : ''} · touche pour agrandir · appuie et glisse pour réordonner</p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20">Terminé</button>
      </div>

      {/* grille défilable de grandes photos */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {list.length === 0 ? (
          <p className="mt-10 text-center text-sm text-white/60">Plus aucune photo dans cette {label}.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {list.map((it, i) => (
              <div
                key={it.k}
                ref={(el) => { if (el) tileEls.current[it.k] = el; else delete tileEls.current[it.k]; }}
                onPointerDown={(e) => onTileDown(e, it.k)}
                onPointerMove={onTileMove}
                onPointerUp={onTileUp}
                onPointerCancel={onTileCancel}
                onContextMenu={(e) => e.preventDefault()}
                style={{ touchAction: dragK === it.k ? 'none' : 'pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                className={`relative select-none overflow-hidden rounded-xl border-2 bg-slate-800 transition-transform ${dragK === it.k ? 'z-10 scale-95 border-coral-400 opacity-80 shadow-2xl' : 'border-transparent'}`}
              >
                <div className="aspect-[3/4] w-full" style={{ containerType: 'size' }}>
                  <PhotoFill photo={it.p} containerAr={3 / 4} />
                </div>
                <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-black/60 px-1.5 text-[11px] font-bold text-white">{i + 1}</span>
                {isLowRes(it.p) && (
                  <span className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">⚠︎ petite</span>
                )}
                {frozenAt(i) ? (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-amber-500/90 px-2 py-1 text-[10px] font-bold text-white">🔒</span>
                ) : (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeAt(i)}
                    className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-base text-white hover:bg-red-600"
                    title="Supprimer cette photo"
                  >
                    🗑
                  </button>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4 text-center text-[10px] font-medium text-white/85">
                  {frozenAt(i) ? '🔒 page verrouillée · 👆 agrandir' : '👆 agrandir · ⣿ glisser'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* visionneuse plein écran : voir une photo en très grand pour les détails */}
      {zp && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-medium text-white/80">{zoom + 1} / {list.length}</span>
            <button onClick={() => setZoom(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">✕ Fermer</button>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onPointerDown={(e) => { swipe.current = { x: e.clientX }; }}
            onPointerUp={(e) => {
              if (!swipe.current) return;
              const dx = e.clientX - swipe.current.x;
              swipe.current = null;
              if (dx > 45) go(-1);
              else if (dx < -45) go(1);
            }}
          >
            <img src={zp.full || zp.display} alt="" draggable={false} className="max-h-full max-w-full select-none object-contain" />
            {zoom > 0 && (
              <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-2xl text-white hover:bg-black/70">‹</button>
            )}
            {zoom < list.length - 1 && (
              <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-2xl text-white hover:bg-black/70">›</button>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-3 px-4 py-3">
            {frozenAt(zoom) ? (
              <span className="rounded-xl bg-amber-500/20 px-5 py-2.5 text-sm font-semibold text-amber-300">🔒 Photo sur une page verrouillée</span>
            ) : (
              <button
                type="button"
                onClick={() => removeAt(zoom)}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                🗑 Supprimer cette photo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Télécharge une liste de fichiers (repli quand le partage natif n'est pas
// disponible, ex. sur ordinateur).
function downloadFiles(files) {
  files.forEach((f) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

// Petite fenêtre de partage : les fichiers sont DÉJÀ prêts. Le partage natif
// (WhatsApp…) est déclenché ICI, par le clic de l'utilisateur → l'« autorisation »
// est fraîche, donc le mobile ouvre bien la fenêtre WhatsApp au lieu de se
// rabattre sur un téléchargement.
export function ShareSheet({ files, text, onClose }) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  const [busy, setBusy] = useState(false);
  const isPdf = files.length === 1 && files[0].type === 'application/pdf';
  const canShare =
    typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files });
  const doShare = async () => {
    setBusy(true);
    try {
      await navigator.share({ files, title: text, text });
      onClose();
    } catch (e) {
      if (e && e.name === 'AbortError') { setBusy(false); return; } // annulé : on reste
      downloadFiles(files); // autre erreur : on télécharge en secours
      onClose();
    }
  };
  const doDownload = () => { downloadFiles(files); onClose(); };
  const label = isPdf ? 'Le fichier PDF est prêt' : `${files.length} image${files.length > 1 ? 's' : ''} prête${files.length > 1 ? 's' : ''}`;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-center text-base font-semibold text-slate-800">Prêt à partager</h3>
        <p className="mt-1 text-center text-xs text-slate-500">{label}. Choisis comment l'envoyer :</p>
        <div className="mt-4 space-y-2">
          {canShare && (
            <button
              type="button"
              onClick={doShare}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {busy ? <Spinner className="h-4 w-4" /> : <span>📲</span>}
              Partager (WhatsApp, Messages…)
            </button>
          )}
          <button
            type="button"
            onClick={doDownload}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ⬇️ Télécharger {isPdf ? 'le PDF' : (files.length > 1 ? 'les images' : "l'image")}
          </button>
          {!canShare && (
            <p className="text-center text-[11px] text-slate-500">
              Le partage direct n'est pas disponible sur ce navigateur (souvent sur ordinateur). Télécharge {isPdf ? 'le fichier' : 'les images'}, puis envoie-les sur WhatsApp.
            </p>
          )}
          <button type="button" onClick={onClose} className="w-full py-2 text-center text-xs text-slate-400 hover:text-slate-600">Annuler</button>
        </div>
      </div>
    </div>
  );
}

// ✂️ Recadrage visuel plein écran, comme l'éditeur photo du téléphone :
// un rectangle avec poignées (coins + bords) à glisser sur la photo, grille
// des tiers, zones sombres autour. Le rectangle choisi est converti en
// cadre (hs) + point de mire (fx/fy/fz) — rendu identique aperçu ⇄ PDF.
export function CropModal({ photo, initialHs = 1, onApply, onClose }) {
  useBackClose(onClose);
  const ar = photo.w && photo.h ? photo.w / photo.h : 4 / 3;
  const frameRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useRef(null);
  const [dim, setDim] = useState(null); // taille affichée de la photo (px)
  const [rect, setRect] = useState(() => {
    // Rectangle initial = fenêtre actuellement visible de la photo.
    const f = photoFocal(photo);
    const cv = coverFrac(ar / (initialHs || 1), ar, f.fx, f.fy, f.fz);
    const du = Math.min(1, 1 / cv.w);
    const dv = Math.min(1, 1 / cv.h);
    const u0 = Math.min(1 - du, Math.max(0, -cv.left / cv.w));
    const v0 = Math.min(1 - dv, Math.max(0, -cv.top / cv.h));
    return { u0, v0, u1: u0 + du, v1: v0 + dv };
  });
  useEffect(() => {
    const upd = () => {
      const el = frameRef.current;
      if (!el) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      let w = W;
      let h = W / ar;
      if (h > H) { h = H; w = H * ar; }
      setDim({ w, h });
    };
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, [ar]);

  const MIN = 0.08; // taille minimale du rectangle (fraction de la photo)
  const toUV = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
  };
  const startDrag = (e, m) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { m, start: toUV(e), rect: { ...rect } };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const { u, v } = toUV(e);
    const dx = u - d.start.u;
    const dy = v - d.start.v;
    let { u0, v0, u1, v1 } = d.rect;
    if (d.m === 'move') {
      const w = u1 - u0;
      const h = v1 - v0;
      u0 = Math.min(1 - w, Math.max(0, d.rect.u0 + dx)); u1 = u0 + w;
      v0 = Math.min(1 - h, Math.max(0, d.rect.v0 + dy)); v1 = v0 + h;
    } else {
      if (d.m.includes('w')) u0 = Math.min(u1 - MIN, Math.max(0, d.rect.u0 + dx));
      if (d.m.includes('e')) u1 = Math.max(u0 + MIN, Math.min(1, d.rect.u1 + dx));
      if (d.m.includes('n')) v0 = Math.min(v1 - MIN, Math.max(0, d.rect.v0 + dy));
      if (d.m.includes('s')) v1 = Math.max(v0 + MIN, Math.min(1, d.rect.v1 + dy));
    }
    setRect({ u0, v0, u1, v1 });
  };
  const endDrag = () => { drag.current = null; };
  const pct = (x) => `${x * 100}%`;
  const { u0, v0, u1, v1 } = rect;
  const handleProps = (m) => ({
    onPointerDown: (e) => startDrag(e, m),
    onPointerMove: onMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });
  // Poignée de coin : grand disque tactile invisible + équerre blanche.
  const corner = (m, uu, vv, borders) => (
    <div key={m} {...handleProps(m)}
      className="absolute z-20 h-9 w-9 -translate-x-1/2 -translate-y-1/2 touch-none"
      style={{ left: pct(uu), top: pct(vv), cursor: `${m}-resize` }}>
      <div className={`absolute inset-1.5 border-white ${borders}`} style={{ borderStyle: 'solid' }} />
    </div>
  );
  // Poignée de bord : barre blanche au milieu du côté.
  const edge = (m, uu, vv, horiz) => (
    <div key={m} {...handleProps(m)}
      className="absolute z-20 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-none"
      style={{ left: pct(uu), top: pct(vv), cursor: `${m}-resize` }}>
      <div className={`rounded-full bg-white shadow ${horiz ? 'h-1.5 w-7' : 'h-7 w-1.5'}`} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h3 className="font-semibold text-white">✂️ Recadrer la photo</h3>
        <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-white/70 hover:text-white">✕</button>
      </div>
      <div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center px-3">
        {dim && (
          <div ref={wrapRef} className="relative touch-none select-none" style={{ width: dim.w, height: dim.h, WebkitTouchCallout: 'none' }}
            onContextMenu={(e) => e.preventDefault()}>
            <img src={photo.display || photo.full} alt="" draggable={false} className="h-full w-full" style={{ objectFit: 'fill' }} />
            {/* zones sombres hors du cadre */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: pct(v0) }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ height: pct(1 - v1) }} />
            <div className="pointer-events-none absolute bg-black/60" style={{ left: 0, top: pct(v0), width: pct(u0), height: pct(v1 - v0) }} />
            <div className="pointer-events-none absolute bg-black/60" style={{ right: 0, top: pct(v0), width: pct(1 - u1), height: pct(v1 - v0) }} />
            {/* rectangle + grille des tiers (glisser à l'intérieur = déplacer) */}
            <div {...handleProps('move')}
              className="absolute z-10 cursor-move touch-none border-2 border-white/90"
              style={{ left: pct(u0), top: pct(v0), width: pct(u1 - u0), height: pct(v1 - v0) }}>
              <div className="pointer-events-none absolute inset-y-0 border-l border-white/50" style={{ left: '33.33%' }} />
              <div className="pointer-events-none absolute inset-y-0 border-l border-white/50" style={{ left: '66.66%' }} />
              <div className="pointer-events-none absolute inset-x-0 border-t border-white/50" style={{ top: '33.33%' }} />
              <div className="pointer-events-none absolute inset-x-0 border-t border-white/50" style={{ top: '66.66%' }} />
            </div>
            {corner('nw', u0, v0, 'border-l-4 border-t-4')}
            {corner('ne', u1, v0, 'border-r-4 border-t-4')}
            {corner('sw', u0, v1, 'border-l-4 border-b-4')}
            {corner('se', u1, v1, 'border-r-4 border-b-4')}
            {edge('n', (u0 + u1) / 2, v0, true)}
            {edge('s', (u0 + u1) / 2, v1, true)}
            {edge('w', u0, (v0 + v1) / 2, false)}
            {edge('e', u1, (v0 + v1) / 2, false)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-4">
        <button type="button" onClick={onClose}
          className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10">Annuler</button>
        <button type="button" onClick={() => setRect({ u0: 0, v0: 0, u1: 1, v1: 1 })}
          className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10">↺ Photo entière</button>
        <button type="button" onClick={() => onApply(rect)}
          className="rounded-lg bg-coral-500 px-5 py-2 text-sm font-semibold text-white hover:bg-coral-600">✓ Valider</button>
      </div>
    </div>
  );
}

// Choix de la source des photos à ajouter sur une page (mode manuel) :
// depuis les fichiers du téléphone, ou parmi les photos DÉJÀ dans le jour
// (elles seront déplacées vers cette page).
function AddPhotosChoiceSheet({ page, hasDayPhotos, onFiles, onFromDay, onClose }) {
  useBackClose(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-center text-base font-semibold text-slate-800">Ajouter des photos · page {page + 1}</h3>
        <div className="mt-4 space-y-2">
          <button type="button" onClick={onFiles}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-coral-500 px-4 py-3 text-sm font-semibold text-white hover:bg-coral-600">
            📁 Depuis mes fichiers / ma galerie
          </button>
          <button type="button" onClick={onFromDay} disabled={!hasDayPhotos}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            🖼️ Depuis les photos de ce jour
          </button>
          {!hasDayPhotos && (
            <p className="text-center text-[11px] text-slate-400">Aucune photo déplaçable depuis les autres pages.</p>
          )}
          <button type="button" onClick={onClose} className="w-full py-2 text-center text-xs text-slate-400 hover:text-slate-600">Annuler</button>
        </div>
      </div>
    </div>
  );
}

// Sélection multiple parmi les photos du jour, pour les DÉPLACER vers la page
// cible (les autres pages ne bougent pas, sauf celles d'où viennent les photos).
function DayPhotoPickerModal({ photos, targetPage, pageOfIdx, isFrozenPhoto, onConfirm, onClose }) {
  useBackClose(onClose);
  const [sel, setSel] = useState(() => new Set());
  const toggle = (gi) =>
    setSel((s) => { const n = new Set(s); if (n.has(gi)) n.delete(gi); else n.add(gi); return n; });
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-900">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">Choisir les photos → page {targetPage + 1}</h3>
          <p className="text-[11px] text-white/60">Touche les photos à déplacer sur cette page.</p>
        </div>
        <button onClick={onClose} className="-m-2 shrink-0 p-2 text-2xl leading-none text-white/60 hover:text-white">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((p, gi) => {
            const here = pageOfIdx(gi) === targetPage;
            const frozen = isFrozenPhoto(gi);
            const selectable = !here && !frozen;
            const on = sel.has(gi);
            return (
              <button
                key={gi}
                type="button"
                disabled={!selectable}
                onClick={() => toggle(gi)}
                className={`relative aspect-square overflow-hidden rounded-lg border-2 ${on ? 'border-coral-400' : 'border-transparent'} ${selectable ? '' : 'opacity-40'}`}
              >
                <img src={p.display || p.full} alt="" className="h-full w-full object-cover" draggable={false} />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {frozen ? '🔒' : here ? 'ici' : `p.${pageOfIdx(gi) + 1}`}
                </span>
                {on && (
                  <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-coral-500 text-xs font-bold text-white">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          disabled={!sel.size}
          onClick={() => onConfirm([...sel])}
          className="rounded-xl bg-coral-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          📥 Déplacer {sel.size || ''} photo{sel.size > 1 ? 's' : ''} vers la page {targetPage + 1}
        </button>
      </div>
    </div>
  );
}

export function DayCard({ day, index, entry, onChange, onAddPhotos, onPickBgPhoto, busy, progress = null, format = 'carre', onFormatChange = null, theme = null, unit = 'jour', pageOffset = null, onShareDay = null }) {
  const fileRef = useRef(null);
  const addTarget = useRef(null); // page cible du prochain ajout de photos (mode manuel)
  const [addChoice, setAddChoice] = useState(null); // page : choix de la source d'ajout
  const [dayPick, setDayPick] = useState(null); // page : sélection parmi les photos du jour
  const [cropFor, setCropFor] = useState(null); // { gIdx, hs } : recadrage visuel
  const [bgOpen, setBgOpen] = useState(false);
  const [decoPage, setDecoPage] = useState(null);
  const [sel, setSel] = useState(null); // élément sélectionné dans l'aperçu : { p, kind:'photo'|'deco', i }
  const [fxFor, setFxFor] = useState(null); // index global photo : fenêtre effet/cadrage
  const [decoForPhoto, setDecoForPhoto] = useState(null); // index global photo : décorer la photo
  const [addOpen, setAddOpen] = useState(false); // fenêtre « ajouter une décoration »
  const [spreadStart, setSpreadStart] = useState(0); // 1re page du duo affiché
  const [mPage, setMPage] = useState(0); // page affichée seule en grand (mobile)
  const [aiBusy, setAiBusy] = useState(false);
  const [sortOpen, setSortOpen] = useState(false); // mode « trier en grand »
  const [sharing, setSharing] = useState(false); // préparation du partage en cours
  const [shareData, setShareData] = useState(null); // { files, text } prêts à partager

  const doShareDay = async () => {
    if (!onShareDay || sharing) return;
    setSharing(true);
    try {
      const result = await onShareDay();
      if (result && result.files && result.files.length) setShareData(result);
    } catch (e) {
      alert(e?.message || "Le partage n'a pas fonctionné. Réessaie dans un instant.");
    } finally {
      setSharing(false);
    }
  };
  const isMobile = useIsMobile();

  const update = (patch) => onChange({ ...entry, ...patch });

  const bg = normalizeBg(entry.bg);
  const total = entry.photos.length;
  // Deux modes de mise en page :
  // - auto   : répartition recalculée toute seule (~6 photos/page) ;
  // - manuel : les pages sont des boîtes stables, rien ne bouge tout seul.
  const mode = isManualLayout(entry) ? 'manuel' : 'auto';
  const splitCounts = mode === 'manuel' ? repairSplit(entry.split, total) : computeSplit(total, null);
  const pageCount = splitCounts.length;
  const chunks = splitPhotos(entry.photos, splitCounts);
  const setPageFree = (p, boxes) => {
    const next = { ...(entry.freePages || {}) };
    if (boxes) next[p] = boxes; else delete next[p];
    update({ freePages: next });
  };
  // Verrouillage d'une page : quand la mise en page est terminée, on la fige
  // pour ne plus rien déplacer par erreur. Déverrouillable à tout moment.
  const lockedPages = entry.lockedPages || {};
  const isLocked = (p) => !!lockedPages[p];
  const toggleLock = (p) => {
    setSel(null);
    // Verrouiller = prendre la main : en mode auto, on fige d'abord la mise en
    // page actuelle (bascule en manuel), puis on pose le verrou.
    if (!isManualLayout(entry)) {
      update({ layoutMode: 'manuel', split: [...splitCounts], lockedPages: { ...lockedPages, [p]: true } });
      return;
    }
    update({ lockedPages: { ...lockedPages, [p]: !lockedPages[p] } });
  };
  const lockBtn = (p) => (
    <button
      type="button"
      onClick={() => toggleLock(p)}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${isLocked(p) ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
      title={isLocked(p) ? 'Page verrouillée : les photos ne peuvent plus bouger. Touche pour déverrouiller.' : 'Verrouiller cette page (fige la mise en page, évite les déplacements accidentels)'}
    >
      {isLocked(p) ? '🔒 Verrouillée' : '🔓 Verrouiller'}
    </button>
  );
  // Remise en grille automatique d'une page passée en disposition libre
  // (répare aussi une page dont une photo déborderait du cadre).
  const gridBtn = (p) => (entry.freePages?.[p] && !isLocked(p) ? (
    <button
      type="button"
      onClick={() => { setSel(null); setPageFree(p, null); }}
      className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-200"
      title="Réorganiser automatiquement cette page en grille (annule les positions déplacées à la main)"
    >
      ↺ Grille auto
    </button>
  ) : null);
  // Mode manuel : ajouter des photos SUR cette page / supprimer une page vide.
  const addToPageBtn = (p) => (mode === 'manuel' && !isLocked(p) ? (
    <button
      type="button"
      onClick={() => setAddChoice(p)}
      className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
      title="Ajouter des photos sur cette page (les autres pages ne bougent pas)"
    >
      📷+
    </button>
  ) : null);
  const deletePageBtn = (p) => (mode === 'manuel' && splitCounts[p] === 0 && !isLocked(p) ? (
    <button
      type="button"
      onClick={() => deleteEmptyPage(p)}
      className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100"
      title="Supprimer cette page vide"
    >
      🗑
    </button>
  ) : null);
  // Change le nombre de pages (réparti équitablement, toujours valide).
  const lockedAny = splitCounts.some((_c, k) => isLocked(k));
  const pageOfIdx = (gi) => {
    let acc = 0;
    for (let k = 0; k < splitCounts.length; k += 1) {
      acc += splitCounts[k];
      if (gi < acc) return k;
    }
    return splitCounts.length - 1;
  };
  const isFrozenPhoto = (gi) => isLocked(pageOfIdx(gi));

  // --- Actions du mode MANUEL (pages = boîtes stables) ---
  // Bascule de mode. auto → manuel : on FIGE la mise en page actuelle telle
  // quelle. manuel → auto : avertissement, tout est réorganisé.
  const switchToManual = (extra = {}) =>
    update({ layoutMode: 'manuel', split: [...splitCounts], ...extra });
  const switchToAuto = () => {
    if (!window.confirm('Repasser en automatique ? La répartition sera refaite (~6 photos par page) et les verrous/dispositions libres de ces pages seront effacés.')) return;
    update({ layoutMode: 'auto', split: null, lockedPages: {}, freePages: {} });
  };
  const addEmptyPage = () => {
    const newIdx = splitCounts.length; // index de la page créée
    setSel(null);
    switchToManual({ split: [...splitCounts, 0] });
    // On ouvre directement la nouvelle page dans l'aperçu (mobile + ordi).
    setMPage(newIdx);
    setSpreadStart(Math.max(0, newIdx - 1));
  };
  // Renumérote les réglages par page (fonds, décos, verrous, dispositions)
  // après suppression de la page `removed`.
  const shiftPageMaps = (removed) => {
    const remapObj = (o) => {
      const r = {};
      Object.keys(o || {}).forEach((k) => {
        const n = Number(k);
        if (n === removed) return;
        r[n > removed ? n - 1 : n] = o[k];
      });
      return r;
    };
    const pages = [...(bg.pages || [])];
    if (removed < pages.length) pages.splice(removed, 1);
    return {
      freePages: remapObj(entry.freePages),
      pageDeco: remapObj(entry.pageDeco),
      lockedPages: remapObj(entry.lockedPages),
      bg: { ...bg, pages },
    };
  };
  const deleteEmptyPage = (p) => {
    if (splitCounts[p] !== 0 || isLocked(p)) return;
    const split = splitCounts.filter((_c, k) => k !== p);
    setSel(null);
    update({ layoutMode: 'manuel', split: split.length ? split : null, ...shiftPageMaps(p) });
  };
  // Envoie une ou plusieurs photos à la FIN d'une autre page. Seules les pages
  // concernées changent — aucune autre ne bouge.
  const movePhotosToPage = (gis, targetP) => {
    if (isLocked(targetP)) return;
    const sels = [...gis]
      .filter((gi) => !isFrozenPhoto(gi) && pageOfIdx(gi) !== targetP)
      .sort((a, b) => a - b);
    if (!sels.length) return;
    const photos = [...entry.photos];
    const counts = [...splitCounts];
    const moved = [];
    // Retraits du plus grand index au plus petit → les index restent valides.
    for (let x = sels.length - 1; x >= 0; x -= 1) {
      const gi = sels[x];
      counts[pageOfIdx(gi)] -= 1;
      moved.unshift(photos.splice(gi, 1)[0]);
    }
    const pos = counts.slice(0, targetP + 1).reduce((a, b) => a + b, 0);
    photos.splice(pos, 0, ...moved);
    counts[targetP] += moved.length;
    setSel(null);
    update({ layoutMode: 'manuel', photos, split: counts });
  };
  const movePhotoToPage = (gi, targetP) => movePhotosToPage([gi], targetP);
  const setBg = (next) => update({ bg: next });
  const getPageSpec = (p) => bg.pages?.[p] || { type: 'none' };
  const setPageSpec = (p, spec) => {
    const pages = [...(bg.pages || [])];
    while (pages.length <= p) pages.push({ type: 'none' });
    pages[p] = spec;
    setBg({ ...bg, pages });
  };
  const setPageSpan = (p, span) => setPageSpec(p, { ...getPageSpec(p), span });
  // Pages couvertes par un panorama démarré plus tôt (côté droit/suite).
  const coveredBy = (() => {
    const cov = new Array(pageCount).fill(-1);
    for (let p = 0; p < pageCount; p += 1) {
      const sp = getPageSpec(p);
      const span = sp?.type === 'photo' ? sp.span || 1 : 1;
      for (let k = p + 1; k < Math.min(pageCount, p + span); k += 1) cov[k] = p;
    }
    return cov;
  })();

  // --- Édition directe dans l'aperçu : sélection, manipulation, ajout ---
  const viewStart = Math.min(spreadStart, Math.max(0, pageCount - 2));
  const pageStartIdx = (p) => chunks.slice(0, p).reduce((a, c) => a + c.length, 0);
  // Positions « disposition libre » d'une page, calculées depuis la grille.
  const seedFreeForPage = (p) => {
    const spec = resolveBg(bg, p, pageCount);
    const lay = pageLayout(chunks[p], format, { title: entry.title, note: entry.note, firstPage: p === 0, onPlate: spec.type !== 'none' });
    return seedFreeBoxes(chunks[p], lay);
  };
  // L'objet actuellement sélectionné (photo libre ou décoration), uniformisé.
  const selObj = (() => {
    if (!sel) return null;
    if (sel.kind === 'deco') return (entry.pageDeco?.[sel.p] || [])[sel.i] || null;
    const boxes = entry.freePages?.[sel.p];
    const b = (Array.isArray(boxes) && boxes.length === (chunks[sel.p]?.length || 0)) ? boxes[sel.i] : seedFreeForPage(sel.p)[sel.i];
    if (!b) return null;
    const ph = chunks[sel.p]?.[sel.i];
    return { ...b, kind: 'photo', ar: ph?.w && ph?.h ? ph.w / ph.h : 4 / 3 };
  })();
  const patchSel = (patch) => {
    if (!sel) return;
    if (sel.kind === 'deco') {
      const items = (entry.pageDeco?.[sel.p] || []).map((d, k) => (k === sel.i ? { ...d, ...patch } : d));
      update({ pageDeco: { ...(entry.pageDeco || {}), [sel.p]: items } });
    } else {
      let boxes = entry.freePages?.[sel.p];
      if (!Array.isArray(boxes) || boxes.length !== (chunks[sel.p]?.length || 0)) boxes = seedFreeForPage(sel.p);
      boxes = boxes.map((b, k) => (k === sel.i ? { ...b, ...patch } : b));
      setPageFree(sel.p, boxes);
    }
  };
  const removeSel = () => {
    if (!sel) return;
    if (sel.kind === 'deco') {
      const items = (entry.pageDeco?.[sel.p] || []).filter((_, k) => k !== sel.i);
      update({ pageDeco: { ...(entry.pageDeco || {}), [sel.p]: items } });
    } else {
      removePhoto(pageStartIdx(sel.p) + sel.i);
    }
    setSel(null);
  };
  const addDecoItem = (item) => {
    const p = sel?.p ?? (isMobile ? Math.min(mPage, Math.max(0, pageCount - 1)) : viewStart);
    const items = [...(entry.pageDeco?.[p] || []), item];
    update({ pageDeco: { ...(entry.pageDeco || {}), [p]: items } });
    setSel({ p, kind: 'deco', i: items.length - 1 });
  };
  // Applique le rectangle choisi dans la fenêtre ✂️ Recadrer : converti en
  // hauteur de cadre (hs) + point de mire (fx/fy/fz). UNE seule mise à jour
  // (cadre + photo), sinon la seconde écraserait la première.
  const applyCrop = (r) => {
    if (!cropFor || !sel || sel.kind !== 'photo') { setCropFor(null); return; }
    const du = Math.max(0.02, r.u1 - r.u0);
    const dv = Math.max(0.02, r.v1 - r.v0);
    const hs = Math.min(6, Math.max(0.15, dv / du));
    const fz = Math.max(1, 1 / Math.max(du, dv));
    const fx = du >= 0.999 ? 0.5 : Math.min(1, Math.max(0, r.u0 / (1 - du)));
    const fy = dv >= 0.999 ? 0.5 : Math.min(1, Math.max(0, r.v0 / (1 - dv)));
    let boxes = entry.freePages?.[sel.p];
    if (!Array.isArray(boxes) || boxes.length !== (chunks[sel.p]?.length || 0)) boxes = seedFreeForPage(sel.p);
    boxes = boxes.map((b, k) => (k === sel.i ? { ...b, hs } : b));
    const photos = entry.photos.map((p, i) => (i === cropFor.gIdx ? { ...p, fx, fy, fz } : p));
    update({ photos, freePages: { ...(entry.freePages || {}), [sel.p]: boxes } });
    setCropFor(null);
  };

  // Retire des photos (index d'ORIGINE) de leur page : les autres pages
  // gardent exactement leurs photos. En manuel, une page vidée RESTE (boîte
  // stable, à supprimer soi-même si voulu) ; en auto, la répartition se refait.
  const splitAfterRemoval = (removedIdxs) => {
    if (mode !== 'manuel') return { split: null, lockedPages };
    const counts = [...splitCounts];
    for (const gi of removedIdxs) counts[pageOfIdx(gi)] -= 1;
    return { split: counts, lockedPages, layoutMode: 'manuel' };
  };

  function setPhotoCaption(pi, caption) {
    if (isFrozenPhoto(pi)) return;
    const photos = entry.photos.map((p, i) =>
      i === pi ? { ...p, caption } : p
    );
    update({ photos });
  }
  function setPhotoPatch(pi, patch) {
    if (isFrozenPhoto(pi)) return;
    const photos = entry.photos.map((p, i) => (i === pi ? { ...p, ...patch } : p));
    update({ photos });
  }
  function setPhotoDeco(pi, deco) {
    if (isFrozenPhoto(pi)) return;
    const photos = entry.photos.map((p, i) => (i === pi ? { ...p, deco } : p));
    update({ photos });
  }
  function removePhoto(pi) {
    if (isFrozenPhoto(pi)) {
      alert('Cette photo est sur une page verrouillée 🔒. Déverrouille la page pour la modifier.');
      return;
    }
    const adj = splitAfterRemoval([pi]);
    update({ photos: entry.photos.filter((_, i) => i !== pi), ...adj });
  }
  function movePhoto(pi, dir) {
    const ni = pi + dir;
    if (ni < 0 || ni >= entry.photos.length) return;
    if (isFrozenPhoto(pi) || isFrozenPhoto(ni)) return;
    const arr = [...entry.photos];
    [arr[pi], arr[ni]] = [arr[ni], arr[pi]];
    update({ photos: arr });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-coral-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-coral-600">
          {unitLabel(unit)} {index + 1}
          {day?.location ? ` · ${day.location}` : ''}
        </span>
      </div>

      <input
        value={entry.title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder={unit === 'etape' ? "Titre de l'étape" : 'Titre de la journée'}
        className="w-full border-0 border-b border-slate-200 pb-1.5 text-lg font-semibold text-slate-900 outline-none focus:border-coral-400"
      />

      <textarea
        value={entry.note}
        onChange={(e) => update({ note: e.target.value })}
        placeholder={unit === 'etape' ? 'Raconte cette étape : ce que tu as vu, mangé, ressenti…' : 'Raconte ta journée : ce que tu as vu, mangé, ressenti…'}
        rows={3}
        className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-coral-400"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          disabled={aiBusy}
          onClick={async () => {
            setAiBusy(true);
            try {
              const txt = await writeAlbumText({
                location: day?.location || entry.title,
                title: entry.title,
                note: entry.note,
                captions: (entry.photos || []).map((p) => p.caption).filter(Boolean),
                unit,
              });
              if (txt) update({ note: txt });
            } catch (e) {
              alert(e.message || "L'IA n'a pas pu écrire le texte. Réessaie dans un instant.");
            } finally {
              setAiBusy(false);
            }
          }}
          className="flex items-center gap-1.5 rounded-lg border border-coral-300 bg-coral-50 px-3 py-1.5 text-xs font-semibold text-coral-700 hover:bg-coral-100 disabled:opacity-60"
        >
          {aiBusy && <Spinner className="h-3.5 w-3.5" />}
          {aiBusy ? 'Rédaction…' : (entry.note?.trim() ? '✨ Améliorer avec l’IA' : '✨ Écrire avec l’IA')}
        </button>
        <span className="text-[11px] text-slate-400">D'après le lieu, le titre et tes légendes.</span>
      </div>

      {entry.photos.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-500">{entry.photos.length} photo{entry.photos.length > 1 ? 's' : ''}</span>
          <div className="flex flex-wrap items-center gap-2">
            {onShareDay && (
              <button
                type="button"
                onClick={doShareDay}
                disabled={sharing}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                title="Partager cette journée en images (WhatsApp, Messages…)"
              >
                {sharing ? <Spinner className="h-3.5 w-3.5" /> : <span>📲</span>}
                {sharing ? 'Préparation…' : 'Partager'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSortOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-coral-300 bg-coral-50 px-3 py-1.5 text-xs font-semibold text-coral-700 hover:bg-coral-100"
              title="Voir les photos en grand pour mieux trier et supprimer les doublons"
            >
              🔍 Trier en grand
            </button>
          </div>
        </div>
      )}

      {sortOpen && (
        <PhotoSortModal
          photos={entry.photos}
          frozenFlags={entry.photos.map((_p, gi) => isFrozenPhoto(gi))}
          onChange={(arr) => {
            // Les photos supprimées sont décomptées de LEUR page dans la
            // répartition manuelle → les autres pages (dont les verrouillées)
            // gardent exactement leurs photos.
            const removed = entry.photos
              .map((p, gi) => (arr.includes(p) ? -1 : gi))
              .filter((gi) => gi >= 0);
            if (removed.length) {
              update({ photos: arr, ...splitAfterRemoval(removed) });
            } else {
              update({ photos: arr });
            }
          }}
          onClose={() => setSortOpen(false)}
          unit={unit}
        />
      )}

      {shareData && (
        <ShareSheet files={shareData.files} text={shareData.text} onClose={() => setShareData(null)} />
      )}

      {entry.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {entry.photos.map((p, pi) => (
            <PhotoTile
              key={pi}
              photo={p}
              locked={isFrozenPhoto(pi)}
              onCaption={(c) => setPhotoCaption(pi, c)}
              onEffect={(patch) => setPhotoPatch(pi, patch)}
              onDeco={(d) => setPhotoDeco(pi, d)}
              onRemove={() => removePhoto(pi)}
              onMoveLeft={() => movePhoto(pi, -1)}
              onMoveRight={() => movePhoto(pi, 1)}
              canLeft={pi > 0 && !isFrozenPhoto(pi) && !isFrozenPhoto(pi - 1)}
              canRight={pi < entry.photos.length - 1 && !isFrozenPhoto(pi) && !isFrozenPhoto(pi + 1)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-70"
      >
        {busy ? (
          progress && progress.total > 0 ? (
            /* Barre de progression : les photos apparaissent au fur et à
               mesure dans la journée pendant que la barre se remplit. */
            <div className="w-full">
              <div className="mb-1.5 flex items-center justify-center gap-2">
                <Spinner />
                <span>Ajout des photos… {progress.done}/{progress.total}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-coral-500 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.round((progress.done / progress.total) * 100))}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <Spinner />
              Ajout des photos…
            </>
          )
        ) : mode === 'manuel' ? (
          '📷 Ajouter des photos (sur une nouvelle page)'
        ) : (
          `📷 Ajouter des photos à cette ${unit === 'etape' ? 'étape' : 'journée'}`
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          const target = addTarget.current;
          addTarget.current = null;
          if (files.length) onAddPhotos(files, target);
        }}
      />

      {/* MISE EN PAGE : deux modes, simple et clair. */}
      {total > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Mise en page :</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              <button
                type="button"
                onClick={() => { if (mode !== 'auto') switchToAuto(); }}
                className={`px-3 py-1.5 text-xs font-semibold ${mode === 'auto' ? 'bg-coral-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                🪄 Automatique
              </button>
              <button
                type="button"
                onClick={() => { if (mode !== 'manuel') switchToManual(); }}
                className={`px-3 py-1.5 text-xs font-semibold ${mode === 'manuel' ? 'bg-coral-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                ✋ Je compose
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {mode === 'auto'
              ? `L'appli fait les pages toute seule (${PHOTOS_PER_PAGE} photos max par page). Passe en « ✋ Je compose » pour décider toi-même — ta mise en page actuelle sera conservée telle quelle.`
              : 'Chaque page garde ses photos : rien ne bouge tout seul. Ajoute des photos page par page (bouton « 📷+ » sous chaque page), crée des pages, envoie une photo vers une autre page depuis l\'aperçu.'}
          </p>
        </div>
      )}

      {/* FOND DE PAGE de cette journée */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <button
          type="button"
          onClick={() => setBgOpen((o) => !o)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-700"
        >
          <span>🖼️ Fond de page</span>
          <span className="text-xs text-slate-400">
            {pageCount > 1 ? `${pageCount} pages` : '1 page'} {bgOpen ? '▴' : '▾'}
          </span>
        </button>

        {bgOpen && (
          <div className="mt-3 space-y-3">
            {pageCount > 1 && (
              <div className="flex flex-col gap-1.5 text-xs text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={bg.mode !== 'spread'}
                    onChange={() => setBg({ ...bg, mode: 'perPage' })}
                  />
                  Un fond différent possible pour chaque page
                </label>
                <label className={`flex items-center gap-2 ${lockedAny ? 'opacity-40' : ''}`}>
                  <input
                    type="radio"
                    checked={bg.mode === 'spread'}
                    disabled={lockedAny}
                    onChange={() => setBg({ ...bg, mode: 'spread' })}
                  />
                  Une seule photo étirée sur les {pageCount} pages (panorama)
                  {lockedAny ? ' — indisponible (page verrouillée)' : ''}
                </label>
              </div>
            )}

            {entry.photos.length > 0 && bg.mode !== 'spread' && (
              <button
                type="button"
                onClick={() => {
                  // Les pages verrouillées gardent leur fond actuel.
                  const auto = autoBgFromPhotos(entry.photos, pageCount);
                  auto.pages = auto.pages.map((s, k) => (isLocked(k) ? getPageSpec(k) : s));
                  setBg(auto);
                }}
                className="rounded-lg border border-coral-300 bg-coral-50 px-3 py-1.5 text-xs font-semibold text-coral-700 hover:bg-coral-100"
                title="Met en fond de chaque page une photo du jour, au hasard et toutes différentes (les pages verrouillées gardent leur fond)"
              >
                🎲 Fonds aléatoires (photos du jour)
              </button>
            )}

            {bg.mode === 'spread' && pageCount > 1 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <p className="mb-1.5 text-xs font-semibold text-slate-500">
                  Photo étirée sur les {pageCount} pages
                </p>
                <BgSpecEditor
                  spec={bg.spread || { type: 'photo' }}
                  onChange={(spec) => setBg({ ...bg, spread: spec })}
                  onPickPhoto={() => onPickBgPhoto('spread')}
                />
              </div>
            ) : pageCount === 1 ? (
              isLocked(0) ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs font-medium text-amber-700">🔒 Page verrouillée : déverrouille-la pour changer son fond.</p>
                </div>
              ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <BgSpecEditor
                  spec={getPageSpec(0)}
                  onChange={(spec) => setPageSpec(0, spec)}
                  onPickPhoto={() => onPickBgPhoto(0)}
                />
              </div>
              )
            ) : (
              Array.from({ length: pageCount }).map((_, p) => {
                if (coveredBy[p] >= 0) {
                  return (
                    <div key={p} className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-xs text-slate-500">
                        Page {p + 1} · ↳ côté droit du panorama de la page {coveredBy[p] + 1}
                      </p>
                    </div>
                  );
                }
                if (isLocked(p)) {
                  return (
                    <div key={p} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                      <p className="text-xs font-medium text-amber-700">Page {p + 1} · 🔒 verrouillée — déverrouille-la pour changer son fond.</p>
                    </div>
                  );
                }
                const spec = getPageSpec(p);
                const span = spec?.type === 'photo' ? spec.span || 1 : 1;
                return (
                  <div key={p} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <p className="mb-1.5 text-xs font-semibold text-slate-500">
                      Page {p + 1}{span > 1 ? ` & ${p + 2} (double page)` : ''}
                    </p>
                    <BgSpecEditor
                      spec={spec}
                      onChange={(s) => setPageSpec(p, s)}
                      onPickPhoto={() => onPickBgPhoto(p)}
                    />
                    {spec?.type === 'photo' && (
                      <div className="mt-2 border-t border-slate-100 pt-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Étendre la photo :</span>
                          <button type="button" onClick={() => setPageSpan(p, 1)}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${span === 1 ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                            1 page
                          </button>
                          <button type="button" onClick={() => setPageSpan(p, 2)} disabled={p + 1 >= pageCount || isLocked(p + 1)}
                            title={isLocked(p + 1) ? 'La page suivante est verrouillée : impossible d’étendre dessus.' : undefined}
                            className={`rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-40 ${span === 2 ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                            2 pages (double page)
                          </button>
                        </div>
                        {span === 2 && pageOffset != null && (() => {
                          const leftAbs = pageOffset + p;
                          const facing = leftAbs % 2 === 0; // page 1 = couverture (à droite)
                          return (
                            <p className={`mt-1.5 text-xs ${facing ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {facing
                                ? `✅ Pages ${leftAbs}–${leftAbs + 1} du livre : la photo sera bien en vis‑à‑vis (entière à l'ouverture).`
                                : `⚠️ Pages ${leftAbs}–${leftAbs + 1} du livre : PAS en vis‑à‑vis. Ajoute ou retire une page avant pour décaler d'un cran.`}
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* COMPOSER LES PAGES : déplacer les photos + emojis/stickers/textes */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <span className="text-sm font-medium text-slate-700">✨ Composer / décorer&nbsp;:</span>
        {Array.from({ length: pageCount }).map((_, p) => {
          if (coveredBy[p] >= 0) {
            return (
              <span key={p} className="rounded-lg border border-dashed border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400"
                title="Côté droit d'une double page : non modifiable (c'est la suite de la photo de la page précédente).">
                Page {p + 1} · ↳ verrouillée
              </span>
            );
          }
          if (isLocked(p)) {
            return (
              <button key={p} type="button" onClick={() => toggleLock(p)}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                title="Page verrouillée par toi. Touche pour déverrouiller.">
                {pageCount > 1 ? `Page ${p + 1}` : 'Cette page'} · 🔒
              </button>
            );
          }
          return (
            <button
              key={p}
              type="button"
              onClick={() => setDecoPage(p)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {pageCount > 1 ? `Page ${p + 1}` : 'Cette page'}
              {entry.freePages?.[p] ? ' ✋' : ''}
              {(entry.pageDeco?.[p]?.length || 0) > 0 ? ` (${entry.pageDeco[p].length})` : ''}
            </button>
          );
        })}
      </div>

      {/* APERÇU + ÉDITION DIRECTE : 2 pages, flèches, sélection / glisser */}
      {chunks.some((c) => c.length > 0) && (() => {
        const visible = pageCount <= 1 ? [0] : [viewStart, viewStart + 1].filter((p) => p < pageCount);
        const mp = Math.min(mPage, pageCount - 1); // page affichée seule (mobile), bornée
        // Aperçu interactif d'une page, réutilisé sur mobile (1 page) et ordi (2 pages).
        // Une page verrouillée redevient un simple aperçu (rien ne bouge).
        const renderPreview = (p) => {
          const editable = coveredBy[p] < 0 && !isLocked(p);
          return (
            <PagePreview
              photos={chunks[p]}
              format={format}
              theme={theme}
              title={entry.title}
              note={entry.note}
              firstPage={p === 0}
              dayIndex={index}
              location={day?.location}
              unit={unit}
              bg={entry.bg}
              pageIndex={p}
              pageCount={pageCount}
              deco={entry.pageDeco?.[p]}
              free={entry.freePages?.[p]}
              width="100%"
              interactive={editable}
              selected={sel && sel.p === p ? { kind: sel.kind, i: sel.i } : null}
              onSelect={editable ? (kind, i) => setSel(i == null ? null : { p, kind, i }) : undefined}
              onFreeChange={editable ? (boxes) => setPageFree(p, boxes) : undefined}
              onDecoChange={editable ? (items) => update({ pageDeco: { ...(entry.pageDeco || {}), [p]: items } }) : undefined}
            />
          );
        };
        return (
          <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">👆 Touche une photo / décoration pour la modifier · appuie un instant puis glisse pour la déplacer (au doigt).</p>
            <button type="button" onClick={() => setAddOpen(true)}
              className="rounded-lg border border-coral-300 bg-coral-50 px-3 py-1.5 text-xs font-semibold text-coral-700 hover:bg-coral-100">✨ Ajouter (autocollant, texte…)</button>
          </div>

          {/* MOBILE : une seule page en grand (pleine largeur) + navigation page par page */}
          <div className="mt-1 sm:hidden">
            {pageCount > 1 && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <button type="button" onClick={() => { setSel(null); setMPage(Math.max(0, mp - 1)); }} disabled={mp <= 0}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="Page précédente">◀ Préc.</button>
                <span className="text-xs font-semibold text-slate-600">Page {mp + 1} / {pageCount}</span>
                <button type="button" onClick={() => { setSel(null); setMPage(Math.min(pageCount - 1, mp + 1)); }} disabled={mp >= pageCount - 1}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="Page suivante">Suiv. ▶</button>
              </div>
            )}
            <div>{renderPreview(mp)}</div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <span className="text-[11px] text-slate-400">Page {mp + 1}</span>
              {coveredBy[mp] < 0 && lockBtn(mp)}
              {coveredBy[mp] < 0 && addToPageBtn(mp)}
              {coveredBy[mp] < 0 && gridBtn(mp)}
              {coveredBy[mp] < 0 && deletePageBtn(mp)}
            </div>
          </div>

          {/* ORDINATEUR : double page côte à côte */}
          <div className="mt-1 hidden items-stretch gap-2 sm:flex">
            {pageCount > 2 && (
              <button type="button" onClick={() => { setSel(null); setSpreadStart(Math.max(0, viewStart - 1)); }} disabled={viewStart <= 0}
                className="flex w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="Pages précédentes">◀</button>
            )}
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              {visible.map((p) => (
                <div key={p} className="min-w-0">
                  {renderPreview(p)}
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-[11px] text-slate-400">Page {p + 1}</span>
                    {coveredBy[p] < 0 && lockBtn(p)}
                    {coveredBy[p] < 0 && addToPageBtn(p)}
                    {coveredBy[p] < 0 && gridBtn(p)}
                    {coveredBy[p] < 0 && deletePageBtn(p)}
                  </div>
                </div>
              ))}
              {visible.length === 1 && <div />}
            </div>
            {pageCount > 2 && (
              <button type="button" onClick={() => { setSel(null); setSpreadStart(Math.min(pageCount - 2, viewStart + 1)); }} disabled={viewStart >= pageCount - 2}
                className="flex w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="Pages suivantes">▶</button>
            )}
          </div>

          {mode === 'manuel' && (
            <div className="mt-2 flex justify-center">
              <button type="button" onClick={addEmptyPage}
                className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                title="Crée une page vide à la fin, à remplir avec 📷+ (elle ne s'imprime pas tant qu'elle est vide)">
                ➕ Nouvelle page vide
              </button>
            </div>
          )}

          {/* Outils de l'élément sélectionné */}
          {selObj && (
            <div className="mt-3">
              {sel.kind === 'photo' && (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setCropFor({ gIdx: pageStartIdx(sel.p) + sel.i, hs: selObj.hs || 1 })}
                    className="rounded-lg border border-coral-300 bg-coral-50 px-3 py-1.5 text-xs font-semibold text-coral-700 hover:bg-coral-100">✂️ Recadrer</button>
                  <button type="button" onClick={() => setFxFor(pageStartIdx(sel.p) + sel.i)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">🎨 Effet &amp; cadrage</button>
                  <button type="button" onClick={() => setDecoForPhoto(pageStartIdx(sel.p) + sel.i)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">✨ Décorer la photo</button>
                  <button type="button" onClick={removeSel}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">🗑️ Retirer</button>
                  {mode === 'manuel' && pageCount > 1 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const t = Number(e.target.value);
                        if (Number.isFinite(t) && e.target.value !== '') movePhotoToPage(pageStartIdx(sel.p) + sel.i, t);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
                      title="Envoyer cette photo à la fin d'une autre page"
                    >
                      <option value="">📤 Envoyer vers…</option>
                      {Array.from({ length: pageCount }).map((_, q) =>
                        q !== sel.p && !isLocked(q) ? <option key={q} value={q}>Page {q + 1}</option> : null
                      )}
                    </select>
                  )}
                </div>
              )}
              <DecoItemControls
                item={selObj}
                onChange={patchSel}
                onRemove={removeSel}
                onResetRot={() => patchSel({ rot: 0 })}
                allowRemove={sel.kind !== 'photo'}
              />
            </div>
          )}
          </>
        );
      })()}

      {decoPage != null && (
        <PageDecorateModal
          photos={chunks[decoPage] || []}
          format={format}
          onFormatChange={onFormatChange}
          theme={theme}
          title={entry.title}
          note={entry.note}
          firstPage={decoPage === 0}
          dayIndex={index}
          location={day?.location}
          bg={entry.bg}
          pageIndex={decoPage}
          pageCount={pageCount}
          unit={unit}
          initialItems={entry.pageDeco?.[decoPage] || []}
          onChange={(items, boxes) => {
            const patch = { pageDeco: { ...(entry.pageDeco || {}), [decoPage]: items } };
            if (boxes !== undefined) patch.freePages = { ...(entry.freePages || {}), [decoPage]: boxes };
            update(patch);
          }}
          initialFree={entry.freePages?.[decoPage] || null}
          onChangeFree={(boxes) => setPageFree(decoPage, boxes)}
          onClose={() => setDecoPage(null)}
        />
      )}

      {fxFor != null && entry.photos[fxFor] && (
        <EffectPicker
          photo={entry.photos[fxFor]}
          current={getPhotoEffect(entry.photos[fxFor].effect).id}
          onChange={(patch) => setPhotoPatch(fxFor, patch)}
          onClose={() => setFxFor(null)}
        />
      )}

      {decoForPhoto != null && entry.photos[decoForPhoto] && (
        <DecorateModal
          photo={entry.photos[decoForPhoto]}
          onChange={(d) => setPhotoDeco(decoForPhoto, d)}
          onClose={() => setDecoForPhoto(null)}
        />
      )}

      {addOpen && (
        <AddDecoSheet onAddItem={addDecoItem} onClose={() => setAddOpen(false)} />
      )}

      {addChoice != null && (
        <AddPhotosChoiceSheet
          page={addChoice}
          hasDayPhotos={entry.photos.some((_p, gi) => pageOfIdx(gi) !== addChoice && !isFrozenPhoto(gi))}
          onFiles={() => { addTarget.current = addChoice; setAddChoice(null); fileRef.current?.click(); }}
          onFromDay={() => { setDayPick(addChoice); setAddChoice(null); }}
          onClose={() => setAddChoice(null)}
        />
      )}

      {dayPick != null && (
        <DayPhotoPickerModal
          photos={entry.photos}
          targetPage={dayPick}
          pageOfIdx={pageOfIdx}
          isFrozenPhoto={isFrozenPhoto}
          onConfirm={(gis) => { movePhotosToPage(gis, dayPick); setDayPick(null); }}
          onClose={() => setDayPick(null)}
        />
      )}

      {cropFor != null && entry.photos[cropFor.gIdx] && (
        <CropModal
          photo={entry.photos[cropFor.gIdx]}
          initialHs={cropFor.hs}
          onApply={applyCrop}
          onClose={() => setCropFor(null)}
        />
      )}
    </section>
  );
}

// Fenêtre de choix de la photo de couverture : montre toutes les photos déjà
// présentes dans l'album, regroupées par journée. Un clic choisit la couverture.
export function CoverPicker({ days, album, current, onPick, onClose, title = 'Choisir la photo de couverture', unit = 'jour' }) {
  useBackClose(onClose); // « retour » ferme la fenêtre, comme la croix
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const photo = await uploadAlbumPhoto(file);
      onPick({ ...photo, caption: '' });
    } catch {
      setUploadError(
        "L'envoi de la photo a échoué. Réessaie dans un instant."
      );
    } finally {
      setUploading(false);
    }
  }

  const groups = days
    .map((d, i) => ({
      i,
      location: d?.location || '',
      title: album.days[i]?.title || '',
      photos: album.days[i]?.photos || [],
    }))
    .filter((g) => g.photos.length > 0);

  const samePhoto = (a, b) => a && b && (a.full || a.display) === (b?.full || b?.display);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="mb-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-coral-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-coral-600 disabled:opacity-60"
          >
            {uploading && <Spinner />}
            {uploading ? 'Envoi de la photo…' : '📤 Importer une autre photo'}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">
            Choisis une photo depuis ton appareil : elle sera utilisée ici,
            sans être ajoutée à une journée.
          </p>
          {uploadError && (
            <p className="mt-2 text-center text-xs text-red-600">{uploadError}</p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Tu peux importer une photo ci-dessus, ou ajouter des photos à tes
            journées puis revenir en choisir une ici.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs font-medium text-slate-500">
              …ou choisis une photo déjà présente dans ton album :
            </p>
            <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.i}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-coral-600">
                  {unitLabel(unit)} {g.i + 1}{g.location ? ` · ${g.location}` : ''}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.photos.map((p, k) => {
                    const on = samePhoto(p, current);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onPick(p)}
                        className={`relative aspect-[4/3] overflow-hidden rounded-lg border-2 ${
                          on ? 'border-coral-500 ring-2 ring-coral-200' : 'border-transparent'
                        }`}
                      >
                        <img src={p.display || p.full} alt="" className="h-full w-full object-cover" />
                        {on && (
                          <span className="absolute right-1 top-1 rounded-full bg-coral-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [album, setAlbum] = useState(null); // { title, days: { [i]: entry } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Envois de photos EN PARALLÈLE : un suivi par jour { [i]: { done, total } }.
  const [uploads, setUploads] = useState({});
  const setDayUpload = (i, prog) =>
    setUploads((prev) => {
      const next = { ...prev };
      if (prog) next[i] = prog; else delete next[i];
      return next;
    });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  // Export imprimable
  const [format, setFormat] = useState('carre');
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [sharingAll, setSharingAll] = useState(false);
  const [sharingAllPdf, setSharingAllPdf] = useState(false);
  const [albumShareData, setAlbumShareData] = useState(null); // { files, text } prêts

  // Sélecteur de photo : 'cover' (couverture), 'end' (page de fin) ou null.
  const [pickerFor, setPickerFor] = useState(null);

  // Réparation des photos (orientation)
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState(null);

  useEffect(() => {
    let active = true;
    getItinerary(id).then(({ data, error: e }) => {
      if (!active) return;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      const it = data?.itinerary || {};
      const itDays = Array.isArray(it.days) ? it.days : [];
      const saved = it.travel_album || null;

      // Migration de l'ancien format (bg = une photo) vers le nouveau modèle.
      const migrateBg = (bg) =>
        bg && bg.full
          ? { mode: 'perPage', spread: { type: 'none' }, pages: [{ type: 'photo', photo: bg, toned: true }] }
          : (bg ?? null);

      // Les sections de l'album sont une LISTE (comme l'album créé de zéro), ce
      // qui permet de fusionner / déplacer / supprimer / ajouter des sections.
      // - si déjà enregistré en liste → on l'utilise tel quel ;
      // - sinon → une section par journée du programme (titre + lieu repris).
      let daysArr;
      if (Array.isArray(saved?.days)) {
        daysArr = saved.days.map((s) => ({
          location: s.location || '',
          title: s.title || '',
          note: s.note || '',
          photos: Array.isArray(s.photos) ? s.photos : [],
          bg: migrateBg(s.bg),
          split: Array.isArray(s.split) ? s.split : null,
          pageDeco: s.pageDeco || {},
          freePages: s.freePages || {},
          lockedPages: s.lockedPages || {},
          ...(s.layoutMode ? { layoutMode: s.layoutMode } : {}),
        }));
      } else {
        daysArr = itDays.map((d, i) => {
          const s = saved?.days?.[i];
          return {
            location: d.location || '',
            title: s?.title ?? (d.day_title || d.location || `Jour ${i + 1}`),
            note: s?.note ?? '',
            photos: Array.isArray(s?.photos) ? s.photos : [],
            bg: migrateBg(s?.bg ?? null),
            split: Array.isArray(s?.split) ? s.split : null,
            pageDeco: s?.pageDeco || {},
            freePages: s?.freePages || {},
            lockedPages: s?.lockedPages || {},
            ...(s?.layoutMode ? { layoutMode: s.layoutMode } : {}),
          };
        });
      }

      setTrip(data);
      setAlbum({
        title: saved?.title ?? (it.summary?.title || data.title || 'Mon album'),
        cover: saved?.cover ?? null,
        endNote: saved?.endNote ?? '',
        endPhoto: saved?.endPhoto ?? null,
        theme: saved?.theme ?? 'classique',
        unit: saved?.unit ?? 'jour',
        coverLayout: saved?.coverLayout ?? {},
        endLayout: saved?.endLayout ?? {},
        coverSpread: saved?.coverSpread ?? {},
        opening: saved?.opening ?? { type: 'blank' },
        days: daysArr,
      });
      if (saved?.format) setFormat(saved.format);
      setSavedOnce(!!saved);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  function setDayEntry(i, entry) {
    setAlbum((prev) => {
      const days = [...prev.days];
      days[i] = entry;
      return { ...prev, days };
    });
    setDirty(true);
  }

  const emptySection = () => ({ location: '', title: '', note: '', photos: [], bg: null, split: null, pageDeco: {}, freePages: {}, lockedPages: {} });
  const addDay = () =>
    setAlbum((prev) => {
      setDirty(true);
      return { ...prev, days: [...prev.days, emptySection()] };
    });
  // Insère une section VIDE entre deux sections existantes (à l'index i).
  const insertDayAt = (i) => {
    if (Object.keys(uploads).length) { alert('Attends la fin des envois de photos avant de réorganiser les jours.'); return; }
    setAlbum((prev) => {
      setDirty(true);
      const days = [...prev.days];
      days.splice(i, 0, emptySection());
      return { ...prev, days };
    });
  };
  // Suppression d'une section : filet de rattrapage « Annuler » (en plus de la
  // confirmation du bouton).
  const [dayTrash, setDayTrash] = useState(null); // { day, index }
  useEffect(() => {
    if (!dayTrash) return undefined;
    const t = setTimeout(() => setDayTrash(null), 15000);
    return () => clearTimeout(t);
  }, [dayTrash]);
  const removeDay = (i) => {
    if (Object.keys(uploads).length) { alert('Attends la fin des envois de photos avant de réorganiser les jours.'); return; }
    setAlbum((prev) => {
      setDirty(true);
      setDayTrash({ day: prev.days[i], index: i });
      return { ...prev, days: prev.days.filter((_, k) => k !== i) };
    });
  };
  const undoRemoveDay = () => {
    if (!dayTrash) return;
    setAlbum((prev) => {
      const days = [...prev.days];
      days.splice(Math.min(dayTrash.index, days.length), 0, dayTrash.day);
      return { ...prev, days };
    });
    setDirty(true);
    setDayTrash(null);
  };
  const moveDay = (i, dir) => {
    if (Object.keys(uploads).length) { alert('Attends la fin des envois de photos avant de réorganiser les jours.'); return; }
    setAlbum((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.days.length) return prev;
      const days = [...prev.days];
      [days[i], days[j]] = [days[j], days[i]];
      setDirty(true);
      return { ...prev, days };
    });
  };
  const mergeDayUp = (i) => {
    if (Object.keys(uploads).length) { alert('Attends la fin des envois de photos avant de réorganiser les jours.'); return; }
    setAlbum((prev) => {
      if (i <= 0) return prev;
      const a = prev.days[i - 1];
      const b = prev.days[i];
      const note = [a.note, b.title, b.note].map((s) => (s || '').trim()).filter(Boolean).join('\n');
      const merged = { ...a, photos: [...(a.photos || []), ...(b.photos || [])], note, split: null, pageDeco: {}, freePages: {}, lockedPages: {} };
      const days = prev.days.filter((_, k) => k !== i);
      days[i - 1] = merged;
      setDirty(true);
      return { ...prev, days };
    });
  };

  async function addPhotos(i, files, targetPage = null) {
    if (uploads[i]) return; // un envoi est déjà en cours sur CE jour
    setDayUpload(i, { done: 0, total: files.length });
    setError(null);
    // En manuel sans page cible : toutes les photos de CE lot vont sur la même
    // NOUVELLE page (index figé avant l'envoi).
    const entry0 = album.days[i];
    const bgWasEmpty = bgIsEmpty(entry0.bg);
    const fixedTarget = typeof targetPage === 'number'
      ? targetPage
      : (isManualLayout(entry0) ? repairSplit(entry0.split, (entry0.photos || []).length).length : null);
    let done = 0;
    try {
      for (const f of files) {
        let up;
        try {
          up = await uploadAlbumPhoto(f);
        } catch (err) {
          throw new Error(
            "L'envoi d'une photo a échoué. Les photos déjà ajoutées sont conservées — relance l'ajout avec les photos restantes.",
            { cause: err }
          );
        }
        // La photo apparaît IMMÉDIATEMENT dans la journée : si la connexion
        // coupe en route, tout ce qui est déjà envoyé est conservé.
        setAlbum((prev) => {
          const days = [...prev.days];
          const entry = days[i];
          const placed = addPhotosToEntry(entry, [{ ...up, caption: '' }], fixedTarget);
          days[i] = { ...entry, ...placed };
          return { ...prev, days };
        });
        setDirty(true);
        done += 1;
        setDayUpload(i, { done, total: files.length });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      // Fonds automatiques (si aucun fond n'était choisi) appliqués UNE fois à
      // la fin, sur toutes les pages. Les pages verrouillées sont épargnées.
      if (bgWasEmpty && done > 0) {
        setAlbum((prev) => {
          const days = [...prev.days];
          const entry = days[i];
          const pages = computeSplit(entry.photos.length, entry.split).length;
          const auto = autoBgFromPhotos(entry.photos, pages);
          const lp = entry.lockedPages || {};
          const cur = normalizeBg(entry.bg);
          auto.pages = auto.pages.map((s, k) => (lp[k] ? (cur.pages?.[k] || { type: 'none' }) : s));
          days[i] = { ...entry, bg: auto };
          return { ...prev, days };
        });
      }
      setDayUpload(i, null);
    }
  }

  async function save() {
    if (!trip) return;
    setSaving(true);
    setError(null);
    try {
      const next = {
        ...trip.itinerary,
        travel_album: {
          title: album.title,
          cover: album.cover || null,
          endNote: album.endNote || '',
          endPhoto: album.endPhoto || null,
          theme: album.theme || 'classique',
          unit: album.unit || 'jour',
          format,
          coverLayout: album.coverLayout || {},
          endLayout: album.endLayout || {},
          coverSpread: album.coverSpread || {},
          opening: album.opening || { type: 'blank' },
          days: album.days,
          updatedAt: new Date().toISOString(),
        },
      };
      const { data, error: e } = await updateItinerary(id, { itinerary: next });
      if (e) throw e;
      setTrip(data);
      setDirty(false);
      setSavedOnce(true);
    } catch (e) {
      setError(e.message || "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const photoCount = album
    ? (album.days || []).reduce((n, e) => n + (e.photos?.length || 0), 0)
    : 0;

  // Répare toutes les photos déjà ajoutées : remet à l'endroit celles qui sont
  // couchées, puis enregistre. Les photos déjà correctes ne sont pas touchées.
  async function repairPhotos() {
    if (!trip || !album) return;
    setRepairing(true);
    setError(null);
    setRepairMsg('Vérification des photos…');
    try {
      const total = photoCount + (album.cover ? 1 : 0) + (album.endPhoto ? 1 : 0);
      let done = 0;
      const tick = () => {
        done += 1;
        setRepairMsg(`Réparation des photos… ${done}/${total}`);
      };

      const newDays = [];
      for (const entry of album.days) {
        const photos = [];
        for (const p of entry.photos || []) {
          photos.push(await repairAlbumPhoto(p));
          tick();
        }
        // Réparation des photos de fond (panorama étiré + chaque page).
        let bg = entry.bg;
        if (bg) {
          bg = { ...bg };
          if (bg.spread?.photo) {
            bg.spread = { ...bg.spread, photo: await repairAlbumPhoto(bg.spread.photo) };
          }
          if (Array.isArray(bg.pages)) {
            bg.pages = [];
            for (const sp of entry.bg.pages) {
              bg.pages.push(sp?.photo ? { ...sp, photo: await repairAlbumPhoto(sp.photo) } : sp);
            }
          }
        }
        newDays.push({ ...entry, photos, bg });
      }
      let cover = album.cover;
      if (cover) {
        cover = await repairAlbumPhoto(cover);
        tick();
      }
      let endPhoto = album.endPhoto;
      if (endPhoto) {
        endPhoto = await repairAlbumPhoto(endPhoto);
        tick();
      }

      const nextAlbum = { ...album, days: newDays, cover, endPhoto };
      setAlbum(nextAlbum);

      const next = {
        ...trip.itinerary,
        travel_album: {
          title: nextAlbum.title,
          cover: nextAlbum.cover || null,
          endNote: nextAlbum.endNote || '',
          endPhoto: nextAlbum.endPhoto || null,
          theme: nextAlbum.theme || 'classique',
          unit: nextAlbum.unit || 'jour',
          format,
          coverLayout: nextAlbum.coverLayout || {},
          endLayout: nextAlbum.endLayout || {},
          coverSpread: nextAlbum.coverSpread || {},
          opening: nextAlbum.opening || { type: 'blank' },
          days: nextAlbum.days,
          updatedAt: new Date().toISOString(),
        },
      };
      const { data, error: e } = await updateItinerary(id, { itinerary: next });
      if (e) throw e;
      setTrip(data);
      setDirty(false);
      setSavedOnce(true);
      setRepairMsg('✓ Photos vérifiées et remises à l’endroit.');
      // On invalide l'aperçu PDF éventuel pour qu'il soit refait proprement.
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
        setPdfBlob(null);
      }
    } catch (e) {
      setRepairMsg(null);
      setError(e.message || 'La réparation a échoué. Réessaie dans un instant.');
    } finally {
      setRepairing(false);
    }
  }

  // Fabrique le PDF complet de l'album (couverture, carte, journées, fin) et
  // renvoie le fichier. Réutilisé par l'aperçu/téléchargement ET le partage.
  async function buildAlbumBlob() {
    // Carte du voyage : on assemble une image du parcours à partir des
    // coordonnées des étapes (mêmes fonds de carte que l'app).
    let routeMap = null;
    const stops = [];
    const points = [];
    const tripDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
    tripDays.forEach((d) => {
      const c = d?.coordinates;
      if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
        points.push(c);
        stops.push(d.location || '');
      }
    });
    if (points.length) {
      // La carte épouse l'orientation du format choisi (sinon une carte
      // paysage tranche dans un album portrait).
      const mapDims =
        format === 'a4paysage'
          ? { width: 1600, height: 1000 }
          : format === 'a4portrait'
            ? { width: 1100, height: 1500 }
            : { width: 1400, height: 1320 };
      try {
        routeMap = await renderRouteMapImage(points, {
          ...mapDims,
          accent: '#C8643C',
        });
      } catch {
        routeMap = null;
      }
    }

    // « Cuisson » des filtres couleur dans les photos (les cadres, eux, sont
    // dessinés dans le PDF).
    const bakedDays = [];
    for (const e of album.days) {
      bakedDays.push({ ...e, photos: await bakePhotoEffects(e.photos) });
    }
    const albumForPdf = { ...album, days: bakedDays };

    // Page d'ouverture « au hasard » : on choisit une photo au moment de
    // fabriquer le fichier.
    let openingForPdf = album.opening || { type: 'blank' };
    if (openingForPdf.type === 'random') {
      const all = album.days.flatMap((d) => d.photos || []).filter((p) => p.full || p.display);
      openingForPdf = { ...openingForPdf, photo: all.length ? all[Math.floor(Math.random() * all.length)] : null };
    }

    return pdf(
      <AlbumPdfDoc
        album={albumForPdf}
        days={album.days.map((s) => ({ location: s.location || '' }))}
        format={format}
        summary={trip?.itinerary?.summary || null}
        routeMap={routeMap}
        stops={stops}
        unit={album.unit}
        coverLayout={album.coverLayout}
        endLayout={album.endLayout}
        coverSpread={album.coverSpread}
        opening={openingForPdf}
        endNote={album.endNote}
        endPhoto={album.endPhoto}
        theme={getTheme(album.theme)}
      />
    ).toBlob();
  }

  async function generatePdf() {
    if (!album) return;
    setGenerating(true);
    setError(null);
    try {
      const blob = await buildAlbumBlob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setPdfBlob(blob);
    } catch (e) {
      setError(
        (e.message || 'Erreur pendant la création du fichier.') +
          ' — Réessaie, et vérifie que tes photos se sont bien chargées.'
      );
    } finally {
      setGenerating(false);
    }
  }

  const fileName = `album-${(album?.title || 'voyage')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()}-${format}.pdf`;

  const albumHasContent = () =>
    (album?.days || []).some((e) => (e.photos?.length || 0) > 0 || (e.note || '').trim());
  const albumSlug = () =>
    (album?.title || 'album').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'album';

  // NB : ces fonctions PRÉPARENT seulement les fichiers (fabrication longue) et
  // renvoient { files, text }. Le partage lui-même (navigator.share) doit être
  // déclenché par un nouveau clic (ShareSheet), sinon le navigateur mobile
  // refuse d'ouvrir WhatsApp (l'« autorisation » du 1er clic a expiré pendant
  // la fabrication) et se rabat sur un simple téléchargement.

  // Prépare le partage d'UNE journée en images (une par page).
  async function shareDay(dayIndex) {
    if (!album) return null;
    const entry = album.days[dayIndex];
    if (!entry || !(entry.photos?.length || (entry.note || '').trim())) {
      alert('Ajoute au moins une photo (ou un texte) à cette journée avant de la partager.');
      return null;
    }
    const bakedPhotos = await bakePhotoEffects(entry.photos || []);
    const albumForPdf = {
      ...album,
      days: album.days.map((d, i) => (i === dayIndex ? { ...entry, photos: bakedPhotos } : d)),
    };
    const blob = await pdf(
      <AlbumPdfDoc
        album={albumForPdf}
        days={album.days.map((s) => ({ location: s.location || '' }))}
        format={format}
        unit={album.unit}
        theme={getTheme(album.theme)}
        onlyDay={dayIndex}
      />
    ).toBlob();
    const label = album.unit === 'etape' ? 'etape' : 'jour';
    const files = await pdfBlobToImageFiles(blob, { baseName: `${label}-${dayIndex + 1}` });
    const unitLbl = album.unit === 'etape' ? 'Étape' : 'Jour';
    const where = entry.location ? ` · ${entry.location}` : '';
    return { files, text: `${unitLbl} ${dayIndex + 1}${where} — ${album.title || 'Mon voyage'}` };
  }

  // Prépare le partage de TOUT l'album en images (une par page).
  async function shareAlbum() {
    if (!album) return null;
    if (!albumHasContent()) {
      alert('Ajoute au moins une photo à ton album avant de le partager.');
      return null;
    }
    const blob = await buildAlbumBlob();
    const files = await pdfBlobToImageFiles(blob, { baseName: albumSlug(), targetWidth: 1240 });
    return { files, text: `${album.title || 'Mon voyage'} — album TravelO` };
  }

  // Prépare le partage de TOUT l'album en UN SEUL fichier PDF.
  async function shareAlbumPdf() {
    if (!album) return null;
    if (!albumHasContent()) {
      alert('Ajoute au moins une photo à ton album avant de le partager.');
      return null;
    }
    const blob = await buildAlbumBlob();
    const file = new File([blob], `${albumSlug()}-${format}.pdf`, { type: 'application/pdf' });
    return { files: [file], text: `${album.title || 'Mon voyage'} — album TravelO` };
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-500">
        Ouverture de l'album…
      </div>
    );
  }
  if (error && !album) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-slate-600">Impossible d'ouvrir cet album.</p>
        <Link to="/mes-voyages" className="mt-3 inline-block text-brand-700 underline">
          ← Retour à mes voyages
        </Link>
      </div>
    );
  }

  // Sections de l'album (liste éditable) + vue allégée {location} pour les
  // composants qui n'ont besoin que du lieu (sélecteur de photo, etc.).
  const sections = album?.days || [];
  const days = sections.map((s) => ({ location: s.location || '' }));
  // Numéro de page réel (1 = couverture) de la 1re page de chaque section, pour
  // indiquer si une double page tombe bien en vis‑à‑vis. La carte du voyage
  // occupe une page si des coordonnées existent.
  const hasMapPage = (Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [])
    .some((d) => d?.coordinates && typeof d.coordinates.lat === 'number');
  const sectionPageCounts = sections.map((s) => splitPhotos(s.photos, s.split).filter((c) => c.length > 0).length);
  // Avant les sections : 1re de couv + 2e de couv (blanche) + page d'ouverture
  // (carte OU page blanche/photo) = 3 pages.
  const BEFORE = 3;
  const dayOffsets = sectionPageCounts.map(
    (_, i) => BEFORE + sectionPageCounts.slice(0, i).reduce((a, b) => a + b, 0) + 1
  );
  // Total = 3 (avant) + pages des sections + 3e de couv (blanche) + 4e de couv.
  const totalPages = BEFORE + sectionPageCounts.reduce((a, b) => a + b, 0) + 2;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link to={`/itineraire/${id}`} className="text-sm text-brand-700 underline">
          ← Retour au voyage
        </Link>
        <button
          onClick={save}
          disabled={saving || (!dirty && savedOnce)}
          className="rounded-lg bg-coral-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? 'Enregistrement…'
            : dirty || !savedOnce
              ? '💾 Enregistrer'
              : '✓ Enregistré'}
        </button>
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-coral-600">
        Album de voyage
      </div>
      <input
        value={album.title}
        onChange={(e) => {
          setAlbum((prev) => ({ ...prev, title: e.target.value }));
          setDirty(true);
        }}
        placeholder="Titre de l'album"
        className="w-full border-0 border-b-2 border-slate-200 pb-2 text-2xl font-bold tracking-tight text-slate-900 outline-none focus:border-coral-400 sm:text-3xl"
      />

      <div className="mt-4">
        <FormatPicker value={format} onChange={(f) => { setFormat(f); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfBlob(null); } }} />
      </div>

      <ThemePicker
        value={album.theme || 'classique'}
        onChange={(t) => { setAlbum((prev) => ({ ...prev, theme: t })); setDirty(true); }}
      />

      {/* Unité des sections : journées ou étapes */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Organiser par&nbsp;:</span>
        {[['jour', 'Jours'], ['etape', 'Étapes']].map(([k, lbl]) => (
          <button key={k} type="button"
            onClick={() => { setAlbum((prev) => ({ ...prev, unit: k })); setDirty(true); }}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${(album.unit || 'jour') === k ? 'bg-coral-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {lbl}
          </button>
        ))}
        <span className="text-xs text-slate-500">Regroupe plusieurs journées d'une même étape avec « Fusionner ».</span>
      </div>

      {/* Couvertures (1re + 4e côte à côte) + page d'ouverture */}
      <CoversSection
        album={album}
        format={format}
        theme={getTheme(album.theme)}
        dates={formatDateRange(trip?.itinerary?.summary?.start_date, trip?.itinerary?.summary?.end_date)}
        hasMap={hasMapPage}
        onPatch={(patch) => { setAlbum((prev) => ({ ...prev, ...patch })); setDirty(true); }}
        onPick={(target) => setPickerFor({ kind: target })}
      />

      <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Remplis ton album au fil du voyage : ajoute tes photos du jour, écris un
        petit mot et une légende sous chaque photo. Pense à appuyer sur «
        Enregistrer » de temps en temps — tu pourras revenir continuer plus tard.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {photoCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <button
            type="button"
            onClick={repairPhotos}
            disabled={repairing}
            className="rounded-lg border border-amber-500 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {repairing ? 'Réparation…' : '🛠️ Réparer l’orientation des photos'}
          </button>
          <span className="text-xs text-amber-700">
            {repairMsg ||
              'À utiliser si des photos déjà ajoutées apparaissent couchées : elles seront remises à l’endroit.'}
          </span>
        </div>
      )}

      <div className="mt-5 space-y-5">
        {sections.map((d, i) => {
          const w = unitLabel(album.unit).toLowerCase();
          const prevW = w === 'étape' ? "l'étape" : 'le jour';
          return (
            <div key={i}>
              {/* Insérer une section ENTRE deux sections (avant celle-ci). */}
              <div className="-my-1 mb-1 flex justify-center">
                <button type="button" onClick={() => insertDayAt(i)}
                  className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-400 hover:border-coral-300 hover:text-coral-600"
                  title="Ajouter une section vide juste ici (les suivantes sont renumérotées)">
                  ➕ Insérer {w === 'étape' ? 'une étape' : 'un jour'} ici
                </button>
              </div>
              <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => moveDay(i, -1)} disabled={i === 0}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Monter">↑</button>
                <button type="button" onClick={() => moveDay(i, 1)} disabled={i === sections.length - 1}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 disabled:opacity-30" title="Descendre">↓</button>
                <button type="button" disabled={i === 0}
                  onClick={() => { if (window.confirm(`Fusionner cette ${w} avec ${prevW} ${i} ? Toutes les photos seront regroupées.`)) mergeDayUp(i); }}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                  title="Regrouper les photos de cette section avec la précédente">
                  ⤵ Fusionner avec {prevW} précédent{w === 'étape' ? 'e' : ''}
                </button>
                <button type="button"
                  onClick={() => { if (window.confirm('Supprimer cette section ? Ses photos seront retirées de l’album.')) removeDay(i); }}
                  className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50">
                  Supprimer
                </button>
              </div>
              <DayCard
                day={d}
                index={i}
                entry={album.days[i]}
                onChange={(entry) => setDayEntry(i, entry)}
                onAddPhotos={(files, target) => addPhotos(i, files, target)}
                progress={uploads[i] || null}
                onPickBgPhoto={(slot) => setPickerFor({ kind: 'dayBg', i, slot })}
                busy={!!uploads[i]}
                format={format}
                onFormatChange={setFormat}
                theme={getTheme(album.theme)}
                unit={album.unit}
                pageOffset={dayOffsets[i]}
                onShareDay={() => shareDay(i)}
              />
            </div>
          );
        })}
      </div>

      <button type="button" onClick={addDay}
        className="mt-4 w-full rounded-xl border-2 border-dashed border-coral-300 bg-coral-50 px-3 py-3 text-sm font-semibold text-coral-700 hover:bg-coral-100">
        ➕ Ajouter {(album.unit || 'jour') === 'etape' ? 'une étape' : 'un jour'} / une page
      </button>

      {sections.length === 0 && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Ce voyage n'a pas encore de {(album.unit || 'jour') === 'etape' ? 'étapes' : 'journées'} à illustrer. Utilise « Ajouter » ci-dessus.
        </p>
      )}


      {/* EXPORT IMPRIMABLE */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Préparer l'album pour l'impression
          </h2>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            mise en page v12
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-700">
          📖 {totalPages} pages au total (couverture, carte éventuelle et page de fin comprises).
        </p>
        <p className="mt-1 text-sm text-slate-600">
          On fabrique un fichier PDF prêt à envoyer à un imprimeur. Les photos
          sont utilisées en pleine qualité, et un petit débord est ajouté autour
          des pages pour la découpe.
        </p>

        <p className="mt-2 text-xs text-slate-500">Format : <span className="font-semibold text-slate-700">{FORMAT_LABELS[format]}</span> (modifiable tout en haut de la page).</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={generatePdf}
            disabled={generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating && <Spinner />}
            {generating
              ? 'Création du fichier…'
              : pdfUrl
                ? '🔄 Refaire le fichier'
                : '📄 Créer le fichier à imprimer'}
          </button>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download={fileName}
              className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm"
            >
              ⬇️ Télécharger
            </a>
          )}
          <button
            onClick={async () => {
              if (sharingAll) return;
              setSharingAll(true);
              try {
                const result = await shareAlbum();
                if (result && result.files?.length) setAlbumShareData(result);
              } catch (e) {
                setError((e?.message || 'Le partage a échoué.') + ' Réessaie dans un instant.');
              } finally {
                setSharingAll(false);
              }
            }}
            disabled={sharingAll || generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Partager tout l'album en images (WhatsApp, Messages…)"
          >
            {sharingAll ? <Spinner /> : <span>📲</span>}
            {sharingAll ? 'Préparation…' : "Partager en images"}
          </button>
          <button
            onClick={async () => {
              if (sharingAllPdf) return;
              setSharingAllPdf(true);
              try {
                const result = await shareAlbumPdf();
                if (result && result.files?.length) setAlbumShareData(result);
              } catch (e) {
                setError((e?.message || 'Le partage a échoué.') + ' Réessaie dans un instant.');
              } finally {
                setSharingAllPdf(false);
              }
            }}
            disabled={sharingAllPdf || generating || photoCount === 0}
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Partager tout l'album en un seul fichier PDF (WhatsApp, Mail…)"
          >
            {sharingAllPdf ? <Spinner /> : <span>📄</span>}
            {sharingAllPdf ? 'Préparation…' : 'Partager en 1 PDF'}
          </button>
          {photoCount === 0 && (
            <span className="text-xs text-slate-500">
              Ajoute au moins une photo pour créer le fichier.
            </span>
          )}
        </div>

        {pdfBlob && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-slate-500">Aperçu (fais défiler) — c'est exactement ce qui sera imprimé.</p>
            <div className="max-h-[75vh] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3">
              <PdfPagesPreview blob={pdfBlob} />
            </div>
          </div>
        )}
      </section>

      {albumShareData && (
        <ShareSheet files={albumShareData.files} text={albumShareData.text} onClose={() => setAlbumShareData(null)} />
      )}

      {/* Filet de sécurité : annuler la dernière suppression de section */}
      {dayTrash && (
        <div className="fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl">
            <span>Section supprimée.</span>
            <button type="button" onClick={undoRemoveDay} className="font-bold text-coral-300 underline">↩︎ Annuler</button>
            <button type="button" onClick={() => setDayTrash(null)} className="text-white/60 hover:text-white">✕</button>
          </div>
        </div>
      )}

      {pickerFor && (() => {
        const kind = pickerFor.kind;
        let title = 'Choisir la photo de couverture';
        let current = album.cover;
        if (kind === 'end') {
          title = 'Choisir la photo de la 4e de couverture';
          current = album.endPhoto;
        } else if (kind === 'spread') {
          title = 'Photo étendue sur les deux couvertures';
          current = album.coverSpread?.photo;
        } else if (kind === 'opening') {
          title = "Photo de la page d'ouverture";
          current = album.opening?.photo;
        } else if (kind === 'dayBg') {
          const bg = normalizeBg(album.days[pickerFor.i]?.bg);
          title = `Fond · ${unitLabel(album.unit)} ${pickerFor.i + 1}`;
          current =
            pickerFor.slot === 'spread'
              ? bg.spread?.photo
              : bg.pages?.[pickerFor.slot]?.photo;
        }
        return (
          <CoverPicker
            title={title}
            unit={album.unit}
            days={days}
            album={album}
            current={current}
            onPick={(photo) => {
              if (kind === 'dayBg') {
                const { i, slot } = pickerFor;
                setAlbum((prev) => {
                  const daysArr = [...prev.days];
                  const entry = daysArr[i];
                  const bg = normalizeBg(entry.bg);
                  if (slot === 'spread') {
                    bg.spread = { type: 'photo', photo, toned: bg.spread?.toned !== false };
                  } else {
                    const pages = [...(bg.pages || [])];
                    while (pages.length <= slot) pages.push({ type: 'none' });
                    pages[slot] = { type: 'photo', photo, toned: pages[slot]?.toned !== false };
                    bg.pages = pages;
                  }
                  daysArr[i] = { ...entry, bg: { ...bg } };
                  return { ...prev, days: daysArr };
                });
              } else if (kind === 'spread') {
                setAlbum((prev) => ({ ...prev, coverSpread: { ...(prev.coverSpread || {}), photo } }));
              } else if (kind === 'opening') {
                setAlbum((prev) => ({ ...prev, opening: { ...(prev.opening || { type: 'photo' }), photo } }));
              } else {
                const field = kind === 'end' ? 'endPhoto' : 'cover';
                setAlbum((prev) => ({ ...prev, [field]: photo }));
              }
              setDirty(true);
              setPickerFor(null);
            }}
            onClose={() => setPickerFor(null)}
          />
        );
      })()}
    </div>
  );
}
