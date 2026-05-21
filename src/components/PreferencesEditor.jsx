// Éditeur de préférences "durables" (sans destinations/dates/lieux propres
// à un trip). Utilisé par ProfilePage (persona par défaut + personas) et
// par OnboardingWizard. La version "trip" complète reste dans PreferencesForm.

import {
  TRIP_TYPES,
  MOTORIZED_TRIP_TYPES,
  ROAD_TRIP_TYPES,
  INTERESTS,
  SPECIFIC_ACTIVITIES,
  BUDGET_LEVELS,
  VEHICLE_TYPES,
  FUEL_TYPES,
  NIGHT_STAY_OPTIONS,
  COOKING_OPTIONS,
  suggestStayPrefs,
} from '../lib/preferenceOptions';

export default function PreferencesEditor({ values, onChange, compact }) {
  const isRoadTrip = ROAD_TRIP_TYPES.has(values.tripType);
  const isMotorized = MOTORIZED_TRIP_TYPES.has(values.tripType);
  const isRental = values.tripType === 'avion-voiture';

  function update(field, value) {
    onChange({ ...values, [field]: value });
  }
  function updateVehicle(field, value) {
    onChange({
      ...values,
      vehicle: { ...(values.vehicle || {}), [field]: value },
    });
  }
  function toggle(field, value) {
    const arr = values[field] || [];
    onChange({
      ...values,
      [field]: arr.includes(value)
        ? arr.filter((x) => x !== value)
        : [...arr, value],
    });
  }
  function pickVehicleType(typeId) {
    const preset = VEHICLE_TYPES.find((t) => t.id === typeId);
    if (!preset) return;
    onChange({
      ...values,
      vehicle: {
        type: preset.id,
        height: values.vehicle?.height || preset.height,
        length: values.vehicle?.length || preset.length,
        fuel: preset.fuel,
        consumption: values.vehicle?.consumption || preset.consumption,
      },
      nightStayPreferences:
        values.nightStayPreferences?.length &&
        values.nightStayPreferences[0] !== 'Hôtel'
          ? values.nightStayPreferences
          : suggestStayPrefs(preset.id),
      cooking:
        preset.id.includes('van') ||
        preset.id.includes('cc-') ||
        preset.id.includes('fourgon')
          ? 'mix'
          : values.cooking,
      needsServicePoints:
        preset.id.includes('van') ||
        preset.id.includes('cc-') ||
        preset.id.includes('fourgon'),
    });
  }

  return (
    <div className="space-y-6">
      <Section title="Type de voyage préféré">
        <ChipMultiSelect
          options={TRIP_TYPES}
          selected={[values.tripType]}
          onToggle={(id) => update('tripType', id)}
        />
      </Section>

      {isMotorized && !compact && (
        <Section title={isRental ? 'Voiture de location' : 'Véhicule'}>
          <div className="space-y-3">
            <ChipMultiSelect
              options={VEHICLE_TYPES}
              selected={[values.vehicle?.type]}
              onToggle={(id) => pickVehicleType(id)}
              small
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Hauteur (m)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={values.vehicle?.height || ''}
                  onChange={(e) =>
                    updateVehicle('height', Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label className="label">Longueur (m)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={values.vehicle?.length || ''}
                  onChange={(e) =>
                    updateVehicle('length', Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label className="label">Carburant</label>
                <select
                  className="input"
                  value={values.vehicle?.fuel || 'diesel'}
                  onChange={(e) => updateVehicle('fuel', e.target.value)}
                >
                  {FUEL_TYPES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Conso (L/100 km)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  value={values.vehicle?.consumption || ''}
                  onChange={(e) =>
                    updateVehicle('consumption', Number(e.target.value))
                  }
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Centres d'intérêt">
        <ChipMultiSelect
          options={INTERESTS.map((i) => ({ id: i, label: i }))}
          selected={values.interests || []}
          onToggle={(v) => toggle('interests', v)}
          capitalize
        />
      </Section>

      {!compact && (
        <Section title="Activités spécifiques">
          <ChipMultiSelect
            options={SPECIFIC_ACTIVITIES}
            selected={values.specificActivities || []}
            onToggle={(v) => toggle('specificActivities', v)}
            small
          />
        </Section>
      )}

      {!compact && (
        <Section title="Hébergement nocturne préféré">
          <ChipMultiSelect
            options={NIGHT_STAY_OPTIONS.map((o) => ({ id: o, label: o }))}
            selected={values.nightStayPreferences || []}
            onToggle={(v) => toggle('nightStayPreferences', v)}
            small
          />
        </Section>
      )}

      {isRoadTrip && !compact && (
        <Section title="Vie pratique en road trip">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Repas</label>
              <div className="space-y-2">
                {COOKING_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="cooking-pref"
                      checked={values.cooking === opt.id}
                      onChange={() => update('cooking', opt.id)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!values.needsServicePoints}
                  onChange={(e) =>
                    update('needsServicePoints', e.target.checked)
                  }
                />
                Prévoir aires de service
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={values.okWithFerry !== false}
                  onChange={(e) => update('okWithFerry', e.target.checked)}
                />
                OK avec les traversées en ferry
              </label>
            </div>
          </div>
        </Section>
      )}

      <Section title="Niveau de budget préféré">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BUDGET_LEVELS.map((b) => {
            const active = values.budget === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => update('budget', b.id)}
                className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChipMultiSelect({ options, selected, onToggle, small, capitalize }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = (selected || []).includes(opt.id);
        const sizeCls = small
          ? 'px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-sm'
          : 'px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm';
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onToggle(opt.id)}
            className={`rounded-full border transition-colors ${sizeCls} ${
              capitalize ? 'capitalize' : ''
            } ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
