// Listes d'options partagées entre PreferencesForm (création d'itinéraire)
// et ProfilePage (préférences par défaut du user).
// Source de vérité unique pour éviter les divergences.

export const TRIP_TYPES = [
  { id: 'itinerant', label: 'Itinérant', icon: 'route' },
  { id: 'roadtrip-voiture', label: 'Road trip voiture', icon: 'car' },
  { id: 'roadtrip-van', label: 'Road trip van / camping-car', icon: 'van' },
  { id: 'avion-voiture', label: 'Avion + voiture de location', icon: 'plane-car' },
  { id: 'avion-citybreak', label: 'Avion + city break (à pied / TC)', icon: 'plane-walk' },
  { id: 'avion-itinerant', label: 'Avion + itinérant (multi-modes sur place)', icon: 'plane' },
  { id: 'train-international', label: 'Train international', icon: 'train' },
  { id: 'circuit-train', label: 'Circuit train', icon: 'train-circle' },
  { id: 'velo', label: 'Vélo / cyclotourisme', icon: 'bike' },
  { id: 'trek', label: 'Trek itinérant', icon: 'hiking' },
  { id: 'croisiere', label: 'Croisière', icon: 'ship' },
  { id: 'sejour-fixe', label: 'Séjour fixe', icon: 'beach' },
];

// L'ancien id 'roadtrip-camping-car' a été fusionné dans 'roadtrip-van'.
// On le garde dans les sets pour que les itinéraires/templates historiques
// (créés avant la fusion) continuent à être reconnus comme road trips.
export const MOTORIZED_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
  'avion-voiture',
  'avion-itinerant',
]);

export const ROAD_TRIP_TYPES = new Set([
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
]);

// Types de voyage où le voyageur a typiquement un horaire impératif
// d'arrivée et de départ (vol, train international, croisière). Pour ces
// trips, on demande l'heure d'arrivée à destination et l'heure limite de
// départ → l'IA calibre les marges (installation J1, marge avant départ).
export const SCHEDULED_TRIP_TYPES = new Set([
  'avion-voiture',
  'avion-citybreak',
  'avion-itinerant',
  'train-international',
  'croisiere',
]);

// Types où l'IA PEUT proposer une location de voiture (sous réserve que
// l'utilisateur ait le permis de conduire). Si hasDrivingLicense est false,
// on instruit l'IA de ne proposer QUE des modes alternatifs (TC, taxi,
// vélo, marche, excursions organisées). Pour les autres types (croisière,
// vélo, trek…) la voiture est intrinsèquement hors sujet.
export const CAR_RENTAL_POSSIBLE_TRIP_TYPES = new Set([
  'itinerant',
  'roadtrip-voiture',
  'roadtrip-van',
  'roadtrip-camping-car',
  'avion-voiture',
  'avion-itinerant',
]);

// Mapping pour normaliser l'id de trip type au cas où on lirait un
// itinéraire/template enregistré avant la fusion.
export function normalizeTripType(id) {
  if (id === 'roadtrip-camping-car') return 'roadtrip-van';
  return id;
}

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

// Activités spécifiques regroupées par catégorie (utile pour l'affichage
// en sections plutôt qu'une longue liste plate). Le champ "category" sert
// uniquement à l'UI ; le payload envoyé à l'IA reste un tableau d'ids.
export const SPECIFIC_ACTIVITIES = [
  { id: 'velo-route', label: 'Vélo / VTT', category: 'sport' },
  { id: 'kayak', label: 'Kayak / canoë', category: 'eau' },
  { id: 'paddle', label: 'Paddle (SUP)', category: 'eau' },
  { id: 'surf', label: 'Surf', category: 'eau' },
  { id: 'plongee', label: 'Plongée sous-marine', category: 'eau' },
  { id: 'snorkeling', label: 'Snorkeling', category: 'eau' },
  { id: 'voile', label: 'Voile / bateau', category: 'eau' },
  { id: 'peche', label: 'Pêche', category: 'eau' },
  { id: 'randonnee', label: 'Randonnée', category: 'nature' },
  { id: 'escalade', label: 'Escalade / via ferrata', category: 'sport' },
  { id: 'canyoning', label: 'Canyoning', category: 'sport' },
  { id: 'parapente', label: 'Parapente', category: 'sport' },
  { id: 'observation-faune', label: 'Observation faune', category: 'nature' },
  { id: 'astronomie', label: 'Astronomie', category: 'nature' },
  { id: 'parcs-nationaux', label: 'Parcs nationaux', category: 'nature' },
  { id: 'grottes', label: 'Grottes / spéléo', category: 'nature' },
  { id: 'musees', label: 'Musées', category: 'culture' },
  { id: 'monuments', label: 'Châteaux / monuments', category: 'culture' },
  { id: 'sites-archeo', label: 'Sites archéologiques', category: 'culture' },
  { id: 'street-art', label: 'Street art', category: 'culture' },
  { id: 'marches', label: 'Marchés locaux', category: 'gastronomie' },
  { id: 'degustation', label: 'Œnologie / dégustation', category: 'gastronomie' },
  { id: 'cours-cuisine', label: 'Cours de cuisine', category: 'gastronomie' },
  { id: 'restaurants-etoiles', label: 'Restaurants étoilés', category: 'gastronomie' },
  { id: 'thermes', label: 'Thermes / spa', category: 'bien-être' },
  { id: 'yoga', label: 'Yoga / méditation', category: 'bien-être' },
  { id: 'vie-nocturne', label: 'Vie nocturne', category: 'urbain' },
  { id: 'shopping', label: 'Shopping', category: 'urbain' },
  { id: 'parcs-attractions', label: 'Parcs d\'attractions', category: 'famille' },
  { id: 'zoos-aquariums', label: 'Zoos / aquariums', category: 'famille' },
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
