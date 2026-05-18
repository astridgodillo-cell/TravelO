import { useEffect, useState } from 'react';
import { fetchPhotosFor } from '../lib/photos';

export default function DayPhotos({ location, max = 5 }) {
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    if (!location) return;
    setError(null);
    fetchPhotosFor(location, max).then((list) => {
      if (active) {
        setPhotos(list);
        if (!list.length) setError('Aucune photo trouvée');
      }
    });
    return () => {
      active = false;
    };
  }, [location, max]);

  if (photos === null) {
    return (
      <div className="mt-4 print:hidden">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: max }).map((_, i) => (
            <div
              key={i}
              className="h-24 w-32 rounded-md bg-slate-100 animate-pulse shrink-0"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!photos.length) {
    return null;
  }

  return (
    <div className="mt-4 print:hidden">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
        Galerie
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {photos.map((p) => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            title={`${p.alt} — © ${p.photographer} (Pexels)`}
            className="shrink-0 group relative rounded-md overflow-hidden"
          >
            <img
              src={p.src.medium}
              alt={p.alt}
              loading="lazy"
              className="h-28 w-44 object-cover group-hover:opacity-90 transition-opacity"
            />
            <span className="absolute bottom-0 left-0 right-0 text-[10px] text-white bg-black/40 px-1 py-0.5 truncate">
              © {p.photographer}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
