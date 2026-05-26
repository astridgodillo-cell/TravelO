// Quand l'utilisateur tape un PAYS vaste comme destination, on lui propose
// les principales villes-aéroports d'entrée pour éviter d'avoir à deviner.
// Liste curatée — pas exhaustive, juste les portes d'entrée les plus
// courantes en touristique loisir.
//
// Détection : on matche le texte saisi (insensible à la casse, accents
// normalisés) contre la liste des aliases. Une seule entrée = même pays
// peut avoir plusieurs alias (français, anglais, gentilé…).

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export const COUNTRIES_WITH_GATEWAYS = [
  {
    aliases: ['canada'],
    cities: [
      { name: 'Montréal', iata: 'YUL', note: 'Québec, francophone' },
      { name: 'Toronto', iata: 'YYZ', note: 'Métropole anglophone' },
      { name: 'Vancouver', iata: 'YVR', note: 'Côte Pacifique, montagnes' },
      { name: 'Calgary', iata: 'YYC', note: 'Porte des Rocheuses' },
      { name: 'Québec', iata: 'YQB', note: 'Vieille ville fortifiée' },
    ],
  },
  {
    aliases: ['etats-unis', 'états-unis', 'usa', 'us', 'amerique', 'amérique'],
    cities: [
      { name: 'New York', iata: 'JFK', note: 'Côte Est, métropole' },
      { name: 'Los Angeles', iata: 'LAX', note: 'Côte Ouest, Hollywood' },
      { name: 'Miami', iata: 'MIA', note: 'Floride, plages' },
      { name: 'San Francisco', iata: 'SFO', note: 'Baie, Golden Gate' },
      { name: 'Las Vegas', iata: 'LAS', note: 'Désert, casinos' },
      { name: 'Chicago', iata: 'ORD', note: 'Grands Lacs' },
      { name: 'Boston', iata: 'BOS', note: 'Nouvelle-Angleterre' },
      { name: 'Washington', iata: 'IAD', note: 'Capitale' },
    ],
  },
  {
    aliases: ['australie', 'australia'],
    cities: [
      { name: 'Sydney', iata: 'SYD', note: 'Opéra, plages' },
      { name: 'Melbourne', iata: 'MEL', note: 'Culturelle, cafés' },
      { name: 'Brisbane', iata: 'BNE', note: 'Porte Queensland' },
      { name: 'Cairns', iata: 'CNS', note: 'Grande Barrière de corail' },
      { name: 'Perth', iata: 'PER', note: 'Côte Ouest isolée' },
    ],
  },
  {
    aliases: ['bresil', 'brésil', 'brazil'],
    cities: [
      { name: 'Rio de Janeiro', iata: 'GIG', note: 'Plages, Christ Rédempteur' },
      { name: 'São Paulo', iata: 'GRU', note: 'Mégalopole économique' },
      { name: 'Salvador', iata: 'SSA', note: 'Bahia, afro-brésilien' },
      { name: 'Fortaleza', iata: 'FOR', note: 'Nordeste, plages' },
      { name: 'Manaus', iata: 'MAO', note: 'Porte de l\'Amazonie' },
    ],
  },
  {
    aliases: ['chine', 'china'],
    cities: [
      { name: 'Pékin', iata: 'PEK', note: 'Capitale, Cité interdite' },
      { name: 'Shanghai', iata: 'PVG', note: 'Mégalopole moderne' },
      { name: 'Hong Kong', iata: 'HKG', note: 'Asie cosmopolite' },
      { name: 'Chengdu', iata: 'CTU', note: 'Sichuan, pandas' },
      { name: 'Canton', iata: 'CAN', note: 'Sud, gastronomie' },
    ],
  },
  {
    aliases: ['inde', 'india'],
    cities: [
      { name: 'Delhi', iata: 'DEL', note: 'Capitale, Nord' },
      { name: 'Mumbai', iata: 'BOM', note: 'Bollywood, côte ouest' },
      { name: 'Bangalore', iata: 'BLR', note: 'Sud, tech' },
      { name: 'Goa', iata: 'GOI', note: 'Plages, ex-portugais' },
      { name: 'Cochin', iata: 'COK', note: 'Kerala, backwaters' },
    ],
  },
  {
    aliases: ['russie', 'russia'],
    cities: [
      { name: 'Moscou', iata: 'SVO', note: 'Capitale, Place Rouge' },
      { name: 'Saint-Pétersbourg', iata: 'LED', note: 'Tsariste, musées' },
    ],
  },
  {
    aliases: ['mexique', 'mexico'],
    cities: [
      { name: 'Mexico', iata: 'MEX', note: 'Capitale, altitude' },
      { name: 'Cancún', iata: 'CUN', note: 'Caraïbe, plages' },
      { name: 'Guadalajara', iata: 'GDL', note: 'Mariachi, tequila' },
      { name: 'Mérida', iata: 'MID', note: 'Yucatán, Maya' },
    ],
  },
  {
    aliases: ['argentine', 'argentina'],
    cities: [
      { name: 'Buenos Aires', iata: 'EZE', note: 'Capitale, tango' },
      { name: 'Mendoza', iata: 'MDZ', note: 'Vignobles, Andes' },
      { name: 'Bariloche', iata: 'BRC', note: 'Patagonie nord, lacs' },
      { name: 'Ushuaia', iata: 'USH', note: 'Bout du monde' },
    ],
  },
  {
    aliases: ['afrique du sud', 'south africa'],
    cities: [
      { name: 'Le Cap', iata: 'CPT', note: 'Table Mountain, vins' },
      { name: 'Johannesburg', iata: 'JNB', note: 'Porte des safaris' },
      { name: 'Durban', iata: 'DUR', note: 'Côte indienne' },
    ],
  },
  {
    aliases: ['indonesie', 'indonésie', 'indonesia'],
    cities: [
      { name: 'Bali (Denpasar)', iata: 'DPS', note: 'Île hindoue' },
      { name: 'Jakarta', iata: 'CGK', note: 'Capitale, Java' },
      { name: 'Yogyakarta', iata: 'JOG', note: 'Borobudur, culture' },
      { name: 'Lombok', iata: 'LOP', note: 'Plages tranquilles' },
    ],
  },
  {
    aliases: ['japon', 'japan'],
    cities: [
      { name: 'Tokyo', iata: 'NRT', note: 'Capitale, ultra-moderne' },
      { name: 'Osaka', iata: 'KIX', note: 'Kansaï, street food' },
      { name: 'Sapporo', iata: 'CTS', note: 'Hokkaido, neige' },
      { name: 'Okinawa', iata: 'OKA', note: 'Sud tropical' },
    ],
  },
  {
    aliases: ['thailande', 'thaïlande', 'thailand'],
    cities: [
      { name: 'Bangkok', iata: 'BKK', note: 'Capitale, temples' },
      { name: 'Phuket', iata: 'HKT', note: 'Plages andamanes' },
      { name: 'Chiang Mai', iata: 'CNX', note: 'Nord, jungle' },
      { name: 'Koh Samui', iata: 'USM', note: 'Golfe, plages' },
    ],
  },
  {
    aliases: ['vietnam', 'viêt nam'],
    cities: [
      { name: 'Hô-Chi-Minh', iata: 'SGN', note: 'Sud, Saigon' },
      { name: 'Hanoï', iata: 'HAN', note: 'Capitale, Nord' },
      { name: 'Da Nang', iata: 'DAD', note: 'Centre, plages' },
    ],
  },
  {
    aliases: ['perou', 'pérou', 'peru'],
    cities: [
      { name: 'Lima', iata: 'LIM', note: 'Capitale, gastronomie' },
      { name: 'Cusco', iata: 'CUZ', note: 'Porte du Machu Picchu' },
    ],
  },
];

// Renvoie la liste des villes-aéroports si la saisie correspond à un grand
// pays. Sinon null.
export function findGatewaysForCountry(query) {
  const q = normalize(query);
  if (!q || q.length < 3) return null;
  for (const entry of COUNTRIES_WITH_GATEWAYS) {
    for (const alias of entry.aliases) {
      if (q === normalize(alias)) return entry;
    }
  }
  return null;
}
