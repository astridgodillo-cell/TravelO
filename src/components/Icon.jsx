/**
 * Bibliothèque d'icônes SVG sobres utilisées partout dans l'app.
 * Style cohérent : stroke 2, linecap/linejoin round, viewBox 24x24.
 *
 * Usage :
 *   <Icon name="car" />
 *   <Icon name="bike" className="h-5 w-5 text-brand-600" />
 *
 * Pour ajouter une icône, ajoute juste une entrée dans le map ICONS.
 */

const BASE_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

// Chaque icône est une fonction qui renvoie les enfants du <svg>.
const ICONS = {
  // ----- Trip types -----
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h7a3 3 0 0 0 0-6h-6a3 3 0 0 1 0-6h7" />
    </>
  ),
  car: (
    <>
      <path d="M5 17h14v-4l-2-5H7l-2 5v4z" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="16" cy="17" r="2" />
      <path d="M5 13h14" />
    </>
  ),
  van: (
    <>
      <path d="M3 16V8a1 1 0 0 1 1-1h11l4 5v4" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M15 12h4" />
      <path d="M3 12h6" />
    </>
  ),
  plane: (
    <>
      <path d="M21 15l-7-3V5a2 2 0 0 0-4 0v7l-7 3v2l7-1.5V20l-2 1v1l4-1 4 1v-1l-2-1v-4.5L21 17v-2z" />
    </>
  ),
  'plane-car': (
    <>
      <path d="M13 4 l5 5 -1.5 1.5 -5 -2 -3 3 1 3 -1 1 -2.5 -2.5 -2.5 -2.5 1 -1 3 1 3 -3 -2 -5 1.5 -1.5z" />
      <path d="M4 18h12l-1.5-3h-9z" />
      <circle cx="7" cy="18" r="1.4" />
      <circle cx="14" cy="18" r="1.4" />
    </>
  ),
  'plane-walk': (
    <>
      <path d="M13 3l4 4 -1.2 1.2 -4 -1.6 -2.4 2.4 0.8 2.4 -0.8 0.8 -2 -2 -2 -2 0.8 -0.8 2.4 0.8 2.4 -2.4 -1.6 -4z" />
      <circle cx="9" cy="16" r="1.2" />
      <path d="M9 17v3" />
      <path d="M9 19l-2 2" />
      <path d="M9 19l2 1" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14" />
      <circle cx="9" cy="14" r="0.8" fill="currentColor" />
      <circle cx="15" cy="14" r="0.8" fill="currentColor" />
      <path d="M8 17l-2 3" />
      <path d="M16 17l2 3" />
    </>
  ),
  'train-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="8" y="7" width="8" height="8" rx="2" />
      <path d="M8 11h8" />
      <circle cx="10" cy="13" r="0.6" fill="currentColor" />
      <circle cx="14" cy="13" r="0.6" fill="currentColor" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l4-8h4l4 8" />
      <path d="M10 8h-2" />
      <path d="M14 8l1-2h2" />
    </>
  ),
  hiking: (
    <>
      <path d="M3 20l5-9 4 3 5-8 4 14z" />
      <circle cx="10" cy="6" r="1.5" />
    </>
  ),
  ship: (
    <>
      <path d="M3 17l1 4h16l1-4" />
      <path d="M4 17h16l-2-6H6z" />
      <path d="M12 11V4l5 3H7l5-3" />
    </>
  ),
  beach: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M12 10v8" />
      <path d="M5 17l7-2 7 2" />
      <path d="M3 20h18" />
    </>
  ),

  // ----- Activités / catégories -----
  bed: (
    <>
      <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
      <path d="M2 16h20" />
      <path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
    </>
  ),
  plate: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16 8 14 14 8 16 10 10 16 8" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h14v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h12" />
      <circle cx="17" cy="13" r="1" fill="currentColor" />
    </>
  ),
  map: (
    <>
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </>
  ),
  mountain: (
    <>
      <path d="M3 20l6-12 4 7 3-4 5 9z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.6 5.6l1.4 1.4" />
      <path d="M17 17l1.4 1.4" />
      <path d="M5.6 18.4l1.4-1.4" />
      <path d="M17 7l1.4-1.4" />
    </>
  ),

  // ----- Tabs / sections / profil -----
  sliders: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="8" cy="6" r="2" fill="white" />
      <circle cx="16" cy="12" r="2" fill="white" />
      <circle cx="10" cy="18" r="2" fill="white" />
    </>
  ),
  mask: (
    <>
      <path d="M4 8c0 5 3 10 8 10s8-5 8-10c0-2-2-3-4-3s-2 1-4 1-2-1-4-1S4 6 4 8z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 19c0-2.5 2-4 4-4s2 1 2 4" />
    </>
  ),
  check: (
    <>
      <polyline points="4 12 9 17 20 6" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </>
  ),
  star: (
    <>
      <polygon points="12 3 14.5 9 21 9.5 16 14 17.5 20.5 12 17 6.5 20.5 8 14 3 9.5 9.5 9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  diamond: (
    <>
      <polygon points="6 3 18 3 22 9 12 22 2 9" />
      <line x1="6" y1="3" x2="12" y2="9" />
      <line x1="18" y1="3" x2="12" y2="9" />
      <line x1="2" y1="9" x2="22" y2="9" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  road: (
    <>
      <path d="M5 21 L8 3" />
      <path d="M19 21 L16 3" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="12" y1="11" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3v1h6v-1c0-1 0-2 1-3a6 6 0 0 0-4-10z" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  book: (
    <>
      <path d="M4 4a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
      <line x1="8" y1="6" x2="14" y2="6" />
      <line x1="8" y1="10" x2="14" y2="10" />
    </>
  ),

  // ----- Actions / utility -----
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <line x1="9" y1="11" x2="15" y2="7" />
      <line x1="9" y1="13" x2="15" y2="17" />
    </>
  ),
  arrow: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M19 16l0.7 1.8 1.8 0.7 -1.8 0.7 -0.7 1.8 -0.7 -1.8 -1.8 -0.7 1.8 -0.7z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M6 3c0 4 6 5 6 9s-6 5-6 9" />
      <path d="M18 3c0 4-6 5-6 9s6 5 6 9" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l10 18H2z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17.5" r="0.7" fill="currentColor" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-0.2-1.6l2-1.5-2-3.4-2.3 0.9a7 7 0 0 0-2.8-1.6L13 2h-4l-0.7 2.7a7 7 0 0 0-2.8 1.6L3.2 5.4l-2 3.4 2 1.5A7 7 0 0 0 3 12c0 0.5 0.1 1.1 0.2 1.6l-2 1.5 2 3.4 2.3-0.9a7 7 0 0 0 2.8 1.6L9 22h4l0.7-2.7a7 7 0 0 0 2.8-1.6l2.3 0.9 2-3.4-2-1.5A7 7 0 0 0 19 12z" />
    </>
  ),
};

export default function Icon({ name, className = 'h-5 w-5', strokeWidth }) {
  const node = ICONS[name];
  if (!node) {
    if (typeof console !== 'undefined') console.warn(`[Icon] unknown name: ${name}`);
    return null;
  }
  return (
    <svg
      {...BASE_PROPS}
      strokeWidth={strokeWidth ?? BASE_PROPS.strokeWidth}
      className={className}
      aria-hidden="true"
    >
      {node}
    </svg>
  );
}
