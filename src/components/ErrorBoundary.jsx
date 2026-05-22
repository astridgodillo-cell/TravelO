import React from 'react';

/**
 * Filet de sécurité React : si un composant enfant plante (typiquement
 * "Objects are not valid as a React child" ou une lecture sur null), on
 * affiche un message lisible avec le détail de l'erreur au lieu d'un
 * écran blanc indiquant juste que l'app est cassée.
 *
 * Usage : <ErrorBoundary><MyApp /></ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught a render error:', error, info);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message =
      this.state.error?.message ||
      String(this.state.error) ||
      'Erreur inconnue.';
    const stack = this.state.error?.stack || '';
    const componentStack = this.state.info?.componentStack || '';

    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="max-w-2xl w-full rounded-2xl bg-white shadow-lg p-6 border border-red-200">
          <div className="flex items-start gap-3">
            <div className="text-3xl shrink-0">💥</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-slate-900">
                Une erreur d'affichage est survenue
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Tes données ne sont pas perdues. Tu peux réessayer ou
                recharger la page.
              </p>
              <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 font-mono text-xs text-red-900 break-words">
                {message}
              </div>
              <details className="mt-3 text-xs text-slate-500">
                <summary className="cursor-pointer hover:text-slate-700">
                  Détails techniques (à partager si tu signales le bug)
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded bg-slate-50 p-3 whitespace-pre-wrap text-[10px]">
                  {stack}
                  {componentStack && `\n\n--- Composants ---\n${componentStack}`}
                </pre>
              </details>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 text-sm font-medium transition-colors"
                >
                  Réessayer
                </button>
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 text-sm font-medium transition-colors"
                >
                  Recharger la page
                </button>
                <a
                  href="/"
                  className="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 text-sm font-medium transition-colors"
                >
                  Retour accueil
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
