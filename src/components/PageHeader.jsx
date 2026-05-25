/**
 * En-tête de page standardisé pour toutes les pages intérieures.
 * Adopte le style éditorial introduit sur la HomePage :
 *   - eyebrow uppercase tracking-widest avec couleur d'accent
 *   - titre font-bold tracking-tight
 *   - description optionnelle
 *   - bandeau photo optionnel (h-48) en arrière-plan
 *   - slot "action" à droite (CTA, bouton…)
 *
 * Exemple :
 *   <PageHeader
 *     eyebrow="Mes voyages"
 *     eyebrowColor="brand"
 *     title="Tous vos itinéraires"
 *     description="Modifiez, partagez ou supprimez les voyages générés."
 *     action={<Link className="btn-primary">+ Nouveau</Link>}
 *   />
 */

const EYEBROW_COLORS = {
  brand: 'text-brand-700',
  coral: 'text-coral-600',
  sunset: 'text-sunset-600',
  slate: 'text-slate-500',
  emerald: 'text-emerald-700',
};

export default function PageHeader({
  eyebrow,
  eyebrowColor = 'brand',
  title,
  description,
  action,
  banner,
  bannerOverlay = true,
}) {
  const colorClass = EYEBROW_COLORS[eyebrowColor] || EYEBROW_COLORS.brand;

  if (banner) {
    return (
      <header className="relative overflow-hidden rounded-2xl sm:rounded-3xl h-36 sm:h-48 lg:h-60 mb-5 sm:mb-8">
        <img
          src={banner}
          alt=""
          loading="eager"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {bannerOverlay && (
          <>
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/55 to-slate-900/20" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </>
        )}
        <div className="relative h-full max-w-5xl px-5 sm:px-8 lg:px-10 flex flex-col justify-end pb-5 sm:pb-6 text-white">
          {eyebrow && (
            <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-white/90">
              {eyebrow}
            </div>
          )}
          <div className="mt-1.5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight drop-shadow-md">
                {title}
              </h1>
              {description && (
                <p className="mt-1.5 text-sm sm:text-base text-white/85 max-w-2xl">
                  {description}
                </p>
              )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <div
            className={`text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold ${colorClass}`}
          >
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
