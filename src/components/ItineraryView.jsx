export default function ItineraryView({ itinerary }) {
  if (!itinerary) return null;
  const { summary, program, budget } = itinerary;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="text-xl font-semibold text-slate-900">Résumé du voyage</h2>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Info label="Destinations" value={(summary?.destinations || []).join(', ')} />
          <Info label="Du" value={summary?.start_date} />
          <Info label="Au" value={summary?.end_date} />
          <Info label="Durée" value={`${summary?.days} jours`} />
          <Info label="Voyageurs" value={summary?.travellers} />
          <Info label="Transport" value={summary?.transport} />
          <Info label="Hébergement" value={summary?.accommodation} />
          <Info label="Activités" value={(summary?.activities || []).join(', ')} />
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold text-slate-900">Budget prévisionnel</h2>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Info
            label="Par personne"
            value={`${budget?.per_person?.toLocaleString('fr-FR')} ${budget?.currency || '€'}`}
          />
          <Info
            label="Total estimé"
            value={`${budget?.total_estimate?.toLocaleString('fr-FR')} ${budget?.currency || '€'}`}
          />
          {budget?.indicative_input ? (
            <Info
              label="Budget indiqué"
              value={`${budget.indicative_input.toLocaleString('fr-FR')} ${budget.currency || '€'}`}
            />
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Programme jour par jour</h2>
        {program?.map((day) => (
          <article key={day.day} className="card">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-slate-900">
                Jour {day.day} — {day.location}
              </h3>
              <span className="text-sm text-slate-500">{day.date}</span>
            </header>

            <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
              <Block title="Hébergement">
                <div>{day.accommodation?.name}</div>
                <div className="text-slate-500">
                  {day.accommodation?.type} —{' '}
                  {day.accommodation?.price_per_night} € / nuit
                </div>
              </Block>

              <Block title="Transport">
                <div>{day.transport?.mode}</div>
                <div className="text-slate-500">
                  {day.transport?.note} — {day.transport?.price} €
                </div>
              </Block>

              <Block title="Repas">
                <ul className="space-y-1">
                  {day.meals?.map((m, i) => (
                    <li key={i}>
                      <span className="font-medium">{m.name}</span> —{' '}
                      <span className="text-slate-500">
                        {m.suggestion} ({m.price} €)
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>

              <Block title="Activités">
                <ul className="space-y-1">
                  {day.activities?.map((a, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs text-slate-500">
                        {a.time}
                      </span>{' '}
                      — {a.title}{' '}
                      <span className="text-slate-400">
                        ({a.duration}, {a.price} €)
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>

              {day.rest_time && (
                <Block title="Temps de repos">
                  <div>{day.rest_time}</div>
                </Block>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium text-slate-800">{value || '—'}</div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {title}
      </div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}
