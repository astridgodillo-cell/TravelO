import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { saveItinerary } from '../lib/supabase';
import { applyPoeticTitle } from '../lib/ai';

// Extrait un objet JSON d'un texte collé : enlève les éventuels ``` ```,
// et ne garde que du premier "{" au dernier "}".
function extractJson(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) {
    throw new Error("Aucun JSON trouvé. Colle bien le texte produit par l'agent en mode export TravelO.");
  }
  return JSON.parse(t.slice(a, b + 1));
}

// Page d'import d'un itinéraire créé par l'agent (Claude) au format JSON TravelO.
// Route : /importer
export default function ImportItineraryPage() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    setError(null);
    setBusy(true);
    try {
      const parsed = extractJson(raw);
      // Le JSON peut être l'itinéraire directement (avec "days") ou enveloppé
      // dans { itinerary: {...} }.
      const itinerary =
        parsed.itinerary && Array.isArray(parsed.itinerary.days)
          ? parsed.itinerary
          : parsed;

      if (!Array.isArray(itinerary.days) || itinerary.days.length === 0) {
        throw new Error("Le JSON ne contient pas de journées (\"days\"). Vérifie le format d'export.");
      }

      const summary = itinerary.summary || {};
      const fallbackTitle =
        parsed.title ||
        summary.headline ||
        summary.destinations ||
        'Voyage importé';
      // Titre toujours réinventé (court et poétique), même à l'import.
      const title = await applyPoeticTitle(itinerary, fallbackTitle);

      const preferences = {
        imported: true,
        destinations: summary.destinations || '',
        start_date: summary.start_date || null,
        end_date: summary.end_date || null,
        trip_type: summary.trip_type || '',
        budget: summary.budget_level || '',
        travellers: summary.travellers || null,
        interests: summary.interests || [],
      };

      const { data, error: saveError } = await saveItinerary({
        title,
        preferences,
        itinerary,
      });
      if (saveError) throw new Error(saveError.message);

      navigate(`/itineraire/${data.id}`, { state: { justCreated: true } });
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "Le texte collé n'est pas un JSON valide. Recopie tout le bloc produit par l'agent (rien d'autre)."
          : e.message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link to="/mes-voyages" className="text-sm text-brand-700 underline">
        ← Mes voyages
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
        📥 Importer un voyage
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Crée ton itinéraire avec ton agent voyage (sur Claude), demande-lui de
        <strong> « exporter vers TravelO »</strong>, puis colle ici le texte qu'il
        te donne. TravelO ajoutera les photos et les cartes, et tu pourras
        imprimer la brochure.
      </p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder='Colle ici le JSON de ton agent (il commence par { et finit par })'
        className="mt-4 h-64 w-full resize-y rounded-xl border border-slate-300 p-3 font-mono text-xs focus:border-brand-500 focus:outline-none"
      />

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={busy || !raw.trim()}
        className="btn-primary mt-4 w-full sm:w-auto disabled:opacity-50"
      >
        {busy ? 'Import en cours…' : 'Importer le voyage'}
      </button>
    </div>
  );
}
