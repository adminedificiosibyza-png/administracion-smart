/* PDF formal de las Normas de Convivencia de un edificio (A4 vertical, texto real, multipágina).
 * Usa jsPDF (cargado bajo demanda, igual que el reporte financiero). El contenido sale tal cual
 * está guardado: solo se añade la numeración 1., 1.1., ... en la presentación. */
import { loadScript, JSPDF_URL } from './reportPdf.js';

// Adorno de la esquina inferior izquierda (igual para todos los edificios; no lleva datos de ningún edificio)
const FOOTER_DECORATION = 'assets/letterheads/footer-triangle.svg';

const TEXT = [52, 58, 48];          // #343a30
const MUTED = [105, 112, 100];      // #697064
const LINE = [223, 229, 215];       // #dfe5d7
const ACCENT = [51, 93, 113];       // #335d71 (mismo azul del adorno)
const SOFT = [229, 237, 241];

const PAGE_W = 210, PAGE_H = 297, ML = 22, MR = 22;
const CW = PAGE_W - ML - MR;

async function rasterizeDecoration(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // El SVG no declara tamaño: se fija para que el navegador lo rasterice a la resolución pedida
    const svg = (await res.text()).replace('<svg ', '<svg width="1190" height="1684" ');
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = blobUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1190; canvas.height = 1684;
      canvas.getContext('2d').drawImage(img, 0, 0, 1190, 1684);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (e) {
    return null; // sin adorno: el documento sale igual
  }
}

export function rulesPdfFileName(buildingName) {
  const clean = String(buildingName).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Normas_de_Convivencia_${clean}.pdf`;
}

/**
 * @param {{building:{name:string}, intro:string,
 *          categories:Array<{category:string, items:string[]}>, includeReceipt?:boolean}} data
 */
export async function exportRulesPdf({ building, intro, categories, includeReceipt = false }) {
  const cats = (categories || []).filter(c => c && Array.isArray(c.items));
  if (!cats.length) throw new Error('Este edificio todavía no tiene normas guardadas para exportar.');

  await loadScript(JSPDF_URL);
  const decoration = await rasterizeDecoration(FOOTER_DECORATION);

  const topFirst = 26;
  const topNext = 26;
  const bottomLimit = decoration ? 272 : 273;   // el triángulo ocupa la esquina inferior izquierda; el texto empieza a la derecha de sus trazos
  const footerX = decoration ? 42 : ML;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = topFirst;

  const drawBackground = () => {
    if (decoration) doc.addImage(decoration, 'PNG', 0, 0, PAGE_W, PAGE_H, 'DECORATION', 'FAST');
  };
  const compactHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...ACCENT);
    doc.text('NORMAS DE CONVIVENCIA', ML, 13);
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(building.name, PAGE_W - MR, 13, { align: 'right' });
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(ML, 16, PAGE_W - MR, 16);
  };
  const newPage = () => { doc.addPage(); drawBackground(); compactHeader(); y = topNext; };
  const ensure = (h) => { if (y + h > bottomLimit) newPage(); };

  // Párrafo justificado: todas las líneas menos la última de cada párrafo
  // El reparto de espacios se hace palabra por palabra para que el borde derecho quede exacto
  const justified = (line, x, width, isLast) => {
    const words = line.trim().split(/\s+/);
    if (isLast || words.length < 2) { doc.text(line, x, y); return; }
    const total = words.reduce((s, w) => s + doc.getTextWidth(w), 0);
    const gap = (width - total) / (words.length - 1);
    if (gap < 0 || gap > 8) { doc.text(line, x, y); return; } // línea inusual: se deja sin justificar
    let cx = x;
    words.forEach(w => { doc.text(w, cx, y); cx += doc.getTextWidth(w) + gap; });
  };

  // ---- Primera página: nombre del edificio y título, centrados ----
  drawBackground();
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEXT);
  doc.text('NORMAS DE CONVIVENCIA', PAGE_W / 2, y, { align: 'center' });
  y += 9;
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...ACCENT);
  doc.text(building.name, PAGE_W / 2, y, { align: 'center' });
  y += 14;

  // ---- Introducción (solo si existe) ----
  const introText = String(intro || '').trim();
  if (introText) {
    const w = CW - 7;
    doc.setFont('helvetica', 'normal').setFontSize(10.5);
    const lines = doc.splitTextToSize(introText, w);
    const lh = 5.3;
    lines.forEach((line, li) => {
      ensure(lh);
      doc.setFillColor(...ACCENT).rect(ML, y - 3.8, 1.1, lh, 'F');
      doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...TEXT);
      justified(line, ML + 5, w, li === lines.length - 1);
      y += lh;
    });
    y += 7;
  }

  // ---- Categorías y normas, en el orden guardado ----
  const NUM_W = 13;
  const lh = 5;
  const textW = CW - NUM_W - 2;
  cats.forEach((cat, ci) => {
    const items = cat.items.map(t => String(t ?? ''));
    doc.setFont('helvetica', 'normal').setFontSize(10);
    const firstLines = items.length ? doc.splitTextToSize(items[0], textW) : [];
    // El título de categoría no se queda solo al final de la página: debe caber con las primeras líneas de su primera norma
    ensure(10 + 3 + lh * Math.min(firstLines.length || 1, 2));

    doc.setFillColor(...SOFT).rect(ML, y, CW, 8, 'F');
    doc.setFillColor(...ACCENT).rect(ML, y, 1.4, 8, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...ACCENT);
    doc.text(`${ci + 1}.  ${String(cat.category).toLocaleUpperCase('es')}`, ML + 5, y + 5.6);
    y += 8 + 5;

    items.forEach((text, ii) => {
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const lines = doc.splitTextToSize(text, textW);
      ensure(lh * Math.min(lines.length || 1, 2));
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...ACCENT);
      doc.text(`${ci + 1}.${ii + 1}.`, ML + 2, y);
      lines.forEach((line, li) => {
        if (li > 0) ensure(lh);
        doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...TEXT);
        justified(line, ML + NUM_W, textW, li === lines.length - 1);
        y += lh;
      });
      y += 2.4;
    });
    y += 4;
  });

  // ---- Constancia de recepción (opcional, en su propia página) ----
  if (includeReceipt) {
    newPage();
    y += 6;
    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...TEXT);
    doc.text('CONSTANCIA DE RECEPCIÓN', PAGE_W / 2, y, { align: 'center' });
    y += 12;
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...TEXT);
    const para = doc.splitTextToSize(`Constancia de recepción del documento "Normas de Convivencia" de ${building.name}.`, CW);
    para.forEach((line, li) => { justified(line, ML, CW, li === para.length - 1); y += 5.5; });
    y += 12;

    const field = (label, x1, x2) => {
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXT);
      doc.text(label, x1, y);
      const lw = doc.getTextWidth(label) + 3;
      doc.setDrawColor(...MUTED).setLineWidth(0.3).line(x1 + lw, y + 1, x2, y + 1);
    };
    field('Nombre del propietario:', ML, PAGE_W - MR); y += 15;
    field('Departamento N°:', ML, ML + 80); y += 15;
    field('Fecha de recepción:', ML, ML + 80); y += 42;

    const colW = 74;
    [['Firma del propietario', ML], ['Firma de quien entrega', PAGE_W - MR - colW]].forEach(([label, x]) => {
      doc.setDrawColor(...MUTED).setLineWidth(0.3).line(x, y, x + colW, y);
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
      doc.text(label, x + colW / 2, y + 5, { align: 'center' });
    });
  }

  // ---- Pie de página en todas las páginas (el total se conoce al terminar) ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(footerX, PAGE_H - 14, PAGE_W - MR, PAGE_H - 14);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(`${building.name} · Normas de Convivencia`, footerX, PAGE_H - 9);
    doc.text(`Página ${i} de ${pages}`, PAGE_W - MR, PAGE_H - 9, { align: 'right' });
  }

  doc.save(rulesPdfFileName(building.name));
}
