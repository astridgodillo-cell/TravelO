// Conversion d'un PDF (voucher / confirmation de réservation) en image,
// pour pouvoir le passer au LLM vision exactement comme une capture d'écran.
//
// On rend la 1re page (qui contient quasi toujours l'essentiel : nom de
// l'hôtel, dates, prix payé, adresse) en JPEG.
//
// IMPORTANT : pdfjs-dist est LOURD (~350 Ko). On le charge en différé
// (import dynamique) seulement quand l'utilisateur dépose réellement un
// PDF — la page d'accueil et la génération restent légères.

let _pdfjsPromise = null;

async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      // Vite transforme cet import en Web Worker dédié (?worker)
      const { default: PdfWorker } = await import(
        'pdfjs-dist/build/pdf.worker.min.mjs?worker'
      );
      pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
      return pdfjsLib;
    })();
  }
  return _pdfjsPromise;
}

/**
 * Convertit la première page d'un fichier PDF en data URL JPEG.
 * @param {File|Blob} file - le fichier PDF
 * @param {object} opts - { scale (résolution), quality (0-1), maxDim }
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function pdfFirstPageToImageDataUrl(
  file,
  { scale = 2, quality = 0.85, maxDim = 1600 } = {}
) {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  let viewport = page.getViewport({ scale });
  if (viewport.width > maxDim || viewport.height > maxDim) {
    const ratio = Math.min(maxDim / viewport.width, maxDim / viewport.height);
    viewport = page.getViewport({ scale: scale * ratio });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', quality);
}
