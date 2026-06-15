import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { travelChat, parseBrief, generateItinerary } from '../lib/ai';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const GREETING =
  "Bonjour ! Je suis votre conseiller voyage. Dites-moi en quelques mots le voyage dont vous rêvez (destination, période, avec qui…) et on le construit ensemble. 🌍";

// Création d'un voyage par CONVERSATION avec l'IA (remplace le formulaire).
// Route : /creer
export default function CreateChatPage() {
  const navigate = useNavigate();
  const { user, isApproved } = useAuth();
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const reply = await travelChat(next);
      setMessages([...next, { role: 'assistant', content: reply || '…' }]);
    } catch (e) {
      setError(e.message || 'Erreur de connexion à l\'assistant.');
      setMessages(messages); // revert
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function createTrip() {
    if (!user) return navigate('/connexion');
    if (!isApproved) return navigate('/compte-en-attente');
    setError(null);
    setFinalizing(true);
    try {
      const transcript = messages
        .map((m) => `${m.role === 'assistant' ? 'Conseiller' : 'Voyageur'} : ${m.content}`)
        .join('\n');
      setStatus('Analyse de votre voyage…');
      const prefs = await parseBrief(transcript);
      setStatus('Création de l\'itinéraire…');
      const itinerary = await generateItinerary(prefs, (p) => {
        if (p?.phase === 'expanding' && p.total) setStatus(`Rédaction des journées… ${p.current}/${p.total}`);
      });
      const title =
        (prefs?.destinations || 'Voyage').slice(0, 80) +
        ` — ${itinerary?.summary?.duration_days || ''}j`;
      setStatus('Enregistrement…');
      const { data, error: dbError } = await saveItinerary({ title, preferences: prefs, itinerary });
      if (dbError) throw new Error(dbError.message);
      navigate(`/itineraire/${data.id}`, { state: { justCreated: true } });
    } catch (e) {
      setError(e.message || 'Erreur lors de la création.');
      setFinalizing(false);
      setStatus('');
    }
  }

  // On autorise la création dès qu'il y a eu un vrai échange.
  const canCreate = messages.filter((m) => m.role === 'user').length >= 1 && !sending && !finalizing;

  return (
    <div className="mx-auto flex h-[calc(100vh-150px)] max-w-2xl flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">✨ Créer mon voyage</h1>
        <button
          onClick={createTrip}
          disabled={!canCreate}
          className="btn-primary disabled:opacity-50"
          title={canCreate ? '' : 'Discutez un peu avec le conseiller d\'abord'}
        >
          {finalizing ? 'Création…' : '✅ Créer le voyage'}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4"
      >
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white'
                  : 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800'
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" /> le conseiller écrit…
            </div>
          </div>
        )}
        {finalizing && status && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
            {status}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={finalizing}
          rows={2}
          placeholder="Écrivez votre message…  (Entrée pour envoyer)"
          className="flex-1 resize-none rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button onClick={send} disabled={sending || finalizing || !input.trim()} className="btn-primary disabled:opacity-50">
          Envoyer
        </button>
      </div>
    </div>
  );
}
