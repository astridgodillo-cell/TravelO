import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminRoute({ children }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-slate-500">
        Chargement…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/connexion" state={{ from: location }} replace />;
  }
  if (profile?.role !== 'admin') {
    return (
      <div className="card text-center">
        <h1 className="text-xl font-semibold text-slate-900">Accès refusé</h1>
        <p className="mt-2 text-slate-500">
          Cette page est réservée aux administrateurs.
        </p>
      </div>
    );
  }
  return children;
}
