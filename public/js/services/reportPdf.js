/* Exportación del reporte financiero mensual a PDF (A4 horizontal, texto real, tabla multipágina).
 * Biblioteca: jsPDF + jsPDF-AutoTable (cargadas bajo demanda desde cdnjs, versiones fijas). */

export const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
export const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
const GREEN = [30, 58, 95];          // azul oscuro #1e3a5f (color principal del documento)
const GREEN_SOFT = [232, 238, 246];  // azul muy suave #e8eef6
const BG_ALT = [245, 247, 250];      // #f5f7fa
const TEXT = [45, 52, 64];           // #2d3440
const MUTED = [97, 108, 124];        // #616c7c
const RED = [180, 35, 24];           // #b42318
const LINE = [222, 228, 237];        // #dee4ed

// Viñetas del estado: [fondo, texto]
const PILLS = {
  Pagado: [[221, 240, 200], [52, 92, 6]],
  Pendiente: [[252, 222, 219], [160, 30, 20]],
  'Por verificar': [[254, 238, 204], [138, 84, 6]],
  'Mora pendiente': [[254, 238, 204], [138, 84, 6]],
  'Pago parcial': [[254, 238, 204], [138, 84, 6]]
};

const loaded = new Map();
export function loadScript(url) {
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(url); reject(new Error('No se pudo cargar la biblioteca de PDF. Revise su conexión a internet.')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(url);
}

export async function loadLogo() {
  try {
    const img = new Image();
    img.src = 'assets/logo.svg';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 240;
    canvas.getContext('2d').drawImage(img, 0, 0, 240, 240);
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null; // sin logo: el encabezado queda solo con texto
  }
}

export const money = n => 'S/ ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dmy = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
};
const dash = v => (v === null || v === undefined || String(v).trim() === '') ? '-' : String(v);

export function pdfFileName(buildingName, periodText) {
  const clean = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Reporte_de_Cuotas_${clean(buildingName)}_${clean(periodText)}.pdf`;
}

/**
 * @param {{buildingName:string, periodText:string, rows:Array, summary:Object}} data
 *   rows: { unit, owner, status, fee, mora, paid, pending, payDate }
 */
export async function exportFinancialReportPdf({ buildingName, periodText, rows, summary }) {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const logo = await loadLogo();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210
  const M = 14;
  const BOTTOM = 18;
  const generated = new Date().toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // ---- Encabezado de la primera página ----
  if (logo) doc.addImage(logo, 'PNG', M, 8, 14, 14);
  const tx = logo ? M + 18 : M;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...TEXT);
  doc.text('REPORTE DE CUOTAS DE MANTENIMIENTO', tx, 16);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED);
  doc.text(buildingName, tx, 22);

  // Datos del reporte, alineados a la derecha y por encima de la línea
  const info = [['Período', periodText], ['N° de departamentos', String(rows.length)]];
  info.forEach(([label, value], i) => {
    const y = 17 + i * 5;   // pegado a la línea, alineado con la base del título
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT);
    doc.text(String(value), W - M, y, { align: 'right' });
    const vw = doc.getTextWidth(String(value));
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED);
    doc.text(`${label}:`, W - M - vw - 2, y, { align: 'right' });
  });
  doc.setDrawColor(...GREEN).setLineWidth(0.4).line(M, 26, W - M, 26);

  const drawCompactHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXT);
    doc.text('REPORTE DE CUOTAS DE MANTENIMIENTO', M, 13);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
    doc.text(`${buildingName} · ${periodText}`, W - M, 13, { align: 'right' });
    doc.setDrawColor(...GREEN).setLineWidth(0.3).line(M, 16, W - M, 16);
  };

  // ---- Detalle por departamento ----
  // Columnas de pago: "Pago 1" siempre; Pago 2 y 3 solo si algún departamento tiene más de un pago.
  // Si alguno tiene más de 3, el resto va en "Otros pagos" (el detalle completo está en el CSV).
  const maxPays = Math.max(1, ...rows.map(r => (r.pays || []).length));
  const nPayCols = Math.min(maxPays, 3);
  const hasOthers = maxPays > 3;
  const payCell = p => p ? `${money(p.amount)}\n${dmy(p.date)}` : '-';
  const body = rows.map(r => [
    dash(r.unit), dash(r.owner), dash(r.status), money(r.fee), money(r.mora),
    money(r.paid), money(r.pending),
    ...Array.from({ length: nPayCols }, (_, i) => payCell((r.pays || [])[i])),
    ...(hasOthers ? [(r.pays || []).slice(3).map(p => `${money(p.amount)} ${dmy(p.date)}`).join('\n') || '-'] : [])
  ]);
  const headLabels = ['Dpto.', 'Titular', 'Estado', 'Cuota', 'Mora', 'Total pagado', 'Saldo pendiente',
    ...Array.from({ length: nPayCols }, (_, i) => `Pago ${i + 1}`), ...(hasOthers ? ['Otros pagos'] : [])];
  const compact = nPayCols > 1;   // con varias columnas de pago se estrecha el resto para que todo entre
  const colStyles = compact
    ? { 0: { cellWidth: 13, fontStyle: 'bold' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'center' },
        3: { halign: 'right', cellWidth: 22 }, 4: { halign: 'right', cellWidth: 20 }, 5: { halign: 'right', cellWidth: 24 },
        6: { halign: 'right', cellWidth: 25 } }
    : { 0: { cellWidth: 16, fontStyle: 'bold' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 30, halign: 'center' },
        3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 32 },
        6: { halign: 'right', cellWidth: 34 } };
  for (let i = 0; i < nPayCols; i++) colStyles[7 + i] = { halign: 'center', cellWidth: compact ? 26 : 34 };
  if (hasOthers) colStyles[7 + nPayCols] = { halign: 'center', cellWidth: 32 };
  const baseStyles = {
    font: 'helvetica', fontSize: 8.5, textColor: TEXT, cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
    lineColor: LINE, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'middle'
  };

  doc.autoTable({
    startY: 32,
    head: [headLabels],
    body,
    margin: { top: 24, bottom: BOTTOM, left: M, right: M },
    theme: 'plain',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    styles: compact ? { ...baseStyles, fontSize: 7.8, cellPadding: { top: 1.8, bottom: 1.8, left: 1.8, right: 1.8 } } : baseStyles,
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: compact ? 7.8 : 8.5, halign: 'center' },
    alternateRowStyles: { fillColor: BG_ALT },
    columnStyles: colStyles,
    didParseCell: (d) => {
      if (d.section === 'head') d.cell.styles.halign = 'center';
      // El estado se dibuja como viñeta en didDrawCell: se vacía el texto para no duplicarlo
      if (d.section === 'body' && d.column.index === 2) {
        d.cell.raw = { text: d.cell.text.join(' ') };
        d.cell.text = [''];
      }
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 2) return;
      const label = d.cell.raw && d.cell.raw.text ? d.cell.raw.text : '';
      const sp = rows[d.row.index] && rows[d.row.index].statusPdf;
      const [fill, ink] = sp || PILLS[label] || [[238, 238, 238], [60, 60, 60]];
      doc.setFont('helvetica', 'bold').setFontSize(7.5);
      const tw = doc.getTextWidth(label);
      const pw = Math.min(24, d.cell.width - 2), ph = 5;   // mismo ancho para todas las viñetas
      const px = d.cell.x + (d.cell.width - pw) / 2;
      const py = d.cell.y + (d.cell.height - ph) / 2;
      doc.setFillColor(...fill).roundedRect(px, py, pw, ph, 2.5, 2.5, 'F');
      doc.setTextColor(...ink).text(label, px + (pw - tw) / 2, py + ph / 2 + 1.1);
    },
    didDrawPage: (d) => { if (d.pageNumber > 1) drawCompactHeader(); }
  });

  // ---- Totales del período (al final, en una sola fila, sin colores) ----
  const totals = [
    ['Cuota esperada', money(summary.expected)],
    ['Cuota cobrada', money(summary.collected)],
    ['Mora cobrada', money(summary.moraCollected)],
    ['Mora por cobrar', money(summary.moraInBalance)],
    ['Saldo pendiente', money(summary.balance)],
    ['% de cobranza', `${Number(summary.percentage).toFixed(2)} %`]
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
    headStyles: { fillColor: GREEN, fontStyle: 'normal', fontSize: 8, textColor: [214, 224, 238], halign: 'center',
                  cellPadding: { top: 2.5, bottom: 0.5, left: 2, right: 2 } },
    bodyStyles: { fillColor: GREEN, fontStyle: 'bold', fontSize: 11, textColor: [255, 255, 255],
                  cellPadding: { top: 0.5, bottom: 3, left: 2, right: 2 } },
    didParseCell: (d) => {
      // Sobre fondo azul oscuro el saldo pendiente va en coral claro para conservar el contraste
      if (d.section === 'body' && d.column.index === 4) d.cell.styles.textColor = [255, 176, 166];
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

  doc.save(pdfFileName(buildingName, periodText));
}
