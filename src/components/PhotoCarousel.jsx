import { useEffect, useRef, useState } from 'react';

/**
 * Carrousel swipable horizontal :
 * - scroll-snap CSS pour le swipe natif (mobile et trackpad)
 * - dots + flèches sur desktop
 * - dégradé sombre + crédit photo en overlay
 * - clique pour ouvrir la photo originale
 */
export default function PhotoCarousel({ photos, heightClass = 'h-64 sm:h-80' }) {
  const ref = useRef(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      const i = Math.round(el.scrollLeft / el.clientWidth);
      setCurrent(i);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  function go(i) {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  if (!photos?.length) return null;

  return (
    <div className="relative group rounded-2xl overflow-hidden bg-slate-100 animate-pop-in">
      <div
        ref={ref}
        className={`flex overflow-x-auto snap-x snap-mandatory scrollbar-hide ${heightClass}`}
      >
        {photos.map((p, i) => (
          <a
            key={p.id || i}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="snap-center shrink-0 w-full relative block"
          >
            <img
              src={p.src?.large || p.src?.medium || p.src?.small}
              srcSet={
                p.src?.medium && p.src?.large
                  ? `${p.src.medium} 600w, ${p.src.large} 1200w`
                  : undefined
              }
              alt={p.alt || ''}
              loading={i === 0 ? 'eager' : 'lazy'}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />
            {p.photographer && (
              <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between text-white text-[11px]">
                <span className="bg-black/40 backdrop-blur rounded-full px-2 py-0.5">
                  📷 {p.photographer}
                  {p.source && (
                    <span className="opacity-70 ml-1">· {p.source}</span>
                  )}
                </span>
                <span className="bg-black/40 backdrop-blur rounded-full px-2 py-0.5 tabular-nums">
                  {i + 1} / {photos.length}
                </span>
              </div>
            )}
          </a>
        ))}
      </div>

      {/* Flèches (desktop, hover) */}
      {photos.length > 1 && (
        <>
          <NavBtn
            direction="left"
            disabled={current === 0}
            onClick={() => go(Math.max(0, current - 1))}
          />
          <NavBtn
            direction="right"
            disabled={current >= photos.length - 1}
            onClick={() =>
              go(Math.min(photos.length - 1, current + 1))
            }
          />
        </>
      )}

      {/* Dots */}
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {photos.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                go(i);
              }}
              aria-label={`Photo ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === current
                  ? 'w-6 bg-white'
                  : 'w-1.5 bg-white/55 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavBtn({ direction, disabled, onClick }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Précédent' : 'Suivant'}
      className={`hidden sm:grid place-items-center absolute top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/85 backdrop-blur text-slate-700 shadow opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 ${
        direction === 'left' ? 'left-2' : 'right-2'
      } hover:bg-white`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === 'left' ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}
