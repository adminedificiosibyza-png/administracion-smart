/* PDF del Resultado del Edificio y de la Caja general (A4 horizontal, texto real, tabla multipágina).
 * Mismas pautas que el PDF de reportes: encabezado compacto, tabla con encabezado repetido, totales al final,
 * pie con "Página X de Y". jsPDF + AutoTable se cargan bajo demanda (versiones fijas). */
import { loadScript, JSPDF_URL, AUTOTABLE_URL, loadLogo, money, dmy } from './reportPdf.js';

const BLUE = [30, 58, 95];          // azul oscuro #1e3a5f
const BG_ALT = [245, 247, 250];
const TEXT = [45, 52, 64];
const MUTED = [97, 108, 124];
const LINE = [222, 228, 237];
const INCOME = [52, 92, 6];
const EXPENSE = [180, 35, 24];

const clean = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const signed = n => `${n < 0 ? '-' : '+'}${money(Math.abs(n))}`;

/** Comprueba que los totales del resumen coincidan con el detalle que se va a imprimir. */
function checkTotals(rows, s, { fromDate = '', only = null } = {}) {
  const valid = rows.filter(r => r.status === 'VALIDO' && r.kind !== 'SALDO' && (!fromDate || String(r.op_date) >= fromDate));
  const sum = kind => r2(valid.filter(r => r.kind === kind).reduce((t, r) => t + Number(r.amount), 0));
  const problems = [];
  const check = k => !only || only.includes(k);
  if (check('CUOTA') && Math.abs(sum('CUOTA') - Number(s.fees_collected)) > 0.01) problems.push('las cuotas cobradas no coinciden con el detalle');
  if (check('INGRESO') && Math.abs(sum('INGRESO') - Number(s.other_income)) > 0.01) problems.push('los otros ingresos no coinciden con el detalle');
  if (check('GASTO') && Math.abs(-sum('GASTO') - Number(s.expenses_paid)) > 0.01) problems.push('los gastos pagados no coinciden con el detalle');
  if (problems.length) throw new Error(`No se generó el PDF: ${problems.join('; ')}. Actualice la pantalla e inténtelo de nuevo.`);
}

async function renderPdf({ title, subtitle, info, head, body, colStyles, totals, extra, filename, amountCol, typeCol, cautions, filtersText = '' }) {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const logo = await loadLogo();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 14, BOTTOM = 18;
  const generated = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Encabezado de la primera página
  if (logo) doc.addImage(logo, 'PNG', M, 8, 14, 14);
  const tx = logo ? M + 18 : M;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...TEXT).text(title, tx, 16);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED).text(subtitle || '', tx, 22);
  info.forEach(([label, value], i) => {
    const y = 22 - (info.length - 1 - i) * 5;   // la última línea queda a la altura del subtítulo, sin tocar la línea del encabezado
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT).text(String(value), W - M, y, { align: 'right' });
    const vw = doc.getTextWidth(String(value));
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED).text(`${label}:`, W - M - vw - 2, y, { align: 'right' });
  });
  doc.setDrawColor(...BLUE).setLineWidth(0.6).line(M, 26, W - M, 26);
  let tableStartY = 32;
  if (filtersText) {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(`Filtros aplicados: ${filtersText}`, M, 31);
    tableStartY = 35;
  }
  const compactHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXT).text(title, M, 13);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(subtitle || '', W - M, 13, { align: 'right' });
    doc.setDrawColor(...BLUE).setLineWidth(0.4).line(M, 16, W - M, 16);
  };

  const baseStyles = { font: 'helvetica', fontSize: 8.2, textColor: TEXT, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
    lineColor: LINE, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'middle' };
  const headStyles = { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.2, halign: 'center' };
  const colorize = (d) => {
    if (d.section === 'head') { d.cell.styles.halign = 'center'; return; }
    if (d.section !== 'body') return;
    if (d.column.index === amountCol || d.column.index === typeCol) {
      const income = typeCol != null ? String(d.row.raw[typeCol]) === 'INGRESO' : String(d.row.raw[amountCol]).startsWith('+');
      d.cell.styles.textColor = income ? INCOME : EXPENSE;
      if (d.column.index === amountCol) d.cell.styles.fontStyle = 'bold';
    }
  };

  doc.autoTable({ startY: tableStartY, head: [head], body, margin: { top: 24, bottom: BOTTOM, left: M, right: M }, theme: 'plain',
    rowPageBreak: 'avoid', showHead: 'everyPage', styles: baseStyles, headStyles, alternateRowStyles: { fillColor: BG_ALT },
    columnStyles: colStyles, didParseCell: colorize, didDrawPage: (d) => { if (d.pageNumber > 1) compactHeader(); } });

  // Tabla adicional (resumen por edificio), si hay
  // Alturas aproximadas (mm) para mantener juntos el resumen por edificio, los totales y las notas
  const ROW_H = 7.6;
  const totalsH = 8 + 16 + (cautions ? cautions.length * 5 : 0) + 4;
  if (extra) {
    let y = doc.lastAutoTable.finalY + 8;
    // Si el resumen por edificio y los totales no caben juntos en lo que queda de la hoja, pasan JUNTOS a la hoja siguiente
    const blockH = 8 + (extra.body.length + 1) * ROW_H + totalsH;
    if (y + blockH > H - BOTTOM) { doc.addPage(); compactHeader(); y = 24; }
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT).text(extra.title, M, y);
    doc.autoTable({ startY: y + 2, head: [extra.head], body: extra.body, margin: { top: 24, bottom: BOTTOM, left: M, right: M }, theme: 'plain',
      rowPageBreak: 'avoid', styles: baseStyles, headStyles, alternateRowStyles: { fillColor: BG_ALT }, columnStyles: extra.colStyles,
      didParseCell: (d) => { if (d.section === 'head') d.cell.styles.halign = 'center'; },
      didDrawPage: (d) => { if (d.pageNumber > 1) compactHeader(); } });
  }

  // Totales al final: una sola fila, fondo azul con letras blancas
  let y = doc.lastAutoTable.finalY + 8;
  // Los totales y sus notas nunca se parten: si no caben completos, pasan a la hoja siguiente
  if (y + totalsH - 4 > H - BOTTOM) { doc.addPage(); compactHeader(); y = 24; }
  doc.autoTable({ startY: y, head: [totals.map(t => t[0])], body: [totals.map(t => t[1])],
    margin: { top: 24, bottom: BOTTOM, left: M, right: M }, theme: 'plain', rowPageBreak: 'avoid',
    styles: { ...baseStyles, halign: 'center', lineWidth: 0 },
    headStyles: { fillColor: BLUE, fontStyle: 'normal', fontSize: 8, textColor: [214, 224, 238], halign: 'center', cellPadding: { top: 2.5, bottom: 0.5, left: 2, right: 2 } },
    bodyStyles: { fillColor: BLUE, fontStyle: 'bold', fontSize: 11, textColor: [255, 255, 255], cellPadding: { top: 0.5, bottom: 3, left: 2, right: 2 } } });

  if (cautions && cautions.length) {
    let ny = doc.lastAutoTable.finalY + 5;
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...MUTED);
    cautions.forEach(c => { if (ny > H - BOTTOM - 2) { doc.addPage(); compactHeader(); ny = 24; } doc.text(doc.splitTextToSize(c, W - 2 * M), M, ny); ny += 4.5; });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, H - 12, W - M, H - 12);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(`${subtitle || title} · Generado: ${generated}`, M, H - 7);
    doc.text(`Página ${i} de ${pages}`, W - M, H - 7, { align: 'right' });
  }
  doc.save(filename);
}

/**
 * Resultado de UN edificio en un mes. rows = libro completo (cronológico) de ese edificio; summary = get_cash_summary.
 */
export async function exportBuildingResultPdf({ buildingName, periodText, rows, summary }) {
  const list = rows.filter(r => r.status === 'VALIDO' && r.kind !== 'SALDO');
  if (!list.length) throw new Error('No hay movimientos en este período para exportar.');
  checkTotals(rows, summary);
  const body = list.map((r, i) => [i + 1, dmy(r.op_date), r.category, r.concept, r.amount > 0 ? 'INGRESO' : 'EGRESO', signed(Number(r.amount))]);
  await renderPdf({
    title: 'ESTADO DE INGRESOS Y EGRESOS', subtitle: buildingName,
    info: [['Período', periodText], ['N° de movimientos', String(list.length)]],
    head: ['Nº', 'Fecha de operación', 'Categoría', 'Concepto', 'Tipo', 'Monto'], body,
    colStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 44 }, 3: { cellWidth: 'auto' },
      4: { cellWidth: 24, halign: 'center' }, 5: { cellWidth: 34, halign: 'right' } },
    amountCol: 5, typeCol: 4,
    totals: [['Cuotas cobradas', money(summary.fees_collected)], ['Otros ingresos', money(summary.other_income)], ['Gastos pagados', money(summary.expenses_paid)],
      ['Resultado del mes', signed(Number(summary.period_result))]],
    cautions: ['Los movimientos se ubican por su fecha de operación (cuando se pagó o cobró). Las cuotas y gastos pendientes no se cuentan como dinero recibido ni pagado. En gastos compartidos solo figura la parte de este edificio.'],
    filename: `Estado_de_Ingresos_y_Egresos_${clean(buildingName)}_${clean(periodText)}.pdf`
  });
}

/**
 * Libro de movimientos de UN edificio exportado según la pestaña elegida: el "Estado de ingresos y egresos" (Todos),
 * el "Reporte de ingresos" o el "Reporte de egresos". Mismo diseño en los tres.
 * rows = movimientos que se ven (cronológicos, ya filtrados por pestaña, categoría y búsqueda); summary = get_cash_summary.
 */
export async function exportBuildingLedgerPdf({ buildingName, periodText, tab = 'TODOS', filtersText = '', rows, summary }) {
  const list = rows.filter(r => r.status === 'VALIDO' && r.kind !== 'SALDO');
  if (!list.length) throw new Error('No hay movimientos con esos filtros para exportar.');
  // Sin filtros de categoría o búsqueda, los totales deben coincidir con el resumen del período
  if (!filtersText) checkTotals(rows, summary, { only: tab === 'INGRESOS' ? ['CUOTA', 'INGRESO'] : tab === 'EGRESOS' ? ['GASTO'] : null });

  const sum = kind => r2(list.filter(r => r.kind === kind).reduce((t, r) => t + Number(r.amount), 0));
  const fees = sum('CUOTA'), other = sum('INGRESO'), spent = r2(-sum('GASTO'));
  const META = {
    TODOS: { title: 'ESTADO DE INGRESOS Y EGRESOS', file: 'Estado_de_Ingresos_y_Egresos' },
    INGRESOS: { title: 'REPORTE DE INGRESOS', file: 'Reporte_de_Ingresos' },
    EGRESOS: { title: 'REPORTE DE EGRESOS', file: 'Reporte_de_Egresos' }
  }[tab] || { title: 'ESTADO DE INGRESOS Y EGRESOS', file: 'Estado_de_Ingresos_y_Egresos' };
  const totals = tab === 'INGRESOS' ? [['Cuotas cobradas', money(fees)], ['Otros ingresos', money(other)], ['Total ingresos', money(r2(fees + other))]]
    : tab === 'EGRESOS' ? [['Gastos pagados', money(spent)], ['Total egresos', money(spent)]]
    : [['Cuotas cobradas', money(fees)], ['Otros ingresos', money(other)], ['Gastos pagados', money(spent)],
       [filtersText ? 'Resultado de lo filtrado' : 'Resultado del mes', signed(r2(fees + other - spent))]];

  // Un gasto trae "concepto · proveedor" en un solo texto: se separa para mostrarlos en columnas propias
  const split = (r) => {
    const i = r.kind === 'GASTO' ? String(r.concept).lastIndexOf(' · ') : -1;
    return i > 0 ? [String(r.concept).slice(0, i), String(r.concept).slice(i + 3)] : [r.concept, ''];
  };
  const method = r => r.method || '-';

  // Egresos e ingresos llevan más datos (proveedor, método de pago) y sin la columna Tipo, que sería igual en todas las filas
  const layouts = {
    EGRESOS: {
      head: ['Nº', 'Fecha de operación', 'Categoría', 'Concepto', 'Proveedor', 'Método de pago', 'Monto'],
      body: list.map((r, i) => { const [c, p] = split(r); return [i + 1, dmy(r.op_date), r.category, c, p || '-', method(r), signed(Number(r.amount))]; }),
      colStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 28, halign: 'center' }, 2: { cellWidth: 38 }, 3: { cellWidth: 'auto' },
        4: { cellWidth: 40 }, 5: { cellWidth: 38 }, 6: { cellWidth: 32, halign: 'right' } },
      amountCol: 6, typeCol: null
    },
    INGRESOS: {
      head: ['Nº', 'Fecha de operación', 'Categoría', 'Concepto', 'Método de pago', 'Monto'],
      body: list.map((r, i) => [i + 1, dmy(r.op_date), r.category, r.concept, method(r), signed(Number(r.amount))]),
      colStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 28, halign: 'center' }, 2: { cellWidth: 40 }, 3: { cellWidth: 'auto' },
        4: { cellWidth: 40 }, 5: { cellWidth: 32, halign: 'right' } },
      amountCol: 5, typeCol: null
    }
  };
  const layout = layouts[tab] || {
    head: ['Nº', 'Fecha de operación', 'Categoría', 'Concepto', 'Tipo', 'Monto'],
    body: list.map((r, i) => [i + 1, dmy(r.op_date), r.category, r.concept, r.amount > 0 ? 'INGRESO' : 'EGRESO', signed(Number(r.amount))]),
    colStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 44 }, 3: { cellWidth: 'auto' },
      4: { cellWidth: 24, halign: 'center' }, 5: { cellWidth: 34, halign: 'right' } },
    amountCol: 5, typeCol: 4
  };

  await renderPdf({
    title: META.title, subtitle: buildingName, filtersText,
    info: [['Período', periodText], ['N° de movimientos', String(list.length)]],
    ...layout, totals,
    cautions: ['Los movimientos se ubican por su fecha de operación (cuando se pagó o cobró). Las cuotas y gastos pendientes no se cuentan como dinero recibido ni pagado. En gastos compartidos solo figura la parte de este edificio.'],
    filename: `${META.file}_${clean(buildingName)}_${clean(periodText)}.pdf`
  });
}
/**
 * Caja general. rows = libro completo cronológico; summary = get_cash_summary; buildingName = null si es de todos los edificios.
 */
export async function exportCashGeneralPdf({ periodText, rows, summary, buildingName = null }) {
  // Con un edificio filtrado el documento es el mismo "Estado de ingresos y egresos" de ese edificio
  if (buildingName) return exportBuildingResultPdf({ buildingName, periodText, rows, summary });
  const withBalance = !buildingName && summary.account_configured && summary.opening_balance != null;
  const eff = summary.effective_from;
  const list = rows.filter(r => r.status === 'VALIDO' && (r.kind === 'SALDO' || !withBalance || String(r.op_date) >= eff));
  if (!list.length) throw new Error('No hay movimientos en este período para exportar.');
  checkTotals(rows, summary, { fromDate: withBalance ? eff : '' });

  const body = list.map((r, i) => [i + 1, dmy(r.op_date), r.category, r.concept, r.building_name || '—',
    r.amount > 0 ? 'INGRESO' : 'EGRESO', signed(Number(r.amount)), ...(withBalance ? [r.balance != null ? money(r.balance) : '—'] : [])]);
  const head = ['Nº', 'Fecha de operación', 'Categoría', 'Concepto', 'Edificio', 'Tipo', 'Monto', ...(withBalance ? ['Saldo'] : [])];
  const colStyles = { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 27, halign: 'center' }, 2: { cellWidth: 38 }, 3: { cellWidth: 'auto' },
    4: { cellWidth: 34 }, 5: { cellWidth: 20, halign: 'center' }, 6: { cellWidth: 29, halign: 'right' } };
  if (withBalance) colStyles[7] = { cellWidth: 29, halign: 'right', fontStyle: 'bold' };

  const common = { title: 'CAJA GENERAL', subtitle: '',
    info: [['Período', periodText], ['Edificio', buildingName || 'Todos los edificios'], ['N° de movimientos', String(list.length)]],
    head, body, colStyles, amountCol: 6, typeCol: 5,
    filename: `Caja_General_${clean(periodText)}${buildingName ? '_' + clean(buildingName) : ''}.pdf` };

  const notes = ['Los movimientos se ubican por su fecha de operación. Las cuotas y gastos pendientes no se cuentan como dinero recibido ni pagado.'];
  if (withBalance && summary.before_opening) {
    const b = summary.before_opening;
    notes.push(`Antes del ${dmy(summary.opening_date)} hubo cuotas por ${money(b.fees)}, otros ingresos por ${money(b.other)} y gastos por ${money(b.spent)}; ya están incluidos en el saldo inicial y no figuran en el detalle.`);
  }

  if (withBalance) {
    await renderPdf({ ...common,
      extra: (summary.by_building && summary.by_building.length) ? {
        title: 'RESUMEN POR EDIFICIO',
        head: ['Edificio', 'Cuotas cobradas', 'Otros ingresos', 'Gastos pagados', 'Resultado'],
        body: [...summary.by_building.map(b => [b.name, money(b.fees), money(b.other), money(b.spent), signed(Number(b.result))]),
          ['General', '—', money(summary.general_income), money(summary.general_expenses), signed(Number(summary.general_income) - Number(summary.general_expenses))]],
        colStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 40 }, 2: { halign: 'right', cellWidth: 40 }, 3: { halign: 'right', cellWidth: 40 }, 4: { halign: 'right', cellWidth: 40 } } } : null,
      totals: [['Saldo inicial', money(summary.opening_balance)], ['+ Cuotas cobradas', money(summary.fees_collected)], ['+ Otros ingresos', money(summary.other_income)],
        ['- Gastos pagados', money(summary.expenses_paid)], ['Saldo estimado al cierre', money(summary.closing_balance)]],
      cautions: notes });
  } else {
    await renderPdf({ ...common,
      totals: [['Cuotas cobradas', money(summary.fees_collected)], ['Otros ingresos', money(summary.other_income)], ['Gastos pagados', money(summary.expenses_paid)],
        ['Resultado del período', signed(Number(summary.period_result))]],
      cautions: notes });
  }
}
