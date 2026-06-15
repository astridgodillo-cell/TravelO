import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ShareNotifications from './components/ShareNotifications';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import HomePage from './pages/HomePage';
import NewItineraryPage from './pages/NewItineraryPage';
import ImportItineraryPage from './pages/ImportItineraryPage';
import CreateWithAiPage from './pages/CreateWithAiPage';
import CreateChatPage from './pages/CreateChatPage';
import MyTripsPage from './pages/MyTripsPage';
import MyListsPage from './pages/MyListsPage';
import TemplatesPage from './pages/TemplatesPage';
import TemplateDetailPage from './pages/TemplateDetailPage';
import ItineraryDetailPage from './pages/ItineraryDetailPage';
import BrochurePage from './pages/BrochurePage';
import PublicItineraryPage from './pages/PublicItineraryPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PendingAccountPage from './pages/PendingAccountPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import OnboardingPage from './pages/OnboardingPage';
// Chargée à la demande (la librairie PDF est lourde) :
const BrochurePdfPage = lazy(() => import('./pages/BrochurePdfPage'));

export default function App() {
  const { pathname } = useLocation();
  // La home utilise un layout full-bleed (hero immersif, sections internes
  // gèrent elles-mêmes leur max-width). Les autres pages restent dans le
  // container max-w-6xl historique.
  const fullBleed = pathname === '/';
  const mainClass = fullBleed
    ? 'flex-1 w-full'
    : 'flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:py-8';
  return (
    <div className="flex min-h-full flex-col">
      <ShareNotifications />
      <Navbar />
      <main className={mainClass}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/nouveau"
            element={
              <ProtectedRoute>
                <NewItineraryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/importer"
            element={
              <ProtectedRoute>
                <ImportItineraryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/creer-ia"
            element={
              <ProtectedRoute>
                <CreateWithAiPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/creer"
            element={
              <ProtectedRoute>
                <CreateChatPage />
              </ProtectedRoute>
            }
          />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<SignupPage />} />
          <Route path="/compte-en-attente" element={<PendingAccountPage />} />
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
            path="/mes-listes"
            element={
              <ProtectedRoute>
                <MyListsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modeles"
            element={
              <ProtectedRoute>
                <TemplatesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modele/:id"
            element={
              <ProtectedRoute>
                <TemplateDetailPage />
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
          <Route
            path="/itineraire/:id/brochure"
            element={
              <ProtectedRoute>
                <BrochurePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/itineraire/:id/brochure-pdf"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="p-8 text-center text-slate-500">Préparation…</div>}>
                  <BrochurePdfPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profil"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bienvenue"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
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
