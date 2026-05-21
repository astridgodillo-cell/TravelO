import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmail } from '../lib/supabase';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/mes-voyages';

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signInWithEmail(email, password);
    setLoading(false);
    if (error) setError(error.message);
    else navigate(from, { replace: true });
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="text-center mb-6">
        <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-brand-700">
          Espace voyageur
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Connexion
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Retrouvez vos itinéraires, modèles et préférences.
        </p>
      </div>
      <div className="card space-y-4">
        <GoogleAuthButton redirectPath={from} />

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
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={loading}
            type="submit"
            className="btn-primary w-full"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="text-sm text-slate-500">
          Pas encore de compte ?{' '}
          <Link to="/inscription" className="text-brand-700 hover:underline">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
