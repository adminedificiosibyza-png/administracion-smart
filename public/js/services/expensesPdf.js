/* Exportación de la lista de gastos (egresos) del edificio a PDF (A4 horizontal, texto real, tabla multipágina).
 * Mismo estilo que el reporte de cuotas. Biblioteca: jsPDF + jsPDF-AutoTable (cargadas bajo demanda). */
import { loadScript, JSPDF_URL, AUTOTABLE_URL, loadLogo, money, dmy } from './reportPdf.js';

const NAVY = [30, 58, 95];          // azul oscuro #1e3a5f (color principal del documento)
const BG_ALT = [245, 247, 250];     // #f5f7fa
const TEXT = [45, 52, 64];          // #2d3440
const MUTED = [97, 108, 124];       // #616c7c
const LINE = [222, 228, 237];       // #dee4ed

// Viñetas del estado: [fondo, texto] (mismos colores que la pantalla de gastos)
const PILLS = {
  Pagado: [[221, 240, 200], [52, 92, 6]],
  Pendiente: [[254, 238, 204], [138, 84, 6]],
  Vencido: [[252, 222, 219], [160, 30, 20]],
  'Pago parcial': [[254, 226, 200], [170, 76, 6]],
  Anulado: [[232, 232, 232], [90, 90, 90]]
};

export function expensesPdfFileName(buildingName, periodText) {
  const clean = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Reporte_de_Egresos_${clean(buildingName)}_${clean(periodText)}.pdf`;
}

const dash = v => (v === null || v === undefined || String(v).trim() === '') ? '-' : String(v);

/**
 * @param {{buildingName:string, periodText:string, filtersText?:string,
 *          rows:Array<{period:string, opDate:string, concept:string, note?:string, category:string, provider:string,
 *                      due:string, amount:number, paid:number, balance:number, status:string, voided:boolean}>}} data
 *   Los importes de las filas anuladas no entran en los totales.
 */
export async function exportExpensesPdf({ buildingName, periodText, filtersText = '', rows }) {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const logo = await loadLogo();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210
  const M = 14;
  const BOTTOM = 18;
  const TITLE = 'REPORTE DE EGRESOS';
  const generated = new Date().toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // ---- Encabezado de la primera página ----
  if (logo) doc.addImage(logo, 'PNG', M, 8, 14, 14);
  const tx = logo ? M + 18 : M;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...TEXT);
  doc.text(TITLE, tx, 16);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED);
  doc.text(buildingName, tx, 22);

  const info = [['Período', periodText], ['N° de gastos', String(rows.length)]];
  info.forEach(([label, value], i) => {
    const y = 17 + i * 5;
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT);
    doc.text(String(value), W - M, y, { align: 'right' });
    const vw = doc.getTextWidth(String(value));
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(`${label}:`, W - M - vw - 2, y, { align: 'right' });
  });
  doc.setDrawColor(...NAVY).setLineWidth(0.4).line(M, 26, W - M, 26);

  let startY = 32;
  if (filtersText) {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
    doc.text(`Filtros aplicados: ${filtersText}`, M, 31);
    startY = 35;
  }

  const drawCompactHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXT);
    doc.text(TITLE, M, 13);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
    doc.text(`${buildingName} · ${periodText}`, W - M, 13, { align: 'right' });
    doc.setDrawColor(...NAVY).setLineWidth(0.3).line(M, 16, W - M, 16);
  };

  // ---- Detalle de gastos ----
  const body = rows.map(r => [
    dash(r.period), r.opDate ? dmy(r.opDate) : '-',
    r.note ? `${dash(r.concept)}\n${r.note}` : dash(r.concept),
    dash(r.category), dash(r.provider), r.due ? dmy(r.due) : '-',
    money(r.amount), r.paid > 0 ? money(r.paid) : '-', money(r.voided ? 0 : r.balance), dash(r.status)
  ]);
  const baseStyles = {
    font: 'helvetica', fontSize: 8.3, textColor: TEXT, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 },
    lineColor: LINE, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'middle'
  };
  const STATUS_COL = 9;

  doc.autoTable({
    startY,
    head: [['Período', 'Fecha de operación', 'Concepto', 'Categoría', 'Proveedor', 'Vencimiento', 'Importe', 'Pagado', 'Saldo', 'Estado']],
    body,
    margin: { top: 24, bottom: BOTTOM, left: M, right: M },
    theme: 'plain',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    styles: baseStyles,
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.3, halign: 'center' },
    alternateRowStyles: { fillColor: BG_ALT },
    columnStyles: {
      0: { cellWidth: 21 }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 29 },
      4: { cellWidth: 29 }, 5: { cellWidth: 22, halign: 'center' }, 6: { halign: 'right', cellWidth: 23 },
      7: { halign: 'right', cellWidth: 23 }, 8: { halign: 'right', cellWidth: 23 }, 9: { cellWidth: 26, halign: 'center' }
    },
    didParseCell: (d) => {
      if (d.section === 'head') d.cell.styles.halign = 'center';
      // El estado se dibuja como viñeta en didDrawCell: se vacía el texto para no duplicarlo
      if (d.section === 'body' && d.column.index === STATUS_COL) {
        d.cell.raw = { text: d.cell.text.join(' ') };
        d.cell.text = [''];
      }
      if (d.section === 'body' && rows[d.row.index] && rows[d.row.index].voided) d.cell.styles.textColor = [140, 148, 160];
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== STATUS_COL) return;
      const label = d.cell.raw && d.cell.raw.text ? d.cell.raw.text : '';
      const [fill, ink] = PILLS[label] || [[238, 238, 238], [60, 60, 60]];
      doc.setFont('helvetica', 'bold').setFontSize(7.5);
      const tw = doc.getTextWidth(label);
      const pw = Math.min(22, d.cell.width - 2), ph = 5;   // mismo ancho para todas las viñetas
      const px = d.cell.x + (d.cell.width - pw) / 2;
      const py = d.cell.y + (d.cell.height - ph) / 2;
      doc.setFillColor(...fill).roundedRect(px, py, pw, ph, 2.5, 2.5, 'F');
      doc.setTextColor(...ink).text(label, px + (pw - tw) / 2, py + ph / 2 + 1.1);
    },
    didDrawPage: (d) => { if (d.pageNumber > 1) drawCompactHeader(); }
  });

  // ---- Totales (al final, en una sola fila, sin colores; no cuentan los gastos anulados) ----
  const valid = rows.filter(r => !r.voided);
  const sum = k => valid.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const totals = [
    ['Gastos considerados', String(valid.length)],
    ['Importe total', money(sum('amount'))],
    ['Total pagado', money(sum('paid'))],
    ['Saldo pendiente', money(sum('balance'))]
  ];
  let y = doc.lastAutoTable.finalY + 8;
  if (y + 20 > H - BOTTOM) { doc.addPage(); drawCompactHeader(); y = 24; }
  doc.autoTable({
    startY: y,
    head: [totals.map(t => t[0])],
    body: [totals.map(t => t[1])],
    margin: { top: 24, bottom: BOTTOM, left: M, right: M },
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { ...baseStyles, halign: 'center', lineWidth: 0 },
    headStyles: { fillColor: NAVY, fontStyle: 'normal', fontSize: 8, textColor: [214, 224, 238], halign: 'center',
                  cellPadding: { top: 2.5, bottom: 0.5, left: 2, right: 2 } },
    bodyStyles: { fillColor: NAVY, fontStyle: 'bold', fontSize: 11, textColor: [255, 255, 255],
                  cellPadding: { top: 0.5, bottom: 3, left: 2, right: 2 } },
    didParseCell: (d) => {
      // Sobre fondo azul oscuro el saldo pendiente va en coral claro para conservar el contraste
      if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = [255, 176, 166];
    },
    didDrawPage: (d) => { if (d.pageNumber > 1 && d.pageNumber !== doc.internal.getNumberOfPages()) drawCompactHeader(); }
  });

  // ---- Pie de página con numeración (se conoce el total al terminar) ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, H - 12, W - M, H - 12);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(`${buildingName} · ${periodText} · Generado: ${generated}`, M, H - 7);
    doc.text(`Página ${i} de ${pages}`, W - M, H - 7, { align: 'right' });
  }

  doc.save(expensesPdfFileName(buildingName, periodText));
}
