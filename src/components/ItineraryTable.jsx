const formatEur = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
    : '—';

function shortText(s, max = 90) {
  if (!s) return '—';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function dayDescription(day) {
  const lines = [];
  if (day.location) lines.push(day.location);
  if (day.trips?.length) {
    const totalKm = day.trips.reduce((s, t) => s + (t.distance_km || 0), 0);
    const fuel = day.trips.reduce((s, t) => s + (t.fuel_cost_eur || 0), 0);
    const tolls = day.trips.reduce((s, t) => s + (t.toll_cost_eur || 0), 0);
    if (totalKm > 0) {
      const bits = [`Trajet ${totalKm} km`];
      if (fuel > 0) bits.push(`carburant ${formatEur(fuel)}`);
      if (tolls > 0) bits.push(`péages ${formatEur(tolls)}`);
      lines.push(bits.join(' · '));
    }
  }
  return lines.join('\n');
}

function tripsTotalEur(day) {
  return (day.trips || []).reduce(
    (s, t) => s + (t.estimated_cost_eur || 0),
    0
  );
}

function activitiesTotalEur(day) {
  return (day.activities || []).reduce(
    (s, a) => s + (a.family_total_eur || 0),
    0
  );
}

export default function ItineraryTable({ days }) {
  if (!days?.length) return null;

  return (
    <section className="card p-0 overflow-x-auto">
      <table className="w-full text-xs min-w-[1200px]">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 sticky top-0">
          <tr>
            <Th>Date</Th>
            <Th>Jour</Th>
            <Th>Matin</Th>
            <Th>Midi</Th>
            <Th>Après-midi</Th>
            <Th>Soir</Th>
            <Th>Hébergement</Th>
            <Th className="text-right">Trajet €</Th>
            <Th className="text-right">Excursion €</Th>
            <Th className="text-right">Repas €</Th>
            <Th className="text-right">Total jour €</Th>
            <Th>Description</Th>
            <Th className="text-center">Météo</Th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr
              key={d.label}
              className="border-t border-slate-100 align-top hover:bg-slate-50/60"
            >
              <Td className="whitespace-nowrap font-medium">{d.date}</Td>
              <Td className="whitespace-nowrap">
                {d.label}
                {d.weekday && (
                  <div className="text-[10px] text-slate-400 capitalize">
                    {d.weekday}
                  </div>
                )}
              </Td>
              <Td>{shortText(d.morning?.title)}</Td>
              <Td>{shortText(d.noon?.title)}</Td>
              <Td>{shortText(d.afternoon?.title)}</Td>
              <Td>{shortText(d.evening?.title)}</Td>
              <Td>
                {d.accommodation?.type ? (
                  <div className="text-slate-700 truncate max-w-[160px]">
                    {d.accommodation.type}
                    {d.accommodation.price_eur > 0 && (
                      <span className="text-slate-400">
                        {' · '}
                        {formatEur(d.accommodation.price_eur)}
                      </span>
                    )}
                  </div>
                ) : (
                  '—'
                )}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatEur(tripsTotalEur(d))}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatEur(activitiesTotalEur(d))}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatEur(d.meals?.daily_family_budget_eur)}
              </Td>
              <Td className="text-right font-bold tabular-nums text-slate-900">
                {formatEur(d.day_total_eur)}
              </Td>
              <Td className="text-slate-600 whitespace-pre-line">
                {dayDescription(d)}
              </Td>
              <Td className="text-center whitespace-nowrap">
                {d.weather ? (
                  <span>
                    <span className="text-base">{d.weather.emoji}</span>{' '}
                    {d.weather.temperature_c}°C
                  </span>
                ) : (
                  '—'
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Th({ children, className = '' }) {
  return (
    <th className={`text-left px-3 py-2 font-medium ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
