import { useEffect, useMemo, useState } from 'react';
import { fetchPhotosFor } from '../lib/photos';
import PhotoCarousel from './PhotoCarousel';

export default function DayPhotos({
  location,
  max = 5,
  aspect = false,
  photoOffset = 0,
}) {
  const [photos, setPhotos] = useState(null);

  useEffect(() => {
    let active = true;
    if (!location) return;
    // Google Places en priorité (vraies photos), fallback Unsplash (enrichi
    // "destination" : golden hour, paysage…) puis Pexels.
    fetchPhotosFor(location, max, 'google-places', 'destination').then((list) => {
      if (active) setPhotos(list || []);
    });
    return () => {
      active = false;
    };
  }, [location, max]);

  // Rotation des photos en fonction de l'offset (nombre de fois où ce lieu
  // est déjà apparu avant). Évite d'afficher la même photo en même position
  // sur des jours consécutifs au même endroit.
  const orderedPhotos = useMemo(() => {
    if (!photos?.length || !photoOffset) return photos;
    const n = photoOffset % photos.length;
    if (n === 0) return photos;
    return [...photos.slice(n), ...photos.slice(0, n)];
  }, [photos, photoOffset]);

  // Mode aspect : wrapper en aspect-[16/9] pour s'aligner avec la mini-carte.
  // Mode classique : hauteur fixe (utilisation hors grille).
  if (aspect) {
    if (photos === null) {
      return (
        <div
          className="print:hidden w-full rounded-2xl bg-slate-100 animate-pulse"
          style={{ aspectRatio: '16 / 9' }}
        />
      );
    }
    if (!photos.length) return null;
    return (
      <div
        className="print:hidden w-full"
        style={{ aspectRatio: '4 / 3' }}
      >
        <PhotoCarousel photos={orderedPhotos} heightClass="h-full" />
      </div>
    );
  }

  if (photos === null) {
    return (
      <div className="mt-4 print:hidden h-64 sm:h-80 rounded-2xl bg-slate-100 animate-pulse" />
    );
  }
  if (!photos.length) return null;
  return (
    <div className="mt-4 print:hidden">
      <PhotoCarousel photos={orderedPhotos} />
    </div>
  );
}
