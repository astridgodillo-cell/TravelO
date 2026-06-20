import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { parseBrief, generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Création d'un voyage à partir d'une description libre (comme avec l'agent),
// directement dans TravelO : texte → préférences → itinéraire → enregistrement.
// Route : /creer-ia
export default function CreateWithAiPage() {
  const navigate = useNavigate();
  const { user, isApproved } = useAuth();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (!user) return navigate('/connexion');
    if (!isApproved) return navigate('/compte-en-attente');
    setError(null);
    setBusy(true);
    try {
      setStatus('Analyse de ta description…');
      const prefs = await parseBrief(brief);

      setStatus('Création de ton itinéraire…');
      const itinerary = await generateItinerary(prefs, (p) => {
        if (p?.phase === 'expanding' && p.total) {
          setStatus(`Rédaction des journées… ${p.current}/${p.total}`);
        }
      });

      const title =
        (prefs?.destinations || 'Voyage').slice(0, 80) +
        ` — ${itinerary?.summary?.duration_days || ''}j`;

      setStatus('Enregistrement…');
      const { data, error: dbError } = await saveItinerary({
        title,
        preferences: prefs,
        itinerary,
      });
      if (dbError) throw new Error(dbError.message);

      navigate(`/itineraire/${data.id}`, { state: { justCreated: true } });
    } catch (e) {
      setError(e.message || 'Erreur lors de la création.');
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link to="/mes-voyages" className="text-sm text-brand-700 underline">
        ← Mes voyages
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
        ✨ Créer un voyage avec l'IA
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Décris ton voyage en quelques phrases, comme tu le dirais à un ami.
        TravelO comprend, génère l'itinéraire complet, ajoute les photos — et tu
        pourras imprimer la brochure.
      </p>

      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        disabled={busy}
        placeholder={
          'Ex. : Road trip en van de 10 jours en Toscane début septembre, 2 adultes et 1 enfant de 8 ans, budget moyen, on aime la nature, la gastronomie et les villages perchés. Départ de Marseille.'
        }
        className="mt-4 h-44 w-full resize-y rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50"
      />

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {busy && status && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
          {status}
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={busy || brief.trim().length < 10}
        className="btn-primary mt-4 w-full sm:w-auto disabled:opacity-50"
      >
        {busy ? 'Création en cours…' : '✨ Créer mon voyage'}
      </button>
    </div>
  );
}
