// Transforme un PDF (Blob) en IMAGES (une par page), via pdf.js.
// Utilisé pour partager une journée d'album sous forme de photos (ex. WhatsApp),
// qui s'affichent alors directement dans la conversation au lieu d'un fichier.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Rend chaque page du PDF dans un canevas puis la convertit en fichier image.
// - baseName : nom des fichiers générés (jour-1-p1.jpg, …)
// - targetWidth : largeur de l'image en pixels (qualité)
// - type/quality : format de sortie (JPEG par défaut, bon compromis poids/qualité)
export async function pdfBlobToImageFiles(blob, {
  baseName = 'page',
  targetWidth = 1400,
  type = 'image/jpeg',
  quality = 0.92,
} = {}) {
  const data = await blob.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  const files = [];
  const ext = type === 'image/png' ? 'png' : 'jpg';
  try {
    for (let n = 1; n <= pdfDoc.numPages; n += 1) {
      const page = await pdfDoc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      // Fond blanc (le JPEG ne gère pas la transparence).
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const imgBlob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      if (imgBlob) {
        const name = pdfDoc.numPages > 1 ? `${baseName}-p${n}.${ext}` : `${baseName}.${ext}`;
        files.push(new File([imgBlob], name, { type: imgBlob.type || type }));
      }
    }
  } finally {
    try { pdfDoc.destroy(); } catch { /* ignore */ }
  }
  return files;
}
