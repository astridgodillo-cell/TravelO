import { useEffect, useState } from 'react';

const STEPS = [
  'Analyse de vos préférences…',
  'Sélection des étapes et de l\'ordre du circuit…',
  'Choix des hébergements selon votre budget…',
  'Construction des journées matin / midi / après-midi / soir…',
  'Estimation des trajets et de la météo…',
  'Rédaction immersive des excursions…',
  'Calcul du budget global et des conseils pratiques…',
];

export default function GeneratingLoader() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      4500
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card text-center py-12">
      <div className="mx-auto h-12 w-12 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
      <h2 className="mt-6 text-lg font-semibold text-slate-900">
        Claude rédige votre itinéraire
      </h2>
      <p className="mt-2 text-slate-600 transition-all">{STEPS[step]}</p>
      <p className="mt-4 text-xs text-slate-400">
        Cette opération prend généralement 30 à 90 secondes.
      </p>
    </div>
  );
}
