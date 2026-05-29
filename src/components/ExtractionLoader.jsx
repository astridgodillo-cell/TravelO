// Loader clair et animé pendant que l'IA déchiffre une capture (vol ou hôtel).
// L'extraction lit l'image PLUSIEURS fois (consensus) → ça prend quelques
// secondes, donc on affiche un vrai spinner + ce qui est en cours d'extraction.
export default function ExtractionLoader({
  title = "L'IA lit ta capture…",
  subtitle,
  imageUrl,
  accent = 'brand', // 'brand' | 'sky' | 'indigo'
}) {
  const ring =
    accent === 'sky'
      ? 'border-sky-200 border-t-sky-600'
      : accent === 'indigo'
        ? 'border-indigo-200 border-t-indigo-600'
        : 'border-slate-200 border-t-brand-600';
  return (
    <div className="py-8 text-center">
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Capture en cours d'analyse"
          className="mx-auto max-h-44 rounded-lg shadow-sm mb-4 object-contain"
        />
      )}
      <div
        className={`mx-auto h-10 w-10 rounded-full border-4 ${ring} animate-spin`}
        role="status"
        aria-label="Analyse en cours"
      />
      <div className="mt-3 text-sm font-semibold text-slate-800">{title}</div>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      <p className="text-[11px] text-slate-400 mt-2">
        🔍 Lecture vérifiée plusieurs fois pour plus de précision…
      </p>
    </div>
  );
}
