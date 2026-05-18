import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmail } from '../lib/supabase';

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
      <div className="card">
        <h1 className="text-xl font-semibold text-slate-900">Connexion</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button disabled={loading} type="submit" className="btn-primary w-full">
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Pas encore de compte ?{' '}
          <Link to="/inscription" className="text-brand-700 hover:underline">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
