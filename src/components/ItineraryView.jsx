import { useMemo, useState } from 'react';

const TABS = [
  { id: 'planning', label: 'Planning' },
  { id: 'budget', label: 'Budget global' },
  { id: 'notes', label: 'Notes & Conseils' },
  { id: 'activities', label: 'Fiches activités' },
];

const formatEur = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
    : '—';

export default function ItineraryView({ itinerary }) {
  const [tab, setTab] = useState('planning');

  const allActivities = useMemo(() => {
    if (!itinerary?.days) return [];
    return itinerary.days.flatMap((d) =>
      (d.activities || []).map((a) => ({ ...a, day: d.label, date: d.date }))
    );
  }, [itinerary]);

  if (!itinerary) return null;
  const { summary, days, budget_summary, notes } = itinerary;

  return (
    <div className="space-y-6">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {summary?.destinations}
            </h1>
            {summary?.headline && (
              <p className="text-slate-600 mt-1 italic">"{summary.headline}"</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Budget total estimé
            </div>
            <div className="text-2xl font-bold text-brand-700">
              {formatEur(budget_summary?.grand_total_eur)}
            </div>
            <div className="text-xs text-slate-500">
              soit {formatEur(budget_summary?.per_person_eur)} / personne
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Du" value={summary?.start_date} />
          <Info label="Au" value={summary?.end_date} />
          <Info label="Durée" value={`${summary?.duration_days} jours`} />
          <Info
            label="Voyageurs"
            value={`${summary?.travellers?.adults} adulte(s)${
              summary?.travellers?.children_ages?.length
                ? ` + ${summary.travellers.children_ages.length} enfant(s)`
                : ''
            }`}
          />
          <Info label="Type" value={summary?.trip_type} />
          <Info label="Niveau" value={summary?.budget_level} />
          <Info label="Départ" value={summary?.departure_location} />
          <Info label="Retour" value={summary?.return_location} />
        </div>
      </header>

      <nav className="print:hidden">
        <ul className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="print:space-y-8">
        {(tab === 'planning' || true) && (
          <div className={tab === 'planning' ? '' : 'hidden print:block'}>
            <Planning days={days} />
          </div>
        )}
        {(tab === 'budget' || true) && (
          <div className={tab === 'budget' ? '' : 'hidden print:block'}>
            <BudgetGlobal budget={budget_summary} />
          </div>
        )}
        {(tab === 'notes' || true) && (
          <div className={tab === 'notes' ? '' : 'hidden print:block'}>
            <NotesConseils notes={notes} />
          </div>
        )}
        {(tab === 'activities' || true) && (
          <div className={tab === 'activities' ? '' : 'hidden print:block'}>
            <FichesActivites activities={allActivities} />
          </div>
        )}
      </div>
    </div>
  );
}

function Planning({ days }) {
  if (!days?.length) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 print:break-before-page">
        Programme jour par jour
      </h2>
      {days.map((d) => (
        <DayCard key={d.label} day={d} />
      ))}
    </section>
  );
}

function DayCard({ day }) {
  return (
    <article className="card print:break-inside-avoid print:shadow-none print:border-slate-300">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            {day.label} — {day.location}
          </h3>
          <p className="text-sm text-slate-500 capitalize">
            {day.weekday} {day.date}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {day.weather && (
            <div className="text-sm text-slate-600">
              <span className="text-lg mr-1">{day.weather.emoji}</span>
              {day.weather.temperature_c}°C
              {day.weather.description && (
                <span className="text-slate-400 ml-1">
                  · {day.weather.description}
                </span>
              )}
            </div>
          )}
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Total jour
            </div>
            <div className="font-bold text-slate-900">
              {formatEur(day.day_total_eur)}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <Moment label="Matin" m={day.morning} />
        <Moment label="Midi" m={day.noon} />
        <Moment label="Après-midi" m={day.afternoon} />
        <Moment label="Soir" m={day.evening} />
      </div>

      {day.activities?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Activités & excursions
          </h4>
          <ul className="space-y-2">
            {day.activities.map((a, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-800">{a.title}</div>
                    <div className="text-xs text-slate-500">
                      {a.schedule}
                      {a.duration ? ` · ${a.duration}` : ''}
                    </div>
                    {a.description && (
                      <p className="text-slate-600 mt-1">{a.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-slate-500">
                      {formatEur(a.price_per_person_eur)} / pers.
                    </div>
                    <div className="font-semibold text-slate-800">
                      Famille : {formatEur(a.family_total_eur)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {day.trips?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Trajets
          </h4>
          <ul className="space-y-2 text-sm">
            {day.trips.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-100 bg-white p-3"
              >
                <div>
                  <span className="font-medium">
                    {t.from} → {t.to}
                  </span>
                  <span className="text-slate-500 ml-2">
                    {t.distance_km} km · {t.duration} · {t.mode}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-semibold">
                    {formatEur(t.estimated_cost_eur)}
                  </div>
                  {t.cost_note && (
                    <div className="text-xs text-slate-400">{t.cost_note}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {day.accommodation && (
          <Block title="Hébergement du soir">
            <div className="font-medium text-slate-800">
              {day.accommodation.name}
            </div>
            <div className="text-slate-500">
              {day.accommodation.type} —{' '}
              {formatEur(day.accommodation.price_eur)} / nuit
            </div>
            {day.accommodation.note && (
              <div className="text-slate-400 italic mt-1">
                {day.accommodation.note}
              </div>
            )}
          </Block>
        )}
        {day.meals && (
          <Block title="Repas (famille)">
            <div className="font-medium text-slate-800">
              {formatEur(day.meals.daily_family_budget_eur)} / jour
            </div>
            {day.meals.note && (
              <div className="text-slate-500 mt-1">{day.meals.note}</div>
            )}
          </Block>
        )}
      </div>
    </article>
  );
}

function Moment({ label, m }) {
  if (!m) return null;
  return (
    <div className="rounded-lg border border-slate-100 p-3 bg-white">
      <div className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
        {label}
      </div>
      <div className="text-slate-800 font-medium mt-1">{m.title}</div>
      {m.description && (
        <p className="text-sm text-slate-600 mt-1">{m.description}</p>
      )}
    </div>
  );
}

function BudgetGlobal({ budget }) {
  if (!budget) return null;
  const rows = [
    ['Trajets', budget.trips_eur],
    ['Hébergements', budget.accommodation_eur],
    ['Repas', budget.meals_eur],
    ['Excursions & activités', budget.activities_eur],
  ];
  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-slate-900">
        Récapitulatif budget global
      </h2>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-slate-100 last:border-0">
              <td className="py-2 text-slate-600">{label}</td>
              <td className="py-2 text-right font-medium">
                {formatEur(value)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200">
            <td className="py-3 font-semibold text-slate-900">Grand total</td>
            <td className="py-3 text-right text-lg font-bold text-brand-700">
              {formatEur(budget.grand_total_eur)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-sm text-slate-500">Par personne</td>
            <td className="py-1 text-right text-slate-700">
              {formatEur(budget.per_person_eur)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function NotesConseils({ notes }) {
  if (!notes) return null;
  return (
    <section className="card space-y-5">
      <h2 className="text-xl font-semibold text-slate-900">Notes & Conseils</h2>

      {notes.visa_and_documents && (
        <NoteBlock title="Visa & documents">
          {notes.visa_and_documents}
        </NoteBlock>
      )}
      {notes.climate_and_packing && (
        <NoteBlock title="Climat & bagages">
          {notes.climate_and_packing}
        </NoteBlock>
      )}
      {notes.useful_apps?.length > 0 && (
        <NoteBlock title="Applications utiles">
          <ul className="list-disc list-inside text-slate-700">
            {notes.useful_apps.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </NoteBlock>
      )}
      {notes.practical_tips?.length > 0 && (
        <NoteBlock title="Conseils pratiques">
          <ul className="list-disc list-inside text-slate-700">
            {notes.practical_tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </NoteBlock>
      )}
    </section>
  );
}

function FichesActivites({ activities }) {
  if (!activities?.length)
    return (
      <section className="card text-slate-500">
        Aucune activité détaillée n'a été générée.
      </section>
    );
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">
        Fiches détaillées des activités
      </h2>
      {activities.map((a, i) => (
        <article key={i} className="card print:break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{a.title}</h3>
            <span className="text-xs text-slate-400">
              {a.day} · {a.date}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {a.schedule}
            {a.duration ? ` · ${a.duration}` : ''}
          </div>
          <p className="mt-3 text-slate-700 leading-relaxed">
            {a.immersive_description || a.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="text-slate-500">
              {formatEur(a.price_per_person_eur)} / personne
            </span>
            <span className="font-semibold text-slate-800">
              Total famille : {formatEur(a.family_total_eur)}
            </span>
          </div>
        </article>
      ))}
    </section>
  );
}

function NoteBlock({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="mt-1 text-slate-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="font-medium text-slate-800 capitalize">
        {value || '—'}
      </div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {title}
      </div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}
