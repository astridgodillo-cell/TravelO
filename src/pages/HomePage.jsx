import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function HomePage() {
  const { user, profile, isApproved, loading } = useAuth();
  const showOnboardingBanner =
    user && isApproved && profile && !profile.onboarding_completed;

  let primaryCta;
  let secondaryCta = null;

  if (loading) {
    primaryCta = (
      <span className="btn-pop opacity-50 cursor-default">Chargement…</span>
    );
  } else if (!user) {
    primaryCta = (
      <Link to="/inscription" className="btn-pop text-base">
        ✨ Créer un compte gratuit
      </Link>
    );
    secondaryCta = (
      <Link to="/connexion" className="btn-secondary text-base">
        J'ai déjà un compte
      </Link>
    );
  } else if (!isApproved) {
    primaryCta = (
      <Link to="/compte-en-attente" className="btn-primary text-base">
        Voir l'état de mon compte
      </Link>
    );
  } else {
    primaryCta = (
      <Link to="/nouveau" className="btn-pop text-base">
        🚀 Créer mon itinéraire
      </Link>
    );
    secondaryCta = (
      <Link to="/mes-voyages" className="btn-secondary text-base">
        Mes voyages
      </Link>
    );
  }

  return (
    <div className="space-y-16">
      {showOnboardingBanner && (
        <div className="rounded-2xl border-2 border-brand-300 bg-gradient-to-r from-brand-50 to-coral-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-up">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">
              👋 Bienvenue ! Configure ton profil en 3 étapes
            </h3>
            <p className="text-sm text-slate-600 mt-0.5">
              Tes futurs itinéraires seront pré-remplis automatiquement (préférences,
              voyageurs, contraintes…).
            </p>
          </div>
          <Link to="/bienvenue" className="btn-primary shrink-0">
            Commencer →
          </Link>
        </div>
      )}

      {/* Hero coloré */}
      <section className="relative overflow-hidden rounded-3xl bg-hero-gradient text-white px-6 sm:px-12 py-16 sm:py-20 shadow-glow animate-fade-up text-center">
        <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-10 w-96 h-96 rounded-full bg-sunset-400/30 blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-1 text-xs uppercase tracking-widest bg-white/20 backdrop-blur rounded-full px-3 py-1">
            ✨ Itinéraires détaillés à la carte
          </span>
          <h1 className="mt-5 text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
            Votre voyage,
            <br />
            <span className="text-white/95 italic">comme un tour-opérateur</span>
          </h1>
          <p className="mt-5 text-lg text-white/90 max-w-2xl mx-auto">
            TravelO génère pour vous un programme jour par jour : hébergements,
            restaurants, excursions, transports et budget prévisionnel — avec
            photos, spécialités culinaires et carte interactive.
          </p>

          {!user && !loading && (
            <p className="mt-3 text-sm text-white/75">
              🔒 Accès sur invitation — un administrateur valide votre inscription.
            </p>
          )}

          <div className="mt-8 flex flex-col sm:flex-row sm:justify-center items-stretch sm:items-center gap-2 sm:gap-3">
            {primaryCta}
            {secondaryCta}
          </div>
        </div>
      </section>

      {/* Features colorées */}
      <section className="grid md:grid-cols-3 gap-4">
        <Feature
          color="brand"
          icon="🎯"
          title="Préférences sur mesure"
          desc="Dates, voyageurs, transports, hébergement, activités, budget — tout est paramétrable."
        />
        <Feature
          color="coral"
          icon="🗺️"
          title="Programme complet"
          desc="Repas, excursions, temps de repos, trajets entre étapes — prêts à l'emploi."
        />
        <Feature
          color="sunset"
          icon="💰"
          title="Budget maîtrisé"
          desc="Estimation détaillée par poste avec total par personne et par voyage."
        />
      </section>

      {/* Showcase */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Showcase emoji="🚐" label="Road trip van" />
        <Showcase emoji="🏖️" label="Séjour plage" />
        <Showcase emoji="🥾" label="Trek montagne" />
        <Showcase emoji="🏛️" label="Circuit culture" />
      </section>
    </div>
  );
}

const colorMap = {
  brand: {
    bg: 'bg-brand-50',
    text: 'text-brand-700',
    badge: 'bg-brand-600',
  },
  coral: {
    bg: 'bg-coral-50',
    text: 'text-coral-700',
    badge: 'bg-coral-500',
  },
  sunset: {
    bg: 'bg-sunset-50',
    text: 'text-sunset-700',
    badge: 'bg-sunset-500',
  },
};

function Feature({ color, icon, title, desc }) {
  const c = colorMap[color] || colorMap.brand;
  return (
    <div className="card hover:-translate-y-0.5 transition-transform">
      <div
        className={`inline-grid place-items-center h-12 w-12 rounded-2xl ${c.badge} text-white text-2xl shadow-pop`}
      >
        {icon}
      </div>
      <h3 className="font-semibold text-slate-900 mt-4">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{desc}</p>
    </div>
  );
}

function Showcase({ emoji, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 hover:border-brand-300 hover:shadow-pop transition-all">
      <span className="text-2xl">{emoji}</span>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </div>
  );
}
