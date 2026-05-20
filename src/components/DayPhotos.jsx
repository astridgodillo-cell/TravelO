import { useEffect, useState } from 'react';
import { fetchPhotosFor } from '../lib/photos';
import PhotoCarousel from './PhotoCarousel';

export default function DayPhotos({ location, max = 5, aspect = false }) {
  const [photos, setPhotos] = useState(null);

  useEffect(() => {
    let active = true;
    if (!location) return;
    // Google Places en priorité (vraies photos), fallback Unsplash puis Pexels
    fetchPhotosFor(location, max, 'google-places').then((list) => {
      if (active) setPhotos(list || []);
    });
    return () => {
      active = false;
    };
  }, [location, max]);

  // Mode aspect : wrapper en aspect-[4/3] pour s'aligner avec la mini-carte.
  // Mode classique : hauteur fixe (utilisation hors grille).
  if (aspect) {
    if (photos === null) {
      return (
        <div
          className="print:hidden w-full rounded-2xl bg-slate-100 animate-pulse"
          style={{ aspectRatio: '4 / 3' }}
        />
      );
    }
    if (!photos.length) return null;
    return (
      <div
        className="print:hidden w-full"
        style={{ aspectRatio: '4 / 3' }}
      >
        <PhotoCarousel photos={photos} heightClass="h-full" />
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
      <PhotoCarousel photos={photos} />
    </div>
  );
}
