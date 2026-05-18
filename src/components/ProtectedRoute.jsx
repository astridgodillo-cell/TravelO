import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
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
  return children;
}
