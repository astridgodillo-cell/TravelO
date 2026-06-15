import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import DiscoverCarsWidget from '../components/DiscoverCarsWidget';

/* ------------------------------------------------------------------ */
/* Photos de voyage (Unsplash, URL stables, libres de droits)          */
/* ------------------------------------------------------------------ */
const HERO_PHOTOS = [
  {
    src: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=2000&q=80',
    place: 'Santorin, Grèce',
  },
  {
    src: 'https://images.unsplash.com/photo-1604999333679-b86d54738315?auto=format&fit=crop&w=2000&q=80',
    place: 'Bali, Indonésie',
  },
  {
    src: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=2000&q=80',
    place: 'Tokyo, Japon',
  },
  {
    src: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=2000&q=80',
    place: 'Maldives',
  },
  {
    src: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=2000&q=80',
    place: 'Paris, France',
  },
  {
    src: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?auto=format&fit=crop&w=2000&q=80',
    place: 'Marrakech, Maroc',
  },
  {
    src: 'https://images.unsplash.com/photo-1483683804023-6ccdb62f86ef?auto=format&fit=crop&w=2000&q=80',
    place: 'Patagonie',
  },
  {
    src: 'https://images.unsplash.com/photo-1504829857797-ddff29c27927?auto=format&fit=crop&w=2000&q=80',
    place: 'Islande',
  },
];

const DESTINATIONS = [
  {
    name: 'Japon',
    tagline: 'Tradition & néons',
    src: 'https://images.unsplash.com/photo-1492571350019-22de08371fd3?auto=format&fit=crop&w=900&q=80',
  },
  {
    name: 'Italie',
    tagline: 'Toscane & Côte amalfitaine',
    src: 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?auto=format&fit=crop&w=900&q=80',
  },
  {
    name: 'Maroc',
    tagline: 'Médinas & désert',
    src: 'https://images.unsplash.com/photo-1539020140153-e479b8c5cf9c?auto=format&fit=crop&w=900&q=80',
  },
  {
    name: 'Pérou',
    tagline: 'Andes & Machu Picchu',
    src: 'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=900&q=80',
  },
  {
    name: 'Norvège',
    tagline: 'Fjords & aurores',
    src: 'https://images.unsplash.com/photo-1601581875309-fafbf2d3ed3a?auto=format&fit=crop&w=900&q=80',
  },
  {
    name: 'Vietnam',
    tagline: 'Baie d\'Halong & street food',
    src: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80',
  },
];

/* ------------------------------------------------------------------ */
/* Helper : profil "déjà configuré" ? Cache le bandeau d'onboarding    */
/* ------------------------------------------------------------------ */
function isProfileConfigured(profile) {
  if (!profile) return false;
  if (profile.onboarding_completed) return true;
  const personal = profile.personal_info || {};
  const hasPersonal =
    (personal.dietary?.length || 0) > 0 ||
    (personal.languages?.length || 0) > 0 ||
    Boolean(personal.allergies) ||
    Boolean(personal.mobility);
  const hasVisited =
    Array.isArray(profile.visited_places) && profile.visited_places.length > 0;
  const hasWishlist =
    Array.isArray(profile.wishlist_places) && profile.wishlist_places.length > 0;
  return hasPersonal || hasVisited || hasWishlist;
}

/* ------------------------------------------------------------------ */
/* HomePage                                                            */
/* ------------------------------------------------------------------ */
export default function HomePage() {
  const { user, profile, isApproved, loading } = useAuth();
  const showOnboardingBanner =
    user && isApproved && !loading && !isProfileConfigured(profile);

  return (
    <div className="space-y-16 sm:space-y-24 lg:space-y-32 pb-12 sm:pb-16">
      {showOnboardingBanner && (
        <div className="px-4 sm:px-6 lg:px-10 pt-4 sm:pt-6">
          <div className="max-w-7xl mx-auto rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900">
                Configure ton profil en 3 étapes
              </h3>
              <p className="text-sm text-slate-600 mt-0.5">
                Tes futurs itinéraires seront pré-remplis automatiquement.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link to="/bienvenue" className="btn-primary">
                Commencer
              </Link>
            </div>
          </div>
        </div>
      )}

      <Hero user={user} isApproved={isApproved} loading={loading} />

      <HowItWorks />

      <Destinations />

      <Inclusions />

      <CarRental />

      <FinalCTA user={user} isApproved={isApproved} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HERO — Photos qui défilent en crossfade + overlay + CTA            */
/* ------------------------------------------------------------------ */
function Hero({ user, isApproved, loading }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % HERO_PHOTOS.length);
    }, 5500);
    return () => clearInterval(id);
  }, []);

  let primaryCta;
  let secondaryCta = null;

  if (loading) {
    primaryCta = (
      <span className="btn-hero opacity-50 cursor-default">Chargement…</span>
    );
  } else if (!user) {
    primaryCta = (
      <Link to="/inscription" className="btn-hero">
        Créer un compte gratuit
      </Link>
    );
    secondaryCta = (
      <Link to="/connexion" className="btn-hero-ghost">
        J'ai déjà un compte
      </Link>
    );
  } else if (!isApproved) {
    primaryCta = (
      <Link to="/compte-en-attente" className="btn-hero">
        Voir l'état de mon compte
      </Link>
    );
  } else {
    primaryCta = (
      <Link to="/creer" className="btn-hero">
        Créer mon itinéraire
      </Link>
    );
    secondaryCta = (
      <Link to="/mes-voyages" className="btn-hero-ghost">
        Mes voyages
      </Link>
    );
  }

  return (
    <section className="relative h-[78vh] min-h-[520px] sm:h-[82vh] sm:min-h-[600px] lg:h-[88vh] lg:max-h-[820px] w-full overflow-hidden">
      {/* Carrousel d'images en fond */}
      <div className="absolute inset-0">
        {HERO_PHOTOS.map((p, i) => (
          <div
            key={p.src}
            className={`absolute inset-0 transition-opacity duration-[1400ms] ease-in-out ${
              i === idx ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <img
              src={p.src}
              alt={p.place}
              loading={i === 0 ? 'eager' : 'lazy'}
              className="absolute inset-0 w-full h-full object-cover scale-105"
              style={{
                animation:
                  i === idx
                    ? 'kenburns 9s ease-out forwards'
                    : 'none',
              }}
            />
          </div>
        ))}

        {/* Dégradé sombre + dégradé latéral pour lisibilité */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/75" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-transparent" />
      </div>

      {/* Contenu */}
      <div className="relative h-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 flex flex-col justify-end pb-12 sm:pb-16 lg:pb-24 text-white">
        <span className="inline-flex w-fit items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.2em] bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-3 sm:px-4 py-1 sm:py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Itinéraires détaillés à la carte
        </span>

        <h1 className="mt-4 sm:mt-6 text-3xl leading-[1.1] sm:text-5xl sm:leading-[1.05] md:text-6xl lg:text-7xl font-bold tracking-tight max-w-4xl drop-shadow-xl">
          Votre voyage,<br />
          <span className="italic font-light text-white/95 whitespace-nowrap">
            comme un tour&#8209;opérateur.
          </span>
        </h1>

        <p className="mt-4 sm:mt-6 text-base sm:text-lg md:text-xl text-white/90 max-w-2xl leading-relaxed">
          TravelO compose pour vous un programme jour par jour&nbsp;: hébergements,
          restaurants, excursions, transports et budget — avec photos, spécialités
          locales et carte interactive.
        </p>

        <div className="mt-6 sm:mt-8 lg:mt-10 flex flex-col sm:flex-row gap-2.5 sm:gap-3">
          {primaryCta}
          {secondaryCta}
        </div>

        {/* Indicateur de lieu courant + dots */}
        <div className="mt-8 sm:mt-10 lg:mt-12 flex items-center justify-between gap-3 sm:gap-4">
          <div className="text-xs sm:text-sm tracking-wide text-white/80 font-medium truncate">
            {HERO_PHOTOS[idx].place}
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {HERO_PHOTOS.map((_, i) => (
              <button
                key={i}
                aria-label={`Voir photo ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-1 rounded-full transition-all ${
                  i === idx ? 'w-6 sm:w-8 bg-white' : 'w-2 sm:w-3 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Keyframes Ken Burns inline pour éviter de toucher tailwind config */}
      <style>{`
        @keyframes kenburns {
          0%   { transform: scale(1.05) translate3d(0, 0, 0); }
          100% { transform: scale(1.15) translate3d(-1%, -1%, 0); }
        }
      `}</style>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* COMMENT ÇA MARCHE                                                   */
/* ------------------------------------------------------------------ */
function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Décrivez votre voyage',
      desc: 'Destination, dates, voyageurs, transports, type d\'hébergement, activités et budget — en quelques clics.',
    },
    {
      n: '02',
      title: 'L\'IA construit votre programme',
      desc: 'Un itinéraire complet jour par jour avec restaurants, excursions, trajets et estimations budgétaires.',
    },
    {
      n: '03',
      title: 'Ajustez & exportez',
      desc: 'Modifiez un jour, régénérez une étape, partagez le lien ou exportez en PDF prêt à emporter.',
    },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-[0.2em] text-brand-700 font-semibold">
          Comment ça marche
        </div>
        <h2 className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
          Un voyage complet en trois étapes
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600">
          Plus de tableurs ni d'onglets ouverts. TravelO orchestre tout — vous gardez le
          contrôle créatif.
        </p>
      </div>

      <div className="mt-8 sm:mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {steps.map((s) => (
          <div
            key={s.n}
            className="relative rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 hover:border-brand-300 hover:shadow-pop transition-all"
          >
            <div className="text-4xl sm:text-5xl font-bold text-slate-100 tracking-tighter">
              {s.n}
            </div>
            <h3 className="mt-3 sm:mt-4 text-lg sm:text-xl font-semibold text-slate-900">
              {s.title}
            </h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* DESTINATIONS — Galerie inspiration                                  */
/* ------------------------------------------------------------------ */
function Destinations() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-coral-600 font-semibold">
            Inspirations
          </div>
          <h2 className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
            Des destinations qui donnent envie de partir
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-600">
            Quelques exemples — TravelO sait composer un programme sur n'importe
            quel coin du globe.
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {DESTINATIONS.map((d, i) => (
          <DestinationCard key={d.name} destination={d} featured={i === 0} />
        ))}
      </div>
    </section>
  );
}

function DestinationCard({ destination, featured }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl cursor-pointer ${
        featured
          ? 'sm:col-span-2 lg:row-span-2 aspect-[16/10] sm:aspect-[16/10] lg:aspect-[4/3]'
          : 'aspect-[4/3] sm:aspect-[4/5]'
      }`}
    >
      <img
        src={destination.src}
        alt={destination.name}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 lg:p-6 text-white">
        <div className="text-[10px] sm:text-xs uppercase tracking-widest text-white/70">
          {destination.tagline}
        </div>
        <div className="mt-1 text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
          {destination.name}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* INCLUSIONS — "tout ce que contient votre itinéraire"               */
/* ------------------------------------------------------------------ */
function Inclusions() {
  const items = [
    {
      title: 'Hébergements',
      desc: 'Hôtels, Airbnb, auberges, camping… avec gamme de prix selon votre budget.',
      icon: BedIcon,
    },
    {
      title: 'Restaurants & spécialités',
      desc: 'Adresses locales suggérées, spécialités culinaires à goûter à chaque étape.',
      icon: PlateIcon,
    },
    {
      title: 'Excursions & activités',
      desc: 'Programme horaire avec temps de visite, transitions et temps de repos.',
      icon: CompassIcon,
    },
    {
      title: 'Transports',
      desc: 'Trajets entre étapes — train, voiture, vol intérieur — avec estimations.',
      icon: TrainIcon,
    },
    {
      title: 'Budget prévisionnel',
      desc: 'Estimation détaillée par poste, par personne et total — sans surprise.',
      icon: WalletIcon,
    },
    {
      title: 'Carte interactive',
      desc: 'Visualisez chaque jour sur la carte, photos en aperçu, lien Google Maps.',
      icon: MapIcon,
    },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-[0.2em] text-sunset-600 font-semibold">
          Ce que vous obtenez
        </div>
        <h2 className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
          Un programme complet, prêt à partir
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-600">
          Tout ce qu'un tour-opérateur vous remettrait, en quelques minutes et
          totalement personnalisable.
        </p>
      </div>

      <div className="mt-8 sm:mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
        {items.map((it) => (
          <div
            key={it.title}
            className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 hover:border-slate-300 hover:shadow-sm transition-all"
          >
            <div className="inline-grid place-items-center h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-slate-900 text-white">
              <it.icon />
            </div>
            <h3 className="mt-3 sm:mt-4 font-semibold text-slate-900">{it.title}</h3>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              {it.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* LOCATION DE VOITURE — encart partenaire DiscoverCars (affilié)      */
/* ------------------------------------------------------------------ */
function CarRental() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200 bg-gradient-to-r from-brand-50 to-coral-50">
        <div className="relative px-6 sm:px-10 lg:px-14 py-10 sm:py-12 lg:py-14 grid lg:grid-cols-2 items-center gap-8">
          <div className="max-w-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-brand-700 font-semibold">
              Sur la route
            </div>
            <h2 className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
              Louez une voiture pour votre voyage
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
              Comparez les loueurs dans plus de 145 pays et réservez au meilleur
              prix avec notre partenaire DiscoverCars — annulation gratuite sur la
              plupart des offres. Indiquez votre ville et vos dates ci-contre.
            </p>
          </div>
          <div className="w-full">
            <DiscoverCarsWidget />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* CTA FINAL — Image + dégradé                                        */
/* ------------------------------------------------------------------ */
function FinalCTA({ user, isApproved }) {
  const cta =
    user && isApproved ? (
      <Link to="/creer" className="btn-hero">
        Créer mon itinéraire
      </Link>
    ) : !user ? (
      <Link to="/inscription" className="btn-hero">
        Commencer gratuitement
      </Link>
    ) : (
      <Link to="/compte-en-attente" className="btn-hero">
        Voir mon compte
      </Link>
    );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl">
        <img
          src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2000&q=80"
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/75 to-slate-900/40" />

        <div className="relative px-6 sm:px-10 lg:px-16 py-14 sm:py-20 lg:py-28 text-white max-w-2xl">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
            Prêt à composer votre prochain voyage&nbsp;?
          </h2>
          <p className="mt-4 sm:mt-5 text-sm sm:text-base lg:text-lg text-white/85 leading-relaxed">
            Quelques minutes suffisent pour obtenir un itinéraire détaillé,
            modifiable et exportable. Aucun forfait, aucune carte bancaire requise.
          </p>
          <div className="mt-6 sm:mt-8">{cta}</div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ICÔNES SVG (inline, légères)                                        */
/* ------------------------------------------------------------------ */
const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function BedIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
      <path d="M2 16h20" />
      <path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
    </svg>
  );
}
function PlateIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
function CompassIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16 8 14 14 8 16 10 10 16 8" />
    </svg>
  );
}
function TrainIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="3" width="16" height="16" rx="2" />
      <path d="M4 11h16" />
      <path d="M8 19l-2 3" />
      <path d="M16 19l2 3" />
      <circle cx="9" cy="15" r="0.5" fill="currentColor" />
      <circle cx="15" cy="15" r="0.5" fill="currentColor" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 7a2 2 0 0 1 2-2h14v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h12" />
      <circle cx="17" cy="13" r="1" fill="currentColor" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}
