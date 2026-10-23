/* PDF formal de las Normas de Convivencia de un edificio (A4 vertical, texto real, multipágina).
 * Usa jsPDF (cargado bajo demanda, igual que el reporte financiero). El contenido sale tal cual
 * está guardado: solo se añade la numeración 1., 1.1., ... en la presentación. */
import { loadScript, JSPDF_URL, loadLogo } from './reportPdf.js';

// Adorno de la esquina inferior izquierda (igual para todos los edificios; no lleva datos de ningún edificio)
const FOOTER_DECORATION = 'assets/letterheads/footer-triangle.svg';

const TEXT = [52, 58, 48];          // #343a30
const MUTED = [105, 112, 100];      // #697064
const LINE = [223, 229, 215];       // #dfe5d7
const ACCENT = [51, 93, 113];       // #335d71 (mismo azul del adorno)
const SOFT = [229, 237, 241];

const PAGE_W = 210, PAGE_H = 297, ML = 22, MR = 22;
const CW = PAGE_W - ML - MR;

// ---- Cuadernillo: portada monocromática en el azul del documento (sin fotos) ----
const NIGHT = [16, 30, 44];
const WHITE = [255, 255, 255];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));   // t=0 → a, t=1 → b

function drawBrandLine(doc, x, y, onDark, logo, align = 'left') {
  const label = 'ADMINISTRACIÓN SMART';
  doc.setFont('helvetica', 'bold').setFontSize(11);
  const tw = doc.getTextWidth(label);
  const chip = 14, gap = 4;
  const x0 = align === 'center' ? x - (chip + gap + tw) / 2 : x;
  doc.setFillColor(...WHITE).setDrawColor(...LINE).setLineWidth(0.3).roundedRect(x0, y, chip, chip, 2.5, 2.5, onDark ? 'F' : 'FD');
  if (logo) doc.addImage(logo, 'PNG', x0 + 1.6, y + 1.6, chip - 3.2, chip - 3.2);
  doc.setTextColor(...(onDark ? WHITE : TEXT));
  doc.text(label, x0 + chip + gap, y + chip / 2 + 1.4);
}

function drawCover(doc, { building, style, logo }) {
  const cx = PAGE_W / 2;
  const name = String(building.name || '').toLocaleUpperCase('es');
  const place = [building.address, building.city].filter(Boolean).join(' · ');

  if (style === 'typographic') {
    // Bloques geométricos escalonados: azul vivo + ámbar cálido, y titular grande
    const deep = ACCENT, bright = mixRgb(ACCENT, WHITE, 0.3), amber = [252, 196, 44], sky = mixRgb(ACCENT, WHITE, 0.82);
    doc.setFillColor(...deep).rect(PAGE_W - 112, 0, 112, 150, 'F');
    doc.setFillColor(...amber).rect(PAGE_W - 156, 0, 56, 72, 'F');
    doc.setFillColor(...sky).rect(PAGE_W - 72, 150, 72, 46, 'F');
    doc.setFillColor(...mixRgb(ACCENT, WHITE, 0.5)).rect(PAGE_W - 112, 150, 40, 8, 'F');

    doc.setFillColor(...amber).rect(ML, 176, 22, 2.4, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(40).setTextColor(...deep);
    doc.text('NORMAS DE', ML, 198);
    doc.text('CONVIVENCIA', ML, 215);
    const nameLines = doc.splitTextToSize(name, CW);
    doc.setFontSize(15).setTextColor(...bright);
    nameLines.forEach((l, i) => doc.text(l, ML, 230 + i * 7));
    if (place) {
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(place, CW - 40), ML, 241 + (nameLines.length - 1) * 7);
    }
    drawBrandLine(doc, ML, 265, false, logo);
    return;
  }

  // Estilo "silueta": atardecer (azul a ámbar) y un edificio con tantos pisos como tenga el edificio
  const baseY = 232, steps = 48;
  const SKY_TOP = mixRgb(ACCENT, NIGHT, 0.6), SKY_MID = mixRgb(ACCENT, WHITE, 0.35), SKY_LOW = [255, 214, 130];
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    const c = p < 0.6 ? mixRgb(SKY_TOP, SKY_MID, p / 0.6) : mixRgb(SKY_MID, SKY_LOW, (p - 0.6) / 0.4);
    doc.setFillColor(...c).rect(0, (baseY / steps) * i, PAGE_W, baseY / steps + 0.3, 'F');
  }
  doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(...WHITE);
  doc.text('NORMAS DE CONVIVENCIA', cx, 50, { align: 'center' });
  doc.setFillColor(255, 214, 140).rect(cx - 20, 56, 40, 1, 'F');
  doc.setFontSize(28).setTextColor(255, 232, 200);
  doc.splitTextToSize(name, CW).forEach((l, i) => doc.text(l, cx, 74 + i * 12, { align: 'center' }));

  const floors = Math.min(20, Math.max(3, Math.round(Number(building.total_floors)) || 8));
  const fh = Math.min(11, 130 / floors), towerW = 62, x0 = cx - towerW / 2;
  const body = mixRgb(ACCENT, NIGHT, 0.7), glow = [255, 214, 90];
  // volumen bajo a un costado
  const annexFloors = Math.min(3, floors - 1), annexW = 24;
  doc.setFillColor(...mixRgb(ACCENT, NIGHT, 0.45)).rect(x0 - annexW, baseY - annexFloors * fh, annexW, annexFloors * fh, 'F');
  for (let r = 1; r < annexFloors; r++) {
    for (let c = 0; c < 2; c++) doc.setFillColor(...mixRgb(glow, body, 0.3)).rect(x0 - annexW + 4 + c * 10, baseY - (r + 1) * fh + fh * 0.28, 6, fh * 0.44, 'F');
  }
  // torre
  doc.setFillColor(...body).rect(x0, baseY - floors * fh, towerW, floors * fh, 'F');
  doc.setFillColor(...mixRgb(ACCENT, NIGHT, 0.2)).rect(x0 - 1.5, baseY - floors * fh - 2, towerW + 3, 2, 'F');  const ww = 8, gap = (towerW - 4 * ww) / 5;
  for (let r = 1; r < floors; r++) {
    for (let c = 0; c < 4; c++) {
      doc.setFillColor(...glow).rect(x0 + gap + c * (ww + gap), baseY - (r + 1) * fh + fh * 0.25, ww, fh * 0.5, 'F');
    }
  }
  doc.setFillColor(252, 196, 44).rect(cx - 5, baseY - fh * 0.8, 10, fh * 0.8, 'F');      // puerta iluminada
  doc.setFillColor(...mixRgb(ACCENT, NIGHT, 0.8)).rect(0, baseY, PAGE_W, 3, 'F');                             // suelo
  doc.setFillColor(...mixRgb(ACCENT, NIGHT, 0.88)).rect(0, baseY + 3, PAGE_W, PAGE_H - baseY - 3, 'F');

  if (place) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(255, 226, 190);
    doc.text(doc.splitTextToSize(place, CW), cx, 252, { align: 'center' });
  }
  drawBrandLine(doc, cx, 262, true, logo, 'center');
}

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

export function rulesPdfFileName(buildingName, booklet = false) {
  const clean = String(buildingName).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${booklet ? 'Cuadernillo_Normas_de_Convivencia' : 'Normas_de_Convivencia'}_${clean}.pdf`;
}

/**
 * @param {{building:{name:string, brand_color?:string, total_floors?:number, address?:string, city?:string},
 *          intro:string, categories:Array<{category:string, items:string[]}>,
 *          booklet?:{coverStyle:'silhouette'|'typographic'}}} data
 * Con "booklet": portada (pág. 1), página en blanco (pág. 2), contenido desde la pág. 3 numerado desde 1,
 * y páginas en blanco al final hasta completar un múltiplo de 4. A4 vertical en orden de lectura:
 * el armado del cuadernillo se configura en la impresora.
 */
export async function exportRulesPdf({ building, intro, categories, booklet = null }) {
  const cats = (categories || []).filter(c => c && Array.isArray(c.items));
  if (!cats.length) throw new Error('Este edificio todavía no tiene normas guardadas para exportar.');

  await loadScript(JSPDF_URL);
  // El cuadernillo va sin el triángulo de la esquina (solo el documento A4 normal lo lleva)
  const decoration = booklet ? null : await rasterizeDecoration(FOOTER_DECORATION);
  const logo = booklet ? await loadLogo() : null;

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

  // ---- Cuadernillo: portada y página en blanco antes del contenido ----
  if (booklet) {
    drawCover(doc, { building, style: booklet.coverStyle, logo });
    doc.addPage();   // página 2: en blanco (reverso de la portada)
    doc.addPage();   // página 3: comienza el contenido
  }

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
  const NUM_W = 15;
  const NUM_RIGHT = ML + NUM_W - 3;   // los números de categoría y de norma terminan en el mismo borde derecho
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
    // Número de categoría y de norma en la misma columna; título y texto de las normas empiezan en el mismo punto
    doc.text(`${ci + 1}.`, NUM_RIGHT, y + 5.6, { align: 'right' });
    doc.text(String(cat.category).toLocaleUpperCase('es'), ML + NUM_W, y + 5.6);
    y += 8 + 5;

    items.forEach((text, ii) => {
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const lines = doc.splitTextToSize(text, textW);
      ensure(lh * Math.min(lines.length || 1, 2));
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...ACCENT);
      doc.text(`${ci + 1}.${ii + 1}.`, NUM_RIGHT, y, { align: 'right' });
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

  // ---- Cuadernillo: se completan páginas en blanco hasta un múltiplo de 4 ----
  const contentLast = doc.getNumberOfPages();
  if (booklet) { while (doc.getNumberOfPages() % 4 !== 0) doc.addPage(); }

  // ---- Pie de página (el total se conoce al terminar) ----
  const pages = doc.getNumberOfPages();
  const box = 8;
  for (let i = 1; i <= pages; i++) {
    if (booklet && (i <= 2 || i > contentLast)) continue;   // portada, página en blanco y relleno: sin pie
    doc.setPage(i);
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(footerX, PAGE_H - 14, PAGE_W - MR, PAGE_H - 14);
    if (booklet) {
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
      doc.text('ADMINISTRACIÓN SMART', footerX, PAGE_H - 7);
      doc.setFillColor(...ACCENT).roundedRect(PAGE_W - MR - box, PAGE_H - 12.5, box, box, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...WHITE);
      doc.text(String(i - 2), PAGE_W - MR - box / 2, PAGE_H - 7, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
      doc.text(`${building.name} · Normas de Convivencia`, footerX, PAGE_H - 9);
      doc.text(`Página ${i} de ${pages}`, PAGE_W - MR, PAGE_H - 9, { align: 'right' });
    }
  }

  doc.save(rulesPdfFileName(building.name, !!booklet));
}