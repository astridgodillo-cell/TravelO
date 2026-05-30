import { useMemo } from 'react';

// Barre de recherche DiscoverCars ISOLÉE dans un cadre (iframe).
//
// Pourquoi un iframe ? Le script officiel DiscoverCars cherche un élément avec
// l'identifiant fixe "dchwidget". Si on posait deux barres directement sur la
// même page (ex. itinéraire multi-villes : une voiture à Lisbonne, une à Porto),
// elles entreraient en conflit et une seule s'afficherait. En enfermant chaque
// barre dans son propre cadre, chacune est totalement indépendante → on peut en
// mettre autant qu'on veut.
//
// <base target="_blank"> : quand le visiteur clique sur "Rechercher", les
// résultats DiscoverCars s'ouvrent dans un NOUVEL onglet (et pas à l'intérieur
// du petit cadre).

const AFF_CODE = import.meta.env?.VITE_DISCOVERCARS_AID || 'TravelO';

// location : nom de ville/aéroport pré-rempli dans le champ "prise en charge".
// DiscoverCars le reconnaît par son nom (fonctionne pour les aéroports et les
// grandes villes) ; sinon le visiteur le saisit lui-même (autocomplétion).
function buildSrcDoc(location) {
  const attrs = [
    ['id', 'dchwidget'],
    ['src', 'https://www.discovercars.com/widget.js?v1'],
    ['data-dev-env', 'com'],
    ['data-location', location || ''],
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
    ['data-title-text', 'Comparez les locations de voiture'],
    ['data-style_rounded_corners', 'on'],
    ['data-layout_benefits', 'on'],
    ['data-layout_description', 'off'],
    ['data-layout_logo_style', 'on dark'],
    ['data-layout_powered_by', 'on'],
    ['data-layout_style_form_bg_color', '#007ac2'],
    ['data-layout_title', 'on'],
  ];
  const attrStr = attrs
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0;background:transparent}</style></head>' +
    `<body><div><script ${attrStr} async></script></div></body></html>`
  );
}

export default function CarRentalWidget({ location = '', className = '' }) {
  const srcDoc = useMemo(() => buildSrcDoc(location), [location]);
  return (
    <iframe
      title={`Recherche de location de voiture${location ? ' à ' + location : ''}`}
      srcDoc={srcDoc}
      loading="lazy"
      className={`w-full h-[640px] sm:h-[560px] border-0 print:hidden ${className}`}
    />
  );
}
