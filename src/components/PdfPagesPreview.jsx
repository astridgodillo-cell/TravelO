import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js a besoin de son « worker » (petit programme qui décode le PDF en
// arrière-plan). On le branche une seule fois.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Aperçu d'un PDF rendu en IMAGES (canvas), page par page. Contrairement à un
// <iframe>, ça s'affiche correctement sur mobile (iOS/Android) sans forcer le
// téléchargement, et c'est défilable au doigt.
export default function PdfPagesPreview({ blob, className = '' }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | done | error

  useEffect(() => {
    if (!blob) return undefined;
    let cancelled = false;
    let pdfDoc = null;

    (async () => {
      try {
        setStatus('loading');
        const data = await blob.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = '';
        const cssWidth = Math.max(280, Math.min(host.clientWidth || 600, 900));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let n = 1; n <= pdfDoc.numPages; n += 1) {
          const page = await pdfDoc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'mb-3 block rounded-lg border border-slate-200 bg-white shadow-sm';
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (cancelled) return;
        }
        if (!cancelled) setStatus('done');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try { pdfDoc?.destroy(); } catch { /* ignore */ }
    };
  }, [blob]);

  return (
    <div className={className}>
      {status === 'loading' && (
        <p className="py-6 text-center text-sm text-slate-500">Préparation de l'aperçu…</p>
      )}
      {status === 'error' && (
        <p className="py-6 text-center text-sm text-red-600">
          L'aperçu n'a pas pu s'afficher. Tu peux quand même télécharger le fichier.
        </p>
      )}
      <div ref={hostRef} />
    </div>
  );
}
