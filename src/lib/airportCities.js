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
  {
    aliases: ['allemagne', 'germany', 'deutschland'],
    cities: [
      { name: 'Berlin', iata: 'BER', note: 'Capitale, culture' },
      { name: 'Munich', iata: 'MUC', note: 'Bavière, Alpes' },
      { name: 'Francfort', iata: 'FRA', note: 'Hub financier' },
      { name: 'Hambourg', iata: 'HAM', note: 'Port, Nord' },
      { name: 'Düsseldorf', iata: 'DUS', note: 'Rhin, mode' },
      { name: 'Cologne', iata: 'CGN', note: 'Cathédrale, Rhin' },
    ],
  },
  {
    aliases: ['espagne', 'spain', 'españa'],
    cities: [
      { name: 'Madrid', iata: 'MAD', note: 'Capitale, musées' },
      { name: 'Barcelone', iata: 'BCN', note: 'Catalogne, Gaudí' },
      { name: 'Séville', iata: 'SVQ', note: 'Andalousie, flamenco' },
      { name: 'Valence', iata: 'VLC', note: 'Côte, paella' },
      { name: 'Malaga', iata: 'AGP', note: 'Costa del Sol' },
      { name: 'Palma de Majorque', iata: 'PMI', note: 'Baléares' },
      { name: 'Bilbao', iata: 'BIO', note: 'Pays basque, Guggenheim' },
    ],
  },
  {
    aliases: ['italie', 'italy', 'italia'],
    cities: [
      { name: 'Rome', iata: 'FCO', note: 'Capitale, antique' },
      { name: 'Milan', iata: 'MXP', note: 'Mode, lacs' },
      { name: 'Venise', iata: 'VCE', note: 'Lagune, romantique' },
      { name: 'Naples', iata: 'NAP', note: 'Sud, Pompéi' },
      { name: 'Florence', iata: 'FLR', note: 'Toscane, Renaissance' },
      { name: 'Bologne', iata: 'BLQ', note: 'Émilie-Romagne, food' },
      { name: 'Catane', iata: 'CTA', note: 'Sicile, Etna' },
    ],
  },
  {
    aliases: ['royaume-uni', 'royaume uni', 'uk', 'angleterre', 'united kingdom', 'england', 'great britain'],
    cities: [
      { name: 'Londres', iata: 'LHR', note: 'Capitale, monuments' },
      { name: 'Manchester', iata: 'MAN', note: 'Nord, foot' },
      { name: 'Édimbourg', iata: 'EDI', note: 'Écosse, château' },
      { name: 'Glasgow', iata: 'GLA', note: 'Écosse, port' },
      { name: 'Liverpool', iata: 'LPL', note: 'Beatles, port' },
    ],
  },
  {
    aliases: ['portugal'],
    cities: [
      { name: 'Lisbonne', iata: 'LIS', note: 'Capitale, tramways' },
      { name: 'Porto', iata: 'OPO', note: 'Nord, vin' },
      { name: 'Faro', iata: 'FAO', note: 'Algarve, plages' },
      { name: 'Funchal (Madère)', iata: 'FNC', note: 'Île atlantique' },
      { name: 'Ponta Delgada (Açores)', iata: 'PDL', note: 'Îles volcaniques' },
    ],
  },
  {
    aliases: ['grece', 'grèce', 'greece'],
    cities: [
      { name: 'Athènes', iata: 'ATH', note: 'Capitale, Acropole' },
      { name: 'Héraklion (Crète)', iata: 'HER', note: 'Plus grande île' },
      { name: 'Santorin', iata: 'JTR', note: 'Île volcanique blanche' },
      { name: 'Mykonos', iata: 'JMK', note: 'Cyclades, fête' },
      { name: 'Rhodes', iata: 'RHO', note: 'Dodécanèse' },
      { name: 'Thessalonique', iata: 'SKG', note: 'Macédoine' },
    ],
  },
  {
    aliases: ['pologne', 'poland', 'polska'],
    cities: [
      { name: 'Varsovie', iata: 'WAW', note: 'Capitale' },
      { name: 'Cracovie', iata: 'KRK', note: 'Historique, vieille ville' },
      { name: 'Gdansk', iata: 'GDN', note: 'Baltique, port' },
      { name: 'Wroclaw', iata: 'WRO', note: 'Silésie, nains' },
    ],
  },
  {
    aliases: ['croatie', 'croatia', 'hrvatska'],
    cities: [
      { name: 'Split', iata: 'SPU', note: 'Côte dalmate' },
      { name: 'Zagreb', iata: 'ZAG', note: 'Capitale' },
      { name: 'Dubrovnik', iata: 'DBV', note: 'Sud, remparts' },
      { name: 'Pula', iata: 'PUY', note: 'Istrie, arènes' },
    ],
  },
  {
    aliases: ['norvege', 'norvège', 'norway', 'norge'],
    cities: [
      { name: 'Oslo', iata: 'OSL', note: 'Capitale, fjord' },
      { name: 'Bergen', iata: 'BGO', note: 'Porte des fjords' },
      { name: 'Tromsø', iata: 'TOS', note: 'Aurores boréales' },
      { name: 'Stavanger', iata: 'SVG', note: 'Preikestolen' },
    ],
  },
  {
    aliases: ['suede', 'suède', 'sweden', 'sverige'],
    cities: [
      { name: 'Stockholm', iata: 'ARN', note: 'Capitale, archipel' },
      { name: 'Göteborg', iata: 'GOT', note: 'Côte ouest' },
      { name: 'Malmö', iata: 'MMX', note: 'Sud, près Copenhague' },
    ],
  },
  {
    aliases: ['finlande', 'finland', 'suomi'],
    cities: [
      { name: 'Helsinki', iata: 'HEL', note: 'Capitale design' },
      { name: 'Rovaniemi', iata: 'RVN', note: 'Laponie, Père Noël' },
    ],
  },
  {
    aliases: ['islande', 'iceland', 'ísland'],
    cities: [
      { name: 'Reykjavik', iata: 'KEF', note: 'Capitale, geyser' },
    ],
  },
  {
    aliases: ['irlande', 'ireland', 'éire'],
    cities: [
      { name: 'Dublin', iata: 'DUB', note: 'Capitale, pubs' },
      { name: 'Shannon', iata: 'SNN', note: 'Ouest, falaises de Moher' },
      { name: 'Cork', iata: 'ORK', note: 'Sud, gastronomie' },
    ],
  },
  {
    aliases: ['turquie', 'turkey', 'türkiye'],
    cities: [
      { name: 'Istanbul', iata: 'IST', note: 'Pont Orient/Occident' },
      { name: 'Antalya', iata: 'AYT', note: 'Riviera turque' },
      { name: 'Izmir', iata: 'ADB', note: 'Égée, Éphèse' },
      { name: 'Bodrum', iata: 'BJV', note: 'Sud-ouest, plages' },
      { name: 'Cappadoce (Kayseri)', iata: 'ASR', note: 'Montgolfières' },
    ],
  },
  {
    aliases: ['maroc', 'morocco'],
    cities: [
      { name: 'Casablanca', iata: 'CMN', note: 'Économique, port' },
      { name: 'Marrakech', iata: 'RAK', note: 'Ville rouge, médina' },
      { name: 'Agadir', iata: 'AGA', note: 'Sud, plages' },
      { name: 'Tanger', iata: 'TNG', note: 'Nord, détroit' },
      { name: 'Fès', iata: 'FEZ', note: 'Médina ancienne' },
      { name: 'Ouarzazate', iata: 'OZZ', note: 'Porte du désert' },
    ],
  },
  {
    aliases: ['egypte', 'égypte', 'egypt'],
    cities: [
      { name: 'Le Caire', iata: 'CAI', note: 'Capitale, Pyramides' },
      { name: 'Hurghada', iata: 'HRG', note: 'Mer Rouge, plongée' },
      { name: 'Sharm el-Sheikh', iata: 'SSH', note: 'Sinaï, corail' },
      { name: 'Louxor', iata: 'LXR', note: 'Antique, Vallée des Rois' },
      { name: 'Assouan', iata: 'ASW', note: 'Sud, Nil' },
    ],
  },
  {
    aliases: ['tunisie', 'tunisia'],
    cities: [
      { name: 'Tunis', iata: 'TUN', note: 'Capitale, Carthage' },
      { name: 'Djerba', iata: 'DJE', note: 'Île, plages' },
      { name: 'Monastir', iata: 'MIR', note: 'Sahel' },
    ],
  },
  {
    aliases: ['kenya'],
    cities: [
      { name: 'Nairobi', iata: 'NBO', note: 'Capitale, safari' },
      { name: 'Mombasa', iata: 'MBA', note: 'Côte indienne' },
    ],
  },
  {
    aliases: ['tanzanie', 'tanzania'],
    cities: [
      { name: 'Dar es Salaam', iata: 'DAR', note: 'Économique, côte' },
      { name: 'Zanzibar', iata: 'ZNZ', note: 'Île, épices' },
      { name: 'Kilimandjaro', iata: 'JRO', note: 'Arusha, safaris' },
    ],
  },
  {
    aliases: ['emirats', 'émirats', 'uae', 'emirats arabes unis'],
    cities: [
      { name: 'Dubaï', iata: 'DXB', note: 'Mégapole, shopping' },
      { name: 'Abu Dhabi', iata: 'AUH', note: 'Capitale, mosquée' },
    ],
  },
  {
    aliases: ['singapour', 'singapore'],
    cities: [
      { name: 'Singapour', iata: 'SIN', note: 'Cité-État cosmopolite' },
    ],
  },
  {
    aliases: ['malaisie', 'malaysia'],
    cities: [
      { name: 'Kuala Lumpur', iata: 'KUL', note: 'Capitale, tours jumelles' },
      { name: 'Penang', iata: 'PEN', note: 'Île, gastronomie' },
      { name: 'Langkawi', iata: 'LGK', note: 'Île, plages' },
      { name: 'Kota Kinabalu', iata: 'BKI', note: 'Bornéo malais' },
    ],
  },
  {
    aliases: ['philippines'],
    cities: [
      { name: 'Manille', iata: 'MNL', note: 'Capitale' },
      { name: 'Cebu', iata: 'CEB', note: 'Visayas, plongée' },
      { name: 'Palawan (Puerto Princesa)', iata: 'PPS', note: 'Île paradis' },
    ],
  },
  {
    aliases: ['coree', 'corée', 'corée du sud', 'south korea', 'korea'],
    cities: [
      { name: 'Séoul', iata: 'ICN', note: 'Capitale, K-pop' },
      { name: 'Busan', iata: 'PUS', note: 'Côte sud, plages' },
      { name: 'Jeju', iata: 'CJU', note: 'Île volcanique' },
    ],
  },
  {
    aliases: ['cambodge', 'cambodia'],
    cities: [
      { name: 'Phnom Penh', iata: 'PNH', note: 'Capitale' },
      { name: 'Siem Reap', iata: 'SAI', note: 'Angkor Wat' },
    ],
  },
  {
    aliases: ['sri lanka'],
    cities: [
      { name: 'Colombo', iata: 'CMB', note: 'Capitale économique' },
    ],
  },
  {
    aliases: ['nepal', 'népal'],
    cities: [
      { name: 'Katmandou', iata: 'KTM', note: 'Capitale, Himalaya' },
    ],
  },
  {
    aliases: ['colombie', 'colombia'],
    cities: [
      { name: 'Bogotá', iata: 'BOG', note: 'Capitale, altitude' },
      { name: 'Carthagène', iata: 'CTG', note: 'Caraïbe coloniale' },
      { name: 'Medellín', iata: 'MDE', note: 'Ville éternelle printemps' },
      { name: 'Cali', iata: 'CLO', note: 'Salsa, sud-ouest' },
      { name: 'Santa Marta', iata: 'SMR', note: 'Caraïbe, Sierra Nevada' },
    ],
  },
  {
    aliases: ['chili', 'chile'],
    cities: [
      { name: 'Santiago', iata: 'SCL', note: 'Capitale, Andes' },
      { name: 'Calama (San Pedro)', iata: 'CJC', note: 'Désert Atacama' },
      { name: 'Punta Arenas', iata: 'PUQ', note: 'Patagonie sud' },
    ],
  },
  {
    aliases: ['equateur', 'équateur', 'ecuador'],
    cities: [
      { name: 'Quito', iata: 'UIO', note: 'Capitale, Andes' },
      { name: 'Guayaquil', iata: 'GYE', note: 'Côte, porte Galápagos' },
    ],
  },
  {
    aliases: ['costa rica'],
    cities: [
      { name: 'San José', iata: 'SJO', note: 'Capitale, jungle' },
      { name: 'Liberia', iata: 'LIR', note: 'Pacifique, plages' },
    ],
  },
  {
    aliases: ['cuba'],
    cities: [
      { name: 'La Havane', iata: 'HAV', note: 'Capitale rétro' },
      { name: 'Varadero', iata: 'VRA', note: 'Plages all-inclusive' },
      { name: 'Holguín', iata: 'HOG', note: 'Est, plages préservées' },
    ],
  },
  {
    aliases: ['republique dominicaine', 'république dominicaine', 'dominican republic'],
    cities: [
      { name: 'Punta Cana', iata: 'PUJ', note: 'Plages caraïbe' },
      { name: 'Saint-Domingue', iata: 'SDQ', note: 'Capitale historique' },
    ],
  },
  {
    aliases: ['nouvelle-zelande', 'nouvelle-zélande', 'new zealand'],
    cities: [
      { name: 'Auckland', iata: 'AKL', note: 'Plus grande ville, Nord' },
      { name: 'Christchurch', iata: 'CHC', note: 'Sud, Alpes' },
      { name: 'Queenstown', iata: 'ZQN', note: 'Sud, aventure' },
      { name: 'Wellington', iata: 'WLG', note: 'Capitale, vent' },
    ],
  },
  {
    aliases: ['polynesie francaise', 'polynésie française', 'tahiti'],
    cities: [
      { name: 'Papeete', iata: 'PPT', note: 'Tahiti, lagons' },
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
