import { useEffect, useState } from 'react';

/**
 * Choix utilisateur du mode d'affichage des journées d'itinéraire.
 * Persisté dans localStorage pour que la préférence soit conservée
 * entre les sessions, et appliqué dès le rendu (pas de flash de
 * mauvais mode au premier affichage).
 *
 *   'cards'    → cartes colorées par catégorie (par défaut)
 *   'timeline' → chronologique matin→soir avec rail vertical
 */
const STORAGE_KEY = 'travelo.dayLayout';
const VALID = new Set(['cards', 'timeline']);
const DEFAULT_MODE = 'cards';

function readStoredMode() {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function useDayLayout() {
  const [mode, setMode] = useState(readStoredMode);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage indisponible (mode privé sur certains navigateurs) — pas grave
    }
  }, [mode]);

  return [mode, setMode];
}
