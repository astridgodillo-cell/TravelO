import { useEffect, useState } from 'react';
import { fetchPhotosFor } from '../lib/photos';
import PhotoCarousel from './PhotoCarousel';

export default function DayPhotos({ location, max = 5 }) {
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
