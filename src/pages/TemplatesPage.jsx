import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTemplateItineraries } from '../lib/supabase';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let active = true;
    listTemplateItineraries().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else setTemplates(data || []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    for (const t of templates) {
      if (t.template_category) set.add(t.template_category);
    }
    return Array.from(set).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    if (filter === 'all') return templates;
    return templates.filter((t) => t.template_category === filter);
  }, [templates, filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          📘 Modèles de voyage
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Inspirez-vous de ces itinéraires proposés par l'équipe TravelO pour
          créer le vôtre.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : templates.length === 0 ? (
        <div className="card text-center text-slate-500">
          Aucun modèle pour l'instant. L'équipe TravelO en proposera bientôt.
        </div>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Chip
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                Tous ({templates.length})
              </Chip>
              {categories.map((c) => (
                <Chip
                  key={c}
                  active={filter === c}
                  onClick={() => setFilter(c)}
                >
                  {c}
                </Chip>
              ))}
            </div>
          )}

          <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
              <li key={t.id} className="card hover:-translate-y-0.5 transition-transform">
                <div className="flex items-start justify-between gap-2 mb-2">
                  {t.template_category && (
                    <span className="chip bg-purple-100 text-purple-700">
                      {t.template_category}
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    {t.itinerary?.summary?.duration_days} j
                  </span>
                </div>
                <h2 className="font-bold text-slate-900">{t.title}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {t.itinerary?.summary?.destinations}
                </p>
                {t.itinerary?.summary?.headline && (
                  <p className="text-sm text-slate-600 mt-2 italic line-clamp-3">
                    "{t.itinerary.summary.headline}"
                  </p>
                )}
                {t.template_description && (
                  <p className="text-sm text-slate-700 mt-2">
                    {t.template_description}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-slate-400 capitalize">
                    {t.itinerary?.summary?.trip_type}
                  </span>
                  <Link
                    to={`/modele/${t.id}`}
                    className="text-brand-700 font-medium hover:underline"
                  >
                    Voir le modèle →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
