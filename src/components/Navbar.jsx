import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { signOut } from '../lib/supabase';
import BackendQuickSwitch from './BackendQuickSwitch';
import FlightProviderQuickSwitch from './FlightProviderQuickSwitch';

export default function Navbar() {
  const { user, profile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Ferme le menu mobile à chaque changement de route
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Empêche le scroll du body quand le menu mobile est ouvert
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  async function handleSignOut() {
    await signOut();
    setOpen(false);
    navigate('/');
  }

  const navLinkClass = ({ isActive }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-700'
        : 'text-slate-600 hover:text-brand-700 hover:bg-slate-100'
    }`;

  const mobileLinkClass = ({ isActive }) =>
    `block px-4 py-3 text-base font-medium rounded-md transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-700'
        : 'text-slate-700 hover:bg-slate-100'
    }`;

  const NavLinks = ({ mobile = false }) => {
    const cls = mobile ? mobileLinkClass : navLinkClass;
    return (
      <>
        <NavLink to="/" end className={cls}>
          Accueil
        </NavLink>
        {user && (
          <NavLink to="/nouveau" className={cls}>
            Nouvel itinéraire
          </NavLink>
        )}
        {user && (
          <NavLink to="/mes-voyages" className={cls}>
            Mes voyages
          </NavLink>
        )}
        {user && (
          <NavLink to="/modeles" className={cls}>
            Modèles
          </NavLink>
        )}
        {user && (
          <NavLink to="/mes-listes" className={cls}>
            Mes listes
          </NavLink>
        )}
        {user && (
          <NavLink to="/profil" className={cls}>
            Mon profil
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/admin" className={cls}>
            Admin
          </NavLink>
        )}
      </>
    );
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 gap-2">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img
            src="/logo.png"
            alt="TravelO"
            className="h-9 w-9 object-contain"
          />
          <span className="text-lg font-semibold text-slate-900">TravelO</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-1">
          <NavLinks />
        </div>

        {/* Desktop auth */}
        <div className="hidden lg:flex items-center gap-2">
          {user ? (
            <>
              {isAdmin && (
                <>
                  <BackendQuickSwitch />
                  <FlightProviderQuickSwitch />
                </>
              )}
              <span className="hidden xl:flex flex-col items-end text-xs leading-tight">
                <span className="text-slate-600 truncate max-w-[180px]">
                  {user.email}
                </span>
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

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-700 hover:bg-slate-100"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={open}
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden border-t border-slate-200 bg-white">
          <div className="px-3 py-3 space-y-1">
            <NavLinks mobile />
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            {user ? (
              <div className="space-y-2">
                <div className="text-xs text-slate-500">
                  Connecté en tant que
                </div>
                <div className="text-sm font-medium text-slate-800 truncate">
                  {user.email}
                </div>
                {profile && (
                  <div className="text-xs text-slate-500 capitalize">
                    Plan {profile.subscription_tier}
                    {profile.status !== 'approved' && ` · ${profile.status}`}
                  </div>
                )}
                {isAdmin && (
                  <div className="pt-2 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                        Backend LLM
                      </div>
                      <BackendQuickSwitch />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                        Fournisseur de vols
                      </div>
                      <FlightProviderQuickSwitch />
                    </div>
                  </div>
                )}
                <button
                  onClick={handleSignOut}
                  className="btn-secondary w-full mt-2"
                >
                  Se déconnecter
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link to="/connexion" className="btn-secondary justify-center">
                  Connexion
                </Link>
                <Link to="/inscription" className="btn-primary justify-center">
                  Inscription
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
