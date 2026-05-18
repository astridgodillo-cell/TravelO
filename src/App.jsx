import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import NewItineraryPage from './pages/NewItineraryPage';
import MyTripsPage from './pages/MyTripsPage';
import ItineraryDetailPage from './pages/ItineraryDetailPage';
import PublicItineraryPage from './pages/PublicItineraryPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

export default function App() {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/nouveau" element={<NewItineraryPage />} />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<SignupPage />} />
          <Route path="/partage/:slug" element={<PublicItineraryPage />} />
          <Route
            path="/mes-voyages"
            element={
              <ProtectedRoute>
                <MyTripsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/itineraire/:id"
            element={
              <ProtectedRoute>
                <ItineraryDetailPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function NotFound() {
  return (
    <div className="text-center py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Page introuvable</h1>
      <p className="mt-2 text-slate-500">
        La page demandée n'existe pas ou a été déplacée.
      </p>
    </div>
  );
}
