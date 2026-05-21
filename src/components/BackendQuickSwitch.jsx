import { useEffect, useRef, useState } from 'react';
import { getAppConfig, setAppConfig } from '../lib/supabase';

const OPTIONS = [
  { id: 'gemini', label: 'Gemini', dot: 'bg-emerald-500' },
  { id: 'deepseek', label: 'DeepSeek', dot: 'bg-blue-500' },
  { id: 'claude', label: 'Claude', dot: 'bg-orange-500' },
];

const COLORS = {
  gemini: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  deepseek: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  claude: 'bg-orange-100 text-orange-800 hover:bg-orange-200',
};

/**
 * Mini-dropdown placé dans la navbar pour les admins.
 * Affiche le backend LLM actuel et permet de switcher en un clic.
 */
export default function BackendQuickSwitch() {
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let active = true;
    getAppConfig('llm_backend').then(({ value }) => {
      if (active) setCurrent(value || 'gemini');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  async function change(b) {
    if (b === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const { error } = await setAppConfig('llm_backend', b);
    if (!error) setCurrent(b);
    setBusy(false);
    setOpen(false);
  }

  if (!current) return null;
  const opt = OPTIONS.find((o) => o.id === current) || OPTIONS[0];
  const color = COLORS[current] || 'bg-slate-100 text-slate-700 hover:bg-slate-200';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Backend LLM actif (admin)"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${color} disabled:opacity-50`}
      >
        {busy ? (
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
        ) : (
          <span className={`inline-block h-2 w-2 rounded-full ${opt.dot}`} />
        )}
        {opt.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-60"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            Backend LLM
          </div>
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => change(o.id)}
              className={`flex w-full items-center gap-2 text-left px-3 py-2 text-sm transition-colors ${
                o.id === current
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${o.dot}`} />
              <span className="flex-1">{o.label}</span>
              {o.id === current && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 12 9 17 20 6" />
                </svg>
              )}
            </button>
          ))}
          <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100">
            Effectif sous 15 secondes
          </div>
        </div>
      )}
    </div>
  );
}
