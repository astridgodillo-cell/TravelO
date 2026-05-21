import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUpWithEmail } from '../lib/supabase';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const { data, error } = await signUpWithEmail(email, password);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Inscription OK : on dirige vers la page d'attente
    // (le profil est créé en pending par le trigger Postgres).
    if (data?.session) {
      navigate('/compte-en-attente', { replace: true });
    } else {
      setInfo(
        "Compte créé. Vérifiez votre email si la confirmation est requise, puis connectez-vous — un administrateur devra valider votre accès."
      );
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="text-center mb-6">
        <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-coral-600">
          Bienvenue
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Créer un compte
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Votre demande sera soumise à un administrateur pour validation.
        </p>
      </div>
      <div className="card space-y-4">
        <GoogleAuthButton redirectPath="/compte-en-attente" />

        <div className="relative my-2 flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-slate-400">
          <div className="flex-1 border-t border-slate-200" />
          <span className="whitespace-nowrap">ou avec votre email</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input
              required
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <input
              required
              type="password"
              minLength="6"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-emerald-700">{info}</p>}
          <button
            disabled={loading}
            type="submit"
            className="btn-primary w-full"
          >
            {loading ? 'Création…' : 'S\'inscrire'}
          </button>
        </form>

        <p className="text-sm text-slate-500">
          Déjà inscrit ?{' '}
          <Link to="/connexion" className="text-brand-700 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
