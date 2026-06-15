import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { travelChat, parseBrief, generateItinerary } from '../lib/ai';
import { fetchPhotosFor } from '../lib/photos';
import { saveItinerary } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const GREETING =
  "Bonjour ! Je suis votre conseiller voyage. Dites-moi en quelques mots le voyage dont vous rêvez (destination, période, avec qui…) et on le construit ensemble. 🌍";

const imgUrl = (p) =>
  p?.src?.large || p?.src?.medium || p?.src?.small || p?.url || '';

// Promesse qui échoue après `ms` (pour ne jamais rester bloqué indéfiniment).
const withTimeout = (promise, ms, msg) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);

// Création d'un voyage par CONVERSATION avec l'IA (remplace le formulaire).
export default function CreateChatPage() {
  const navigate = useNavigate();
  const { user, isApproved } = useAuth();
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  // Photos qui défilent pendant la création
  const [photos, setPhotos] = useState([]);
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef(null);

  // --- Mode vocal (gratuit, via le navigateur) ---
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(() => {
    try { return localStorage.getItem('travelo:speak') === '1'; } catch { return false; }
  });
  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const finalRef = useRef('');
  const SpeechRec =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  const micSupported = !!SpeechRec;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // Rotation des photos pendant la création
  useEffect(() => {
    if (!finalizing || photos.length < 2) return;
    const id = setInterval(() => setPhotoIdx((i) => (i + 1) % photos.length), 5000);
    return () => clearInterval(id);
  }, [finalizing, photos]);

  // Coupe la voix en quittant la page
  useEffect(() => {
    return () => {
      if (ttsSupported) window.speechSynthesis.cancel();
      listeningRef.current = false;
      if (recRef.current) { try { recRef.current.stop(); } catch (_) { /* ignore */ } }
    };
  }, [ttsSupported]);

  // Lit un texte à voix haute (si le haut-parleur est activé)
  function speakText(text) {
    if (!speak || !ttsSupported || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      window.speechSynthesis.speak(u);
    } catch (_) { /* ignore */ }
  }

  function toggleSpeak() {
    const v = !speak;
    setSpeak(v);
    try { localStorage.setItem('travelo:speak', v ? '1' : '0'); } catch (_) { /* ignore */ }
    if (!v && ttsSupported) window.speechSynthesis.cancel();
  }

  // Micro : dicte dans le champ de message, en CONTINU (tolère les pauses).
  // Ne s'arrête que quand on reclique sur le micro.
  function toggleMic() {
    if (!micSupported) return;
    if (listening) {
      listeningRef.current = false;
      try { recRef.current?.stop(); } catch (_) { /* ignore */ }
      setListening(false);
      return;
    }
    // On repart du texte déjà présent (dictée ajoutée à la suite).
    finalRef.current = input ? input.trim() + ' ' : '';
    const r = new SpeechRec();
    r.lang = 'fr-FR';
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      setInput((finalRef.current + interim).trimStart());
    };
    // Chrome coupe parfois tout seul après un silence : on relance tant que
    // l'utilisateur n'a pas cliqué pour arrêter.
    r.onend = () => {
      if (listeningRef.current) {
        try { r.start(); } catch (_) { /* déjà relancé */ }
      } else {
        setListening(false);
      }
    };
    r.onerror = (ev) => {
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        listeningRef.current = false;
        setListening(false);
      }
    };
    recRef.current = r;
    listeningRef.current = true;
    setListening(true);
    try { r.start(); } catch (_) { listeningRef.current = false; setListening(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    // Coupe le micro à l'envoi
    if (listeningRef.current) {
      listeningRef.current = false;
      try { recRef.current?.stop(); } catch (_) { /* ignore */ }
      setListening(false);
    }
    setError(null);
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const reply = await withTimeout(
        travelChat(next),
        90000,
        'Le conseiller met trop de temps à répondre. Réessayez dans un instant.'
      );
      setMessages([...next, { role: 'assistant', content: reply || '…' }]);
      speakText(reply);
    } catch (e) {
      setError(e.message || "Erreur de connexion à l'assistant.");
      setMessages(next); // on garde le message envoyé
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
    setPhotoIdx(0);
    try {
      const transcript = messages
        .map((m) => `${m.role === 'assistant' ? 'Conseiller' : 'Voyageur'} : ${m.content}`)
        .join('\n');

      setStatus('Analyse de votre voyage…');
      const prefs = await parseBrief(transcript);

      // Photos de la destination repérée, pour les faire défiler pendant l'attente
      try {
        const pics = await fetchPhotosFor(prefs.destinations || '', 8, 'auto', 'destination');
        setPhotos((pics || []).map(imgUrl).filter(Boolean));
      } catch (_) { /* pas grave si pas de photos */ }

      setStatus('Création de votre itinéraire sur mesure…');
      const itinerary = await generateItinerary(prefs, (p) => {
        if (p?.phase === 'expanding' && p.total) {
          setStatus(`Rédaction des journées… ${p.current}/${p.total}`);
        }
      });

      const title =
        (prefs?.destinations || 'Voyage').slice(0, 80) +
        ` — ${itinerary?.summary?.duration_days || ''}j`;
      setStatus('Enregistrement…');
      const { data, error: dbError } = await saveItinerary({ title, preferences: prefs, itinerary });
      if (dbError) throw new Error(dbError.message);
      navigate(`/itineraire/${data.id}`, { state: { justCreated: true } });
    } catch (e) {
      const raw = e.message || '';
      const friendly = /idle_timeout|150s|timeout/i.test(raw)
        ? 'La création a pris trop de temps. Réessayez : ça passe presque toujours au 2e essai.'
        : raw || 'Erreur lors de la création.';
      setError(friendly);
      setFinalizing(false);
      setStatus('');
    }
  }

  const canCreate = messages.filter((m) => m.role === 'user').length >= 1 && !sending && !finalizing;

  return (
    <div className="mx-auto flex h-[calc(100vh-150px)] max-w-2xl flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">✨ Créer mon voyage</h1>
        <div className="flex items-center gap-2">
          {ttsSupported && (
            <button
              onClick={toggleSpeak}
              title={speak ? 'Couper la voix' : 'Lire les réponses à voix haute'}
              className={`rounded-lg border px-3 py-2 text-sm ${
                speak ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'
              }`}
            >
              {speak ? '🔊 Voix' : '🔇 Voix'}
            </button>
          )}
          <button onClick={createTrip} disabled={!canCreate} className="btn-primary disabled:opacity-50">
            ✅ Créer le voyage
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
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
              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
              le conseiller réfléchit…
            </div>
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
        {micSupported && (
          <button
            onClick={toggleMic}
            disabled={finalizing}
            title={listening ? 'Arrêter le micro' : 'Parler'}
            className={`rounded-xl border px-3 py-3 text-lg ${
              listening ? 'animate-pulse border-red-300 bg-red-50' : 'border-slate-300'
            }`}
          >
            🎤
          </button>
        )}
        <button onClick={send} disabled={sending || finalizing || !input.trim()} className="btn-primary disabled:opacity-50">
          Envoyer
        </button>
      </div>

      {/* Loader plein écran pendant la création (avec photos qui défilent) */}
      {finalizing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900">
          {photos.map((u, i) => (
            <img
              key={i}
              src={u}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
              style={{ opacity: i === photoIdx ? 0.45 : 0 }}
            />
          ))}
          <div className="relative z-10 mx-6 max-w-md rounded-2xl bg-black/40 px-8 py-10 text-center text-white backdrop-blur">
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            <p className="text-lg font-semibold">Nous créons votre voyage sur mesure…</p>
            <p className="mt-2 text-sm text-white/80">
              Cela peut prendre <strong>1 à 2 minutes</strong>. Merci de patienter, ne fermez pas la page.
            </p>
            {status && <p className="mt-4 text-sm text-white/90">{status}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
