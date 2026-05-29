import { useEffect } from 'react';

// Widget officiel GetYourGuide : affiche de VRAIES activités avec leurs VRAIS
// prix (issus de la marketplace GYG, toujours à jour) + réservation en
// affiliation. Ne nécessite PAS l'API "prix" (réservée aux gros sites) : juste
// un identifiant partenaire affilié (gratuit), à mettre dans VITE_GYG_PARTNER_ID.
//
// Limite technique : le widget est un cadre fourni par GetYourGuide (iframe
// d'un autre domaine) → on AFFICHE les vrais prix, mais on ne peut pas les
// LIRE pour le budget. Le budget utilise l'estimation TravelO, ajustable d'un
// clic sur le prix de l'activité (vue Planning).

const PARTNER_ID = import.meta.env?.VITE_GYG_PARTNER_ID || '';
export const GYG_ENABLED = !!PARTNER_ID;

const SCRIPT_SRC = 'https://widget.getyourguide.com/dist/pa.umd.production.min.js';
let scriptInjected = false;

function ensureScript() {
  if (scriptInjected || typeof document === 'undefined' || !PARTNER_ID) return;
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    scriptInjected = true;
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = SCRIPT_SRC;
  s.setAttribute('data-gyg-partner-id', PARTNER_ID);
  document.body.appendChild(s);
  scriptInjected = true;
}

export default function GygActivityWidget({ query, count = 3, className = '' }) {
  useEffect(() => {
    ensureScript();
  }, []);

  if (!PARTNER_ID || !query) return null;

  return (
    <div className={`print:hidden ${className}`}>
      {/* Le script GYG détecte ce <div> et y injecte les vraies offres + prix. */}
      <div
        data-gyg-href="https://widget.getyourguide.com/default/activities.frame"
        data-gyg-locale-code="fr-FR"
        data-gyg-widget="activities"
        data-gyg-number-of-items={String(count)}
        data-gyg-partner-id={PARTNER_ID}
        data-gyg-q={query}
      />
    </div>
  );
}
