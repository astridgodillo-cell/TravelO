import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { signOut } from '../lib/supabase';

export default function Navbar() {
  const { user, profile, isAdmin } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const navLink = ({ isActive }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-700'
        : 'text-slate-600 hover:text-brand-700 hover:bg-slate-100'
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="TravelO"
            className="h-9 w-9 object-contain"
          />
          <span className="text-lg font-semibold text-slate-900">TravelO</span>
        </Link>

        <div className="flex items-center gap-1">
          <NavLink to="/" end className={navLink}>
            Accueil
          </NavLink>
          {user && (
            <NavLink to="/nouveau" className={navLink}>
              Nouvel itinéraire
            </NavLink>
          )}
          {user && (
            <NavLink to="/mes-voyages" className={navLink}>
              Mes voyages
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={navLink}>
              Admin
            </NavLink>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden sm:flex flex-col items-end text-xs leading-tight">
                <span className="text-slate-600">{user.email}</span>
                {profile && (
                  <span className="text-slate-400 capitalize">
                    {profile.subscription_tier}
                    {profile.status !== 'approved' && ` · ${profile.status}`}
                  </span>
                )}
              </span>
              <button onClick={handleSignOut} className="btn-secondary">
                Se déconnecter
              </button>
            </>
          ) : (
            <>
              <Link to="/connexion" className="btn-secondary">
                Connexion
              </Link>
              <Link to="/inscription" className="btn-primary">
                Inscription
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
