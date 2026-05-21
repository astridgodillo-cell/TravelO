// Listes d'options partagées entre PreferencesForm (création d'itinéraire)
// et ProfilePage (préférences par défaut du user).
// Source de vérité unique pour éviter les divergences.

export const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant' },
  { id: 'roadtrip-voiture', label: '🚗 Road trip voiture' },
  { id: 'roadtrip-van', label: '🚐 Road trip van' },
  { id: 'roadtrip-camping-car', label: '🚍 Road trip camping-car' },
  { id: 'avion-voiture', label: '✈️ Avion + voiture de location' },
  { id: 'avion-citybreak', label: '✈️ Avion + city break (à pied / TC)' },
  { id: 'train-international', label: '🚄 Train international' },
  { id: 'circuit-train', label: '🚉 Circuit train' },
  { id: 'velo', label: '🚴 Vélo / cyclotourisme' },
  { id: 'trek', label: '🥾 Trek itinérant' },
  { id: 'croisiere', label: '🛳️ Croisière' },
  { id: 'sejour-fixe', label: '🏖️ Séjour fixe' },
];

export const MOTORIZED_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
  'avion-voiture',
]);

export const ROAD_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
]);

export const INTERESTS = [
  'nature',
  'culture',
  'gastronomie',
  'plage',
  'sport',
  'randonnée',
  'modernité',
  'hors des sentiers battus',
];

export const SPECIFIC_ACTIVITIES = [
  { id: 'velo-route', label: '🚴 Vélo / VTT' },
  { id: 'kayak', label: '🛶 Kayak / canoë' },
  { id: 'paddle', label: '🏄 Paddle (SUP)' },
  { id: 'surf', label: '🏄‍♂️ Surf' },
  { id: 'plongee', label: '🤿 Plongée sous-marine' },
  { id: 'snorkeling', label: '🐠 Snorkeling' },
  { id: 'voile', label: '⛵ Voile / bateau' },
  { id: 'peche', label: '🎣 Pêche' },
  { id: 'randonnee', label: '🥾 Randonnée' },
  { id: 'escalade', label: '🧗 Escalade / via ferrata' },
  { id: 'canyoning', label: '💦 Canyoning' },
  { id: 'parapente', label: '🪂 Parapente' },
  { id: 'observation-faune', label: '🦌 Observation faune' },
  { id: 'astronomie', label: '🌌 Astronomie' },
  { id: 'musees', label: '🏛️ Musées' },
  { id: 'monuments', label: '🏰 Châteaux / monuments' },
  { id: 'grottes', label: '🕳️ Grottes / spéléo' },
  { id: 'parcs-nationaux', label: '🌲 Parcs nationaux' },
  { id: 'sites-archeo', label: '⛏️ Sites archéologiques' },
  { id: 'street-art', label: '🎨 Street art' },
  { id: 'marches', label: '🛍️ Marchés locaux' },
  { id: 'degustation', label: '🍷 Œnologie / dégustation' },
  { id: 'cours-cuisine', label: '👨‍🍳 Cours de cuisine' },
  { id: 'restaurants-etoiles', label: '⭐ Restaurants étoilés' },
  { id: 'thermes', label: '♨️ Thermes / spa' },
  { id: 'yoga', label: '🧘 Yoga / méditation' },
  { id: 'vie-nocturne', label: '🌃 Vie nocturne' },
  { id: 'shopping', label: '🛒 Shopping' },
  { id: 'parcs-attractions', label: '🎢 Parcs d\'attractions' },
  { id: 'zoos-aquariums', label: '🦓 Zoos / aquariums' },
];

export const BUDGET_LEVELS = [
  { id: 'economique', label: 'Économique' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'confort', label: 'Confort' },
  { id: 'haut-de-gamme', label: 'Haut de gamme' },
];

export const VEHICLE_TYPES = [
  { id: 'van-amenage', label: 'Van aménagé', height: 2.1, length: 5.4, consumption: 8.5, fuel: 'diesel' },
  { id: 'fourgon-amenage', label: 'Fourgon aménagé', height: 2.6, length: 6.0, consumption: 10, fuel: 'diesel' },
  { id: 'cc-capucine', label: 'Camping-car capucine', height: 3.0, length: 6.5, consumption: 12, fuel: 'diesel' },
  { id: 'cc-profile', label: 'Camping-car profilé', height: 2.8, length: 7.0, consumption: 11, fuel: 'diesel' },
  { id: 'cc-integral', label: 'Camping-car intégral', height: 3.1, length: 7.5, consumption: 13, fuel: 'diesel' },
  { id: 'voiture', label: 'Voiture / SUV', height: 1.6, length: 4.5, consumption: 6.5, fuel: 'essence' },
  { id: 'voiture-tente', label: 'Voiture + tente', height: 1.6, length: 4.5, consumption: 6.5, fuel: 'essence' },
];

export const FUEL_TYPES = ['diesel', 'essence', 'GPL', 'électrique', 'hybride'];

export const NIGHT_STAY_OPTIONS = [
  'Hôtel',
  'Camping classique',
  'Camping municipal',
  'Aire de camping-car publique',
  'Aire de camping-car privée',
  'France Passion / accueil chez l\'habitant',
  'Parking gratuit',
  'Bivouac (où autorisé)',
];

export const COOKING_OPTIONS = [
  { id: 'vehicle', label: 'Je cuisine dans le véhicule' },
  { id: 'restaurants', label: 'Restaurants uniquement' },
  { id: 'mix', label: 'Mix cuisine + restos' },
];

export const DIETARY_OPTIONS = [
  'végétarien',
  'végan',
  'sans gluten',
  'sans lactose',
  'halal',
  'casher',
  'sans porc',
  'sans fruits de mer',
];

export const COMMON_LANGUAGES = [
  'français',
  'anglais',
  'espagnol',
  'italien',
  'allemand',
  'portugais',
  'néerlandais',
  'arabe',
];

// Préférences "durables" (par défaut d'un persona / profil de voyage),
// sans les champs spécifiques à un trip (destinations, dates, départ…).
export const PROFILE_PREF_DEFAULTS = {
  tripType: 'itinerant',
  interests: ['culture', 'gastronomie'],
  specificActivities: [],
  budget: 'moyen',
  offDays: 0,
  vehicle: {
    type: '',
    height: '',
    length: '',
    fuel: 'diesel',
    consumption: '',
  },
  nightStayPreferences: ['Hôtel'],
  cooking: 'restaurants',
  needsServicePoints: false,
  okWithFerry: true,
};

export function suggestStayPrefs(vehicleId) {
  if (!vehicleId) return ['Hôtel'];
  if (vehicleId.startsWith('cc-')) {
    return [
      'Aire de camping-car publique',
      'Aire de camping-car privée',
      'France Passion / accueil chez l\'habitant',
      'Camping classique',
    ];
  }
  if (vehicleId === 'van-amenage' || vehicleId === 'fourgon-amenage') {
    return [
      'Aire de camping-car publique',
      'Parking gratuit',
      'Bivouac (où autorisé)',
      'France Passion / accueil chez l\'habitant',
    ];
  }
  if (vehicleId === 'voiture-tente') {
    return ['Camping classique', 'Camping municipal'];
  }
  return ['Hôtel'];
}
