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
import AlbumPdfDoc from '../components/AlbumPdfDoc';
import PdfPagesPreview from '../components/PdfPagesPreview';
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
  resolveBg,
  unitLabel,
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

function effectPreview(effect, radiusPx = 10) {
  // Aperçu (HTML) du filtre + cadre dans l'éditeur et le sélecteur.
  const imgStyle = {};
  const wrap = {};
  if (effect.css) imgStyle.filter = effect.css;
  switch (effect.frame) {
    case 'border': Object.assign(wrap, { padding: '5%', background: '#fff' }); break;
    case 'postcard': Object.assign(wrap, { padding: '5%', background: '#fff', border: '1px solid #e2ddd0' }); break;
    case 'polaroid': Object.assign(wrap, { padding: '5% 5% 16% 5%', background: '#fff' }); break;
    case 'rounded': imgStyle.borderRadius = radiusPx; break;
    case 'thin': imgStyle.border = '2px solid #111'; break;
    case 'wood': Object.assign(wrap, { padding: '6%', background: 'linear-gradient(135deg,#a06a33,#6e4423)' }); break;
    case 'gold': Object.assign(wrap, { padding: '5%', background: 'linear-gradient(135deg,#e7c66a,#b8901f)' }); break;
    case 'stamp': Object.assign(wrap, { padding: '7%', background: '#fff', border: '2px dashed #b9b2a3' }); break;
    case 'film': Object.assign(wrap, { padding: '12% 5%', background: '#141414' }); break;
    case 'parchment': Object.assign(wrap, { padding: '6%', background: '#efe2c4', border: '1px solid #cdbd97' }); break;
    default: break;
  }
  return { imgStyle, wrapStyle: wrap };
}

// Fenêtre de choix d'effet : montre LA photo avec chaque effet appliqué.
export function EffectPicker({ photo, current, onPick, onClose }) {
  const src = photo.display || photo.full;
  const groups = [
    ['Filtres de couleur', PHOTO_EFFECTS.filter((e) => e.cat === 'filtre')],
    ['Cadres', PHOTO_EFFECTS.filter((e) => e.cat === 'cadre')],
  ];
  const Tile = ({ e }) => {
    const { imgStyle, wrapStyle } = effectPreview(e, 8);
    return (
      <button
        type="button"
        onClick={() => { onPick(e.id); onClose(); }}
        className={`overflow-hidden rounded-xl border-2 ${current === e.id ? 'border-coral-500' : 'border-transparent'}`}
      >
        <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-slate-100" style={wrapStyle}>
          <img src={src} alt="" className="h-full w-full object-cover" style={imgStyle} />
        </div>
        <div className="truncate px-1 py-1 text-center text-[11px] font-medium text-slate-700">{e.label}</div>
      </button>
    );
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Effet de la photo</h3>
          <button onClick={onClose} className="-m-2 p-2 text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          <div>
            <button
              type="button"
              onClick={() => { onPick('none'); onClose(); }}
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
      </div>
    </div>
  );
}

// Éditeur de décorations réutilisable : un canevas (avec un fond fourni) sur
// lequel on pose des emojis/stickers/textes, déplaçables (glisser),
// redimensionnables et pivotables. Coordonnées en fractions du canevas.
// Affiche un élément de décoration (emoji, texte ou image). `sizeUnit` est
// l'unité de taille (cqmin dans un conteneur dimensionné).
function DecoItemView({ it }) {
  if (it.type === 'image') {
    return <img src={it.value} alt="" draggable={false} style={{ width: `${it.scale * 100}cqmin`, height: 'auto', display: 'block' }} />;
  }
  return (
    <span style={{ fontSize: `${it.scale * 100}cqmin`, lineHeight: 1, color: it.color, fontWeight: it.type === 'text' ? 700 : 400, whiteSpace: 'nowrap', textShadow: it.type === 'text' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}>
      {it.value}
    </span>
  );
}

// Rendu d'un objet du canevas : une PHOTO (avec son effet, son cadre, sa
// légende et ses décos) ou une décoration (emoji/texte/image).
function ObjView({ it }) {
  if (it.kind === 'photo') {
    const p = it.photo;
    const { imgStyle, wrapStyle } = effectPreview(getPhotoEffect(p.effect));
    const pdeco = p.deco || [];
    return (
      <div className="relative overflow-hidden" style={{ width: `${it.scale * 100}cqmin`, aspectRatio: String(it.ar || 4 / 3), containerType: 'size' }}>
        <div className="flex h-full w-full items-center justify-center overflow-hidden" style={wrapStyle}>
          <img src={p.display || p.full} alt="" className="h-full w-full object-cover" style={imgStyle} draggable={false} />
        </div>
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

export function DecoEditor({ title, aspect, background, initialItems, onChange, onClose, toolbar = null }) {
  const [items, setItems] = useState(() => (initialItems || []).map((d) => ({ ...d })));
  const [sel, setSel] = useState(null);
  const [cat, setCat] = useState(STICKER_CATEGORIES[0].key);
  const [uploading, setUploading] = useState(false);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const drag = useRef(null);

  const commit = (next) => { setItems(next); onChange(next); };
  const update = (i, patch) => commit(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = (it) => { const next = [...items, it]; commit(next); setSel(next.length - 1); };
  const addEmoji = (e) => addItem({ type: 'emoji', value: e, xf: 0.5, yf: 0.5, scale: 0.16, rot: 0 });
  const addText = () => addItem({ type: 'text', value: 'Texte', xf: 0.5, yf: 0.5, scale: 0.1, rot: 0, color: '#ffffff' });
  const remove = (i) => { commit(items.filter((_, k) => k !== i)); setSel(null); };
  async function addImageFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { url, w, h } = await uploadAlbumSticker(file);
      addItem({ type: 'image', value: url, ar: w && h ? w / h : 1, xf: 0.5, yf: 0.5, scale: 0.25, rot: 0 });
    } catch {
      alert("L'import de l'image a échoué. Réessaie avec un fichier PNG ou JPG.");
    } finally {
      setUploading(false);
    }
  }
  const activeCat = STICKER_CATEGORIES.find((c) => c.key === cat) || STICKER_CATEGORIES[0];

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
            style={{ aspectRatio: String(aspect), width: `min(100%, calc(44vh * ${aspect}))`, maxWidth: '100%', containerType: 'size' }}
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
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">{selItem.kind === 'photo' ? 'Photo sélectionnée' : 'Élément sélectionné'}</span>
                {selItem.kind !== 'photo' && (
                  <button onClick={() => remove(sel)} className="text-xs font-medium text-red-600">Supprimer</button>
                )}
              </div>
              {selItem.type === 'text' && (
                <div className="mt-2 flex items-center gap-2">
                  <input value={selItem.value} onChange={(e) => update(sel, { value: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
                  <input type="color" value={selItem.color || '#ffffff'} onChange={(e) => update(sel, { color: e.target.value })}
                    className="h-8 w-10 rounded border border-slate-300" />
                </div>
              )}
              <label className="mt-2 block text-xs text-slate-600">Taille
                <input type="range" min="0.05" max={selItem.kind === 'photo' ? '1.3' : '0.6'} step="0.01" value={selItem.scale}
                  onChange={(e) => update(sel, { scale: parseFloat(e.target.value) })} className="w-full" />
              </label>
              <label className="block text-xs text-slate-600">Rotation
                <input type="range" min="-180" max="180" step="1" value={selItem.rot}
                  onChange={(e) => update(sel, { rot: parseInt(e.target.value, 10) })} className="w-full" />
              </label>
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-slate-500">Touche un élément (photo, emoji, texte…) pour le déplacer, le redimensionner ou le pivoter.</p>
          )}

          <div className="mt-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <button onClick={addText} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">➕ Texte</button>
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
  const eff = getPhotoEffect(photo.effect);
  const { imgStyle } = effectPreview(eff);
  return (
    <DecoEditor
      title="Décorer la photo"
      aspect={ar}
      initialItems={photo.deco || []}
      onChange={onChange}
      onClose={onClose}
      background={<img src={photo.display || photo.full} alt="" className="h-full w-full object-cover" style={imgStyle} draggable={false} />}
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

// Décorer LA PAGE : le fond du canevas reproduit EXACTEMENT la page imprimée
// (fond, en-tête titre/description, photos disposées avec cadres et légendes),
// pour que rien ne se décale ensuite dans le PDF.
export function PageDecorateModal({
  photos, format, onFormatChange, theme, title, note, firstPage,
  dayIndex, location, bg, pageIndex, pageCount, unit = 'jour',
  initialItems, onChange, initialFree, onChangeFree, onClose,
}) {
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
  const enableFree = () => {
    const boxes = photos.map((p, i) => {
      const c = lay.cells[i] || { x: lay.pad, y: lay.pad, w: minPage * 0.4, h: minPage * 0.3 };
      return {
        xf: (c.x + c.w / 2) / lay.pageW,
        yf: (c.y + c.h / 2) / lay.pageH,
        scale: c.w / minPage,
        rot: 0,
      };
    });
    onChangeFree(boxes);
  };
  const disableFree = () => onChangeFree(null);

  // Fond de la page
  let baseStyle = { backgroundColor: theme?.paper || '#FBF8F3', ...themePatternStyle(theme) };
  let bgPhoto = null;
  if (spec.type === 'color') baseStyle = { backgroundColor: spec.color };
  else if (spec.type === 'photo' && (spec.photo?.display || spec.photo?.full)) {
    bgPhoto = (
      <>
        <img src={spec.photo.display || spec.photo.full} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
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
        const { imgStyle, wrapStyle } = effectPreview(getPhotoEffect(p.effect));
        const pdeco = p.deco || [];
        return (
          <div key={i} className="absolute overflow-hidden" style={{ left: pct(c.x, lay.pageW), top: pct(c.y, lay.pageH), width: pct(c.w, lay.pageW), height: pct(c.h, lay.pageH), containerType: 'size' }}>
            <div className="flex h-full w-full items-center justify-center overflow-hidden" style={wrapStyle}>
              <img src={p.display || p.full} alt="" className="h-full w-full object-cover" style={imgStyle} draggable={false} />
            </div>
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
    onChange(decos);
    if (freeValid) {
      onChangeFree(objs.filter((o) => o.kind === 'photo').map(({ xf, yf, scale, rot }) => ({ xf, yf, scale, rot })));
    }
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

function PhotoTile({ photo, onCaption, onRemove, onMoveLeft, onMoveRight, canLeft, canRight, onEffect, onDeco }) {
  const [fxOpen, setFxOpen] = useState(false);
  const [decoOpen, setDecoOpen] = useState(false);
  const effect = getPhotoEffect(photo.effect);
  const { imgStyle, wrapStyle } = effectPreview(effect);
  const deco = photo.deco || [];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative aspect-[4/3] bg-slate-100" style={{ containerType: 'size' }}>
        <div className="flex h-full w-full items-center justify-center overflow-hidden" style={wrapStyle}>
          <img src={photo.display || photo.full} alt="" className="h-full w-full object-cover" style={imgStyle} />
        </div>
        {/* aperçu des décorations */}
        {deco.map((it, i) => (
          <div key={i} className="pointer-events-none absolute"
            style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }}>
            <DecoItemView it={it} />
          </div>
        ))}
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
        {isLowRes(photo) && (
          <span className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
            title="Photo un peu petite : risque de flou à l'impression en grand.">⚠︎ petite</span>
        )}
      </div>
      <input
        value={photo.caption || ''}
        onChange={(e) => onCaption(e.target.value)}
        placeholder="Légende sous la photo"
        className="w-full border-t border-slate-100 px-2.5 py-2 text-xs text-slate-700 outline-none"
      />
      {fxOpen && (
        <EffectPicker photo={photo} current={effect.id} onPick={onEffect} onClose={() => setFxOpen(false)} />
      )}
      {decoOpen && (
        <DecorateModal photo={photo} onChange={onDeco} onClose={() => setDecoOpen(false)} />
      )}
    </div>
  );
}

export function DayCard({ day, index, entry, onChange, onAddPhotos, onPickBgPhoto, busy, progress = null, format = 'carre', onFormatChange = null, theme = null, unit = 'jour', pageOffset = null }) {
  const fileRef = useRef(null);
  const [bgOpen, setBgOpen] = useState(false);
  const [decoPage, setDecoPage] = useState(null);

  const update = (patch) => onChange({ ...entry, ...patch });

  const bg = normalizeBg(entry.bg);
  const total = entry.photos.length;
  const splitCounts = computeSplit(total, entry.split);
  const pageCount = splitCounts.length;
  const chunks = splitPhotos(entry.photos, entry.split);
  const setPageDeco = (p, items) => update({ pageDeco: { ...(entry.pageDeco || {}), [p]: items } });
  const setPageFree = (p, boxes) => {
    const next = { ...(entry.freePages || {}) };
    if (boxes) next[p] = boxes; else delete next[p];
    update({ freePages: next });
  };
  // Change le nombre de pages (réparti équitablement, toujours valide).
  const setPagesCount = (n) =>
    update({ split: balancedSplit(total, Math.max(1, Math.min(total, n))) });
  // Fixe le nombre de photos d'une page : les autres pages sont réajustées
  // pour que le total reste égal au nombre de photos (jamais d'état invalide).
  const setPageValue = (p, val) => {
    const pages = splitCounts.length;
    const v = Math.max(1, Math.min(Number.isFinite(val) ? val : 1, total - (pages - 1)));
    const rest = balancedSplit(total - v, pages - 1);
    let ri = 0;
    const arr = splitCounts.map((_, k) => (k === p ? v : rest[ri++]));
    update({ split: arr });
  };
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

  function setPhotoCaption(pi, caption) {
    const photos = entry.photos.map((p, i) =>
      i === pi ? { ...p, caption } : p
    );
    update({ photos });
  }
  function setPhotoEffect(pi, effect) {
    const photos = entry.photos.map((p, i) => (i === pi ? { ...p, effect } : p));
    update({ photos });
  }
  function setPhotoDeco(pi, deco) {
    const photos = entry.photos.map((p, i) => (i === pi ? { ...p, deco } : p));
    update({ photos });
  }
  function removePhoto(pi) {
    update({ photos: entry.photos.filter((_, i) => i !== pi) });
  }
  function movePhoto(pi, dir) {
    const ni = pi + dir;
    if (ni < 0 || ni >= entry.photos.length) return;
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

      {entry.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {entry.photos.map((p, pi) => (
            <PhotoTile
              key={pi}
              photo={p}
              onCaption={(c) => setPhotoCaption(pi, c)}
              onEffect={(fx) => setPhotoEffect(pi, fx)}
              onDeco={(d) => setPhotoDeco(pi, d)}
              onRemove={() => removePhoto(pi)}
              onMoveLeft={() => movePhoto(pi, -1)}
              onMoveRight={() => movePhoto(pi, 1)}
              canLeft={pi > 0}
              canRight={pi < entry.photos.length - 1}
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
          <>
            <Spinner />
            {progress && progress.total > 1
              ? `Ajout des photos… ${progress.done}/${progress.total}`
              : 'Ajout des photos…'}
          </>
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
          if (files.length) onAddPhotos(files);
        }}
      />

      {/* RÉPARTITION DES PHOTOS SUR LES PAGES (si plus de 6 photos) */}
      {total > PHOTOS_PER_PAGE && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">
              Répartition des {total} photos
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Pages :</span>
              <button
                type="button"
                onClick={() => setPagesCount(pageCount - 1)}
                disabled={pageCount <= 1}
                className="h-6 w-6 rounded border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40"
              >
                −
              </button>
              <span className="w-4 text-center font-semibold text-slate-700">{pageCount}</span>
              <button
                type="button"
                onClick={() => setPagesCount(pageCount + 1)}
                disabled={pageCount >= total}
                className="h-6 w-6 rounded border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-3">
            {splitCounts.map((c, p) => (
              <label key={p} className="flex items-center gap-1.5 text-xs text-slate-600">
                Page {p + 1}
                <input
                  type="number"
                  min={1}
                  max={total}
                  value={c}
                  onChange={(e) => setPageValue(p, parseInt(e.target.value, 10))}
                  className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center"
                />
              </label>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              Modifier une case réajuste les autres pour garder {total} photos.
            </p>
            <button
              type="button"
              onClick={() => update({ split: null })}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Répartition automatique
            </button>
          </div>
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
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={bg.mode === 'spread'}
                    onChange={() => setBg({ ...bg, mode: 'spread' })}
                  />
                  Une seule photo étirée sur les {pageCount} pages (panorama)
                </label>
              </div>
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
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <BgSpecEditor
                  spec={getPageSpec(0)}
                  onChange={(spec) => setPageSpec(0, spec)}
                  onPickPhoto={() => onPickBgPhoto(0)}
                />
              </div>
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
                          <button type="button" onClick={() => setPageSpan(p, 2)} disabled={p + 1 >= pageCount}
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
          onChange={(items) => setPageDeco(decoPage, items)}
          initialFree={entry.freePages?.[decoPage] || null}
          onChangeFree={(boxes) => setPageFree(decoPage, boxes)}
          onClose={() => setDecoPage(null)}
        />
      )}
    </section>
  );
}

// Fenêtre de choix de la photo de couverture : montre toutes les photos déjà
// présentes dans l'album, regroupées par journée. Un clic choisit la couverture.
export function CoverPicker({ days, album, current, onPick, onClose, title = 'Choisir la photo de couverture', unit = 'jour' }) {
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

  const [busyDay, setBusyDay] = useState(null); // index du jour en cours d'upload
  const [addProgress, setAddProgress] = useState(null); // { done, total }
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  // Export imprimable
  const [format, setFormat] = useState('carre');
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);

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
        days: daysArr,
      });
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

  const addDay = () =>
    setAlbum((prev) => {
      setDirty(true);
      return {
        ...prev,
        days: [...prev.days, { location: '', title: '', note: '', photos: [], bg: null, split: null, pageDeco: {}, freePages: {} }],
      };
    });
  const removeDay = (i) =>
    setAlbum((prev) => {
      setDirty(true);
      return { ...prev, days: prev.days.filter((_, k) => k !== i) };
    });
  const moveDay = (i, dir) =>
    setAlbum((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.days.length) return prev;
      const days = [...prev.days];
      [days[i], days[j]] = [days[j], days[i]];
      setDirty(true);
      return { ...prev, days };
    });
  const mergeDayUp = (i) =>
    setAlbum((prev) => {
      if (i <= 0) return prev;
      const a = prev.days[i - 1];
      const b = prev.days[i];
      const note = [a.note, b.title, b.note].map((s) => (s || '').trim()).filter(Boolean).join('\n');
      const merged = { ...a, photos: [...(a.photos || []), ...(b.photos || [])], note, split: null, pageDeco: {}, freePages: {} };
      const days = prev.days.filter((_, k) => k !== i);
      days[i - 1] = merged;
      setDirty(true);
      return { ...prev, days };
    });

  async function addPhotos(i, files) {
    setBusyDay(i);
    setAddProgress({ done: 0, total: files.length });
    setError(null);
    try {
      const uploaded = [];
      for (const f of files) {
        try {
          uploaded.push(await uploadAlbumPhoto(f));
          setAddProgress({ done: uploaded.length, total: files.length });
        } catch (err) {
          throw new Error(
            "L'envoi d'une photo a échoué. Si cela persiste, l'espace de stockage des photos n'est peut-être pas encore activé.",
            { cause: err }
          );
        }
      }
      setAlbum((prev) => {
        const days = [...prev.days];
        const entry = days[i];
        days[i] = { ...entry, photos: [...entry.photos, ...uploaded.map((u) => ({ ...u, caption: '' }))] };
        return { ...prev, days };
      });
      setDirty(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDay(null);
      setAddProgress(null);
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

  async function generatePdf() {
    if (!album) return;
    setGenerating(true);
    setError(null);
    try {
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

      const blob = await pdf(
        <AlbumPdfDoc
          album={albumForPdf}
          days={album.days.map((s) => ({ location: s.location || '' }))}
          format={format}
          summary={trip?.itinerary?.summary || null}
          routeMap={routeMap}
          stops={stops}
          unit={album.unit}
          endNote={album.endNote}
          endPhoto={album.endPhoto}
          theme={getTheme(album.theme)}
        />
      ).toBlob();
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
  const dayOffsets = sectionPageCounts.map(
    (_, i) => 1 + (hasMapPage ? 1 : 0) + sectionPageCounts.slice(0, i).reduce((a, b) => a + b, 0) + 1
  );

  return (
    <div className="mx-auto max-w-3xl">
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

      {/* Photo de couverture */}
      <div className="mt-4 flex items-center gap-4">
        <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          {album.cover ? (
            <img
              src={album.cover.display || album.cover.full}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
              Couverture automatique
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">Photo de couverture</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {album.cover
              ? 'Tu peux la changer ou revenir à la photo automatique.'
              : 'Par défaut, la première photo de ton album est utilisée.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPickerFor('cover')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              🖼️ Choisir la couverture
            </button>
            {album.cover && (
              <button
                type="button"
                onClick={() => {
                  setAlbum((prev) => ({ ...prev, cover: null }));
                  setDirty(true);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Couverture automatique
              </button>
            )}
          </div>
        </div>
      </div>

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
                onAddPhotos={(files) => addPhotos(i, files)}
                progress={busyDay === i ? addProgress : null}
                onPickBgPhoto={(slot) => setPickerFor({ kind: 'dayBg', i, slot })}
                busy={busyDay === i}
                format={format}
                onFormatChange={setFormat}
                theme={getTheme(album.theme)}
                unit={album.unit}
                pageOffset={dayOffsets[i]}
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

      {/* PAGE DE FIN */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-slate-900">Page de fin</h2>
        <p className="mt-1 text-sm text-slate-600">
          La toute dernière page de l'album. Tu peux y écrire ton propre message
          et choisir une photo de fond.
        </p>

        <textarea
          value={album.endNote}
          onChange={(e) => {
            setAlbum((prev) => ({ ...prev, endNote: e.target.value }));
            setDirty(true);
          }}
          rows={3}
          placeholder="Ton mot de fin (par défaut : « Les voyages finissent, les souvenirs restent. »)"
          className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-coral-400"
        />

        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {album.endPhoto ? (
              <img
                src={album.endPhoto.display || album.endPhoto.full}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
                Fond uni (sombre)
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">Photo de fond (facultative)</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Sans photo, la page de fin est sur un fond sombre uni.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPickerFor('end')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                🖼️ Choisir une photo de fond
              </button>
              {album.endPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    setAlbum((prev) => ({ ...prev, endPhoto: null }));
                    setDirty(true);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Enlever la photo
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

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
        <p className="mt-1 text-sm text-slate-600">
          On fabrique un fichier PDF prêt à envoyer à un imprimeur. Les photos
          sont utilisées en pleine qualité, et un petit débord est ajouté autour
          des pages pour la découpe.
        </p>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Choisis le format :</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(FORMAT_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFormat(key);
                  if (pdfUrl) {
                    URL.revokeObjectURL(pdfUrl);
                    setPdfUrl(null);
                  }
                }}
                className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                  format === key
                    ? 'border-coral-400 bg-coral-50 text-coral-700 ring-2 ring-coral-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="block">{label}</span>
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  {key === 'carre'
                    ? 'Le format classique des livres photo, carré.'
                    : key === 'a4paysage'
                      ? 'Format allongé, comme une feuille A4 couchée.'
                      : 'Format vertical, comme une feuille A4 debout.'}
                </span>
              </button>
            ))}
          </div>
        </div>

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

      {pickerFor && (() => {
        const kind = pickerFor.kind;
        let title = 'Choisir la photo de couverture';
        let current = album.cover;
        if (kind === 'end') {
          title = 'Choisir la photo de fond';
          current = album.endPhoto;
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
