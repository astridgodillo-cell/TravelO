import { useEffect, useRef } from 'react';

// Fait que le bouton « retour » (téléphone / navigateur) FERME la fenêtre
// ouverte, comme la croix — au lieu de quitter la page.
//
// Conception : un gestionnaire GLOBAL unique. Chaque fenêtre ouverte s'inscrit
// dans une pile ; « retour » ferme la fenêtre du dessus. Quand une fenêtre est
// fermée par la croix (ou remplacée par une autre), on ne recule JAMAIS dans
// l'historique nous-mêmes (c'est ce qui créait des retours en cascade sortant
// de la page) : son entrée d'historique devient « orpheline » et sera
// simplement avalée, en silence, par un prochain appui sur retour.
//
// Le handler peut fermer une sous-couche (ex. zoom plein écran) et renvoyer
// `false` : la fenêtre reste ouverte et le prochain retour sera de nouveau
// intercepté.

const entries = []; // fenêtres ouvertes, la plus récente en dernier
let orphans = 0; // états d'historique de fenêtres déjà fermées par la croix

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const top = entries[entries.length - 1];
    if (top) {
      const stillOpen = top.run() === false;
      if (stillOpen) {
        window.history.pushState({ traveloModal: true }, '');
      } else {
        const idx = entries.indexOf(top);
        if (idx >= 0) entries.splice(idx, 1);
        top.closedByPop = true;
      }
      return;
    }
    if (orphans > 0) orphans -= 1; // on avale l'état orphelin, sans effet
    // sinon : vraie navigation arrière, on laisse le navigateur faire
  });
}

export default function useBackClose(handler) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    const entry = { run: () => h.current(), closedByPop: false };
    entries.push(entry);
    window.history.pushState({ traveloModal: true }, '');
    return () => {
      const idx = entries.indexOf(entry);
      if (idx >= 0) {
        // Fermée par la croix / remplacée : on retire l'inscription mais on ne
        // touche PAS à l'historique (aucun history.back() → aucune cascade).
        entries.splice(idx, 1);
        orphans += 1;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
