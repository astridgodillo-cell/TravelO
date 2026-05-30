import { useEffect, useRef } from 'react';

// Widget officiel DiscoverCars : une vraie barre de recherche de location de
// voiture. Le visiteur saisit sa ville et ses dates SUR ton site, puis voit les
// vraies voitures et leurs vrais prix chez DiscoverCars — avec ton identifiant
// d'affilié accroché (commission ~70%, cookie 365 jours).
//
// Le script widget.js de DiscoverCars lit les attributs data-* du <script> et
// dessine la barre juste à côté. On l'injecte donc en JavaScript (un simple
// collage de HTML n'exécuterait pas le script).

const AFF_CODE = import.meta.env?.VITE_DISCOVERCARS_AID || 'TravelO';

// Attributs repris à l'identique du code fourni par le générateur DiscoverCars
// (les NOMS doivent rester exacts : widget.js les lit tels quels). Seuls les
// libellés visibles ont été traduits en français.
const WIDGET_ATTRS = [
  ['data-dev-env', 'com'],
  ['data-location', ''],
  ['data-lang', 'fr'],
  ['data-currency', 'eur'],
  ['data-utm-source', AFF_CODE],
  ['data-utm-medium', 'widget'],
  ['data-aff-code', 'a_aid'],
  ['data-autocomplete', 'on'],
  ['data-style-submit-bg-color', '#007ac2'],
  ['data-style-submit-font-color', '#ffffff'],
  ['data-style-form-bg-color', '#fcd34d'],
  ['data-style-form-font-color', '#000000'],
  ['data-style-submit-text', 'Rechercher'],
  ['data-style-title-color', '#000000'],
  ['data-title-text', 'Comparez les locations de voiture et économisez jusqu’à 70 % !'],
  ['data-style_rounded_corners', 'on'],
  ['data-layout_benefits', 'on'],
  ['data-layout_description', 'on'],
  ['data-layout_description_text', 'Les meilleures offres de nos partenaires de location.'],
  ['data-layout_logo_style', 'on dark'],
  ['data-layout_powered_by', 'on'],
  ['data-layout_style_form_bg_color', '#007ac2'],
  ['data-layout_title', 'on'],
];

export default function DiscoverCarsWidget({ className = '' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Repart d'un conteneur propre si le composant se remonte (navigation SPA).
    container.innerHTML = '';
    const s = document.createElement('script');
    s.id = 'dchwidget';
    s.src = 'https://www.discovercars.com/widget.js?v1';
    s.async = true;
    for (const [name, value] of WIDGET_ATTRS) {
      s.setAttribute(name, value);
    }
    container.appendChild(s);
  }, []);

  // print:hidden → on n'imprime pas la barre interactive dans les PDF.
  return <div ref={containerRef} className={`print:hidden ${className}`} />;
}
