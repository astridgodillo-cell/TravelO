import { useEffect, useState } from 'react';
import { fetchPhotosFor } from '../lib/photos';

export default function DaySpecialties({
  specialties,
  location,
  onFetch,
  loading,
}) {
  const hasSpecialties = Array.isArray(specialties) && specialties.length > 0;

  if (!hasSpecialties) {
    return (
      <div className="mt-4 print:hidden">
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm flex flex-wrap items-center justify-between gap-3">
          <div className="text-slate-700">
            🍽️ Découvrez les spécialités culinaires de cette étape
          </div>
          {onFetch && (
            <button
              onClick={onFetch}
              disabled={loading}
              className="btn-secondary text-xs"
            >
              {loading ? 'Chargement…' : 'Charger les spécialités'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
        🍽️ Spécialités culinaires{location ? ` — ${location}` : ''}
      </h4>
      <div className="grid sm:grid-cols-2 gap-3">
        {specialties.map((s, i) => (
          <SpecialtyCard key={`${s.name}-${i}`} specialty={s} />
        ))}
      </div>
    </div>
  );
}

function SpecialtyCard({ specialty }) {
  const [photo, setPhoto] = useState(undefined); // undefined = loading, null = none
  const query = specialty.photo_query || specialty.name;

  useEffect(() => {
    let active = true;
    if (!query) {
      setPhoto(null);
      return;
    }
    fetchPhotosFor(query, 1).then((list) => {
      if (active) setPhoto(list?.[0] || null);
    });
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <article className="flex gap-3 rounded-lg border border-slate-100 bg-white overflow-hidden">
      <div className="w-24 sm:w-28 shrink-0 bg-slate-100 relative">
        {photo === undefined ? (
          <div className="absolute inset-0 animate-pulse bg-slate-200" />
        ) : photo ? (
          <a href={photo.url} target="_blank" rel="noreferrer">
            <img
              src={photo.src.small}
              alt={photo.alt || specialty.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </a>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-3xl">
            🍽️
          </div>
        )}
      </div>
      <div className="flex-1 p-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h5 className="font-semibold text-slate-900">{specialty.name}</h5>
          {specialty.category && (
            <span className="text-[10px] uppercase tracking-wide text-slate-400 capitalize">
              {specialty.category}
            </span>
          )}
        </div>
        <p className="text-slate-600 mt-1 text-xs leading-relaxed">
          {specialty.description}
        </p>
      </div>
    </article>
  );
}
