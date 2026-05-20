export default function GeneratingLoader({ progress }) {
  const phase = progress?.phase;
  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;

  let title = 'Un instant, nous préparons votre voyage…';
  let detail = 'Préparation…';
  let percent = null;

  if (phase === 'generating') {
    detail = 'Nous composons votre itinéraire complet, c\'est bientôt prêt.';
  } else if (phase === 'planning') {
    title = 'Étape 1/2 — Nous traçons les grandes lignes';
    detail =
      'On dessine l\'ossature du voyage : les étapes, les lieux et la cohérence du trajet.';
  } else if (phase === 'expanding') {
    title = 'Étape 2/2 — Nous détaillons chaque journée';
    detail = `Rédaction des journées (${current}/${total}) — en parallèle pour aller plus vite.`;
    percent = total > 0 ? Math.round((current / total) * 100) : 0;
  } else if (phase === 'assembling') {
    title = 'Finalisation';
    detail = 'Calcul du budget, assemblage de l\'itinéraire complet…';
  }

  return (
    <div className="card text-center py-12 space-y-4">
      <div className="mx-auto h-12 w-12 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-slate-600">{detail}</p>

      {percent != null && (
        <div className="max-w-md mx-auto">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-500">{percent}%</div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        {phase === 'expanding'
          ? 'Pour les longs voyages, comptez environ 30 à 60 secondes au total.'
          : 'Cette opération prend généralement entre 20 secondes et 1 minute.'}
      </p>
    </div>
  );
}
