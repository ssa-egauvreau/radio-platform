// Extracts plain text from a PDF buffer using pdfjs-dist's legacy build (pure
// JS — no native deps, no apt/railpack change). Loaded lazily so a parse-time
// failure degrades to an empty string rather than blocking server start.

type TextItem = { str?: string; hasEOL?: boolean };

/**
 * Returns the document's concatenated text, or "" when the PDF has no
 * extractable text (e.g. a scanned image — OCR is out of scope).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const moduleName = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = (await import(moduleName)) as {
    getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDocument> };
  };

  const doc = await pdfjs.getDocument({
    // A fresh copy: pdf.js transfers/detaches the backing ArrayBuffer.
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items as TextItem[]) {
          if (typeof item.str === "string") {
            pageText += item.str;
            // pdf.js marks line ends; otherwise separate runs with a space.
            pageText += item.hasEOL ? "\n" : " ";
          }
        }
        pages.push(pageText);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

interface PdfPage {
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup: () => void;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}
