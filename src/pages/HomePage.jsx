import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="space-y-16">
      <section className="text-center pt-12 pb-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          Nouveau · Itinéraires détaillés à la carte
        </div>
        <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          Votre voyage, planifié comme par un tour opérateur.
        </h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          TravelO génère pour vous un programme jour par jour : hébergements,
          restaurants, excursions, transports et budget prévisionnel.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/nouveau" className="btn-primary text-base px-5 py-2.5">
            Créer mon itinéraire
          </Link>
          <Link to="/inscription" className="btn-secondary text-base px-5 py-2.5">
            Créer un compte
          </Link>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <Feature
          title="Préférences sur mesure"
          desc="Dates, voyageurs, transports, hébergement, activités, budget — tout est paramétrable."
        />
        <Feature
          title="Programme complet"
          desc="Repas, excursions, temps de repos et trajets entre étapes, prêts à l'emploi."
        />
        <Feature
          title="Budget maîtrisé"
          desc="Estimation détaillée par poste avec total par personne et par voyage."
        />
      </section>
    </div>
  );
}

function Feature({ title, desc }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{desc}</p>
    </div>
  );
}
