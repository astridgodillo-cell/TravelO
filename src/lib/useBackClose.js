import { useEffect, useRef } from 'react';

// Fait que le bouton « retour » (téléphone / navigateur) FERME la fenêtre
// ouverte, comme la croix — au lieu de quitter la page (UX mobile attendue).
//
// Usage : useBackClose(onClose) dans le composant de la fenêtre.
// Le handler peut fermer seulement une sous-couche (ex. zoom plein écran) et
// renvoyer `false` pour signaler que la fenêtre reste ouverte : le prochain
// « retour » sera de nouveau intercepté.
export default function useBackClose(handler) {
  const h = useRef(handler);
  h.current = handler;
  const done = useRef(false);
  useEffect(() => {
    window.history.pushState({ traveloModal: true }, '');
    const onPop = () => {
      if (done.current) return;
      const stillOpen = h.current() === false;
      if (stillOpen) window.history.pushState({ traveloModal: true }, '');
      else done.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Fermée par la croix : on retire l'entrée d'historique ajoutée, pour
      // que le prochain « retour » fasse ce qu'on attend de lui.
      if (!done.current) {
        done.current = true;
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
