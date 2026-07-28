import { useEffect, useState } from 'react';

// Hauteur RÉELLE de la barre de menu TravelO (le <header> collant en haut).
// Elle varie selon la largeur de l'écran (les liens passent parfois sur deux
// lignes) : une valeur fixe laissait les barres d'actions à moitié cachées
// dessous. On mesure, et on suit les changements de taille.
export default function useNavbarHeight(fallback = 61) {
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const el = document.querySelector('header.sticky');
    if (!el) return undefined;
    const upd = () => setH(el.offsetHeight);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    window.addEventListener('resize', upd);
    return () => { ro.disconnect(); window.removeEventListener('resize', upd); };
  }, []);
  return h;
}
