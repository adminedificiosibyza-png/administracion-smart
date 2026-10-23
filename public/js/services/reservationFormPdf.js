/* Formato imprimible "Reserva y uso de área común" (una hoja A4 vertical, en blanco, para dejar en recepción).
 * Los datos del encabezado salen del edificio; el resto es igual para todos los edificios.
 * Usa jsPDF (cargado bajo demanda, igual que los demás PDF). */
import { loadScript, JSPDF_URL } from './reportPdf.js';
import { rasterizeDecoration, FOOTER_DECORATION } from './rulesPdf.js';

const INK = [40, 44, 40];
const GRID = [70, 76, 82];
const ACCENT = [51, 93, 113];       // mismo azul de las normas
const WHITE = [255, 255, 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const LABEL_BG = mix(ACCENT, WHITE, 0.84);

const PAGE_W = 210, ML = 14, CW = 182;
const COLS = [38, 53, 38, 53];      // etiqueta, valor, etiqueta, valor

const CONDITIONS = [
  'La reserva corresponde únicamente al día y horario indicados en este formato.',
  'La actividad deberá finalizar a la hora de término indicada. Se establece una tolerancia máxima de 15 minutos únicamente para recoger, limpiar y retirarse; esta tolerancia no constituye una ampliación del horario de uso. Cuando el uso del área sea exclusivamente para realizar labores de limpieza, el responsable podrá permanecer en ella el tiempo que resulte necesario para concluir dicha actividad, previa comunicación a la Administración. Durante este periodo, no se permitirá realizar ninguna otra actividad.',
  'El usuario deberá mantener el orden y la limpieza durante toda la actividad.',
  'Al finalizar, deberá dejar el área completamente limpia y ordenada, retirando toda basura, alimentos, bebidas, adornos, objetos y materiales utilizados.',
  'El usuario será responsable por los daños, deterioros o desperfectos ocasionados por él o por las personas que lo acompañen.',
  'Al finalizar el uso, el responsable deberá enviar a la Administración evidencia fotográfica del área limpia y ordenada. Las fotografías podrán ser revisadas dentro del horario de trabajo de la Administración.',
  'El usuario deberá respetar las normas de convivencia y las disposiciones internas del edificio.',
  'El incumplimiento podrá generar una advertencia y, en caso de reincidencia, la suspensión temporal del derecho a reservar el área común, sin perjuicio de las demás medidas que correspondan conforme a las normas internas.'
];
const DECLARATION = 'Declaro que conozco y acepto las condiciones de uso del área común y me hago responsable de su adecuado uso durante el período reservado, así como de las personas que me acompañen. Asimismo, me comprometo expresamente a entregar el área limpia, ordenada y libre de residuos al finalizar la actividad.';

export function reservationFormFileName(buildingName) {
  const clean = String(buildingName).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Formato_Reserva_Area_Comun_${clean}.pdf`;
}

/** @param {{building:{name:string}}} data */
export async function exportReservationFormPdf({ building }) {
  await loadScript(JSPDF_URL);
  const decoration = await rasterizeDecoration(FOOTER_DECORATION);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const ROW = 7, SIG_H = 19, SIG_LABEL_H = 6.5, HEAD = 5, BULLET_W = 4;
  const yStart = 44;
  const yLimit = 262;      // el adorno de la esquina inferior ocupa desde ~266 mm

  // Se elige el tamaño de letra más grande con el que todo entra en una sola hoja
  const measure = (size) => {
    doc.setFont('helvetica', 'normal').setFontSize(size);
    const lh = size * 0.42;
    const condLines = CONDITIONS.reduce((n, t) => n + doc.splitTextToSize(t, CW - BULLET_W).length, 0);
    const declLines = doc.splitTextToSize(DECLARATION, CW).length;
    return { size, lh, condH: condLines * lh + CONDITIONS.length * 0.9, declH: declLines * lh };
  };
  const fixed = yStart + (HEAD + 4 * ROW) + 4 + (HEAD + 2 * ROW) + 4 + HEAD + 3 + HEAD + 3 + (SIG_H + SIG_LABEL_H) + 4 + HEAD + 3 * ROW;
  let m = measure(6.4);
  for (const size of [9, 8.6, 8.2, 7.8, 7.4, 7, 6.6]) {
    const c = measure(size);
    if (fixed + c.condH + c.declH <= yLimit) { m = c; break; }
  }

  const line = (w = 0.25) => doc.setDrawColor(...GRID).setLineWidth(w);
  const heading = (text, y) => {
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...INK);
    doc.text(text, ML, y + 3.4);
    return y + HEAD;
  };
  // Texto que se achica si no cabe en la celda
  const fit = (text, w, size, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    let s = size;
    doc.setFontSize(s);
    while (doc.getTextWidth(text) > w - 3 && s > 6) { s -= 0.3; doc.setFontSize(s); }
  };
  const cell = (x, y, w, h, text = '', { label = false } = {}) => {
    if (label) doc.setFillColor(...LABEL_BG).rect(x, y, w, h, 'F');
    line().rect(x, y, w, h);
    if (text) {
      fit(text, w, 8.3, label);
      doc.setTextColor(...INK);
      doc.text(text, x + 1.8, y + h / 2 + 1.1);
    }
  };
  const row = (y, labels, h = ROW) => {
    let x = ML;
    labels.forEach((t, i) => { cell(x, y, COLS[i], h, t, { label: i % 2 === 0 }); x += COLS[i]; });
  };
  const slashes = (x, y, w) => {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK);
    doc.text('/', x + w * 0.36, y + ROW / 2 + 1.2);
    doc.text('/', x + w * 0.68, y + ROW / 2 + 1.2);
  };
  const checkbox = (x, y, label) => {
    line(0.3).rect(x, y + 2, 3, 3);
    doc.setFont('helvetica', 'normal').setFontSize(7.6).setTextColor(...INK);
    doc.text(label, x + 4.2, y + ROW / 2 + 1.1);
    return x + 4.2 + doc.getTextWidth(label) + 3;
  };

  // ---- adorno de la esquina inferior ----
  if (decoration) doc.addImage(decoration, 'PNG', 0, 0, 210, 297, 'DECORATION', 'FAST');

  // ---- título y nombre del edificio (sin banda de encabezado) ----
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK);
  doc.text('FORMATO DE RESERVA Y USO DE ÁREA COMÚN', PAGE_W / 2, 24, { align: 'center' });
  doc.setFontSize(12).setTextColor(...ACCENT);
  doc.text(String(building.name).toLocaleUpperCase('es'), PAGE_W / 2, 31.5, { align: 'center' });
  doc.setFillColor(...ACCENT).rect(PAGE_W / 2 - 15, 35.5, 30, 0.7, 'F');
  let y = yStart;

  // ---- 1. datos de la reserva ----
  y = heading('1. DATOS DE LA RESERVA', y);
  row(y, ['Área común:', '', 'Fecha:', '']); slashes(ML + COLS[0] + COLS[1] + COLS[2], y, COLS[3]); y += ROW;
  row(y, ['Hora de inicio:', '', 'Hora de término:', '']); y += ROW;
  row(y, ['Responsable:', '', 'Departamento:', '']); y += ROW;
  row(y, ['DNI:', '', 'Teléfono:', '']); y += ROW;
  y += 4;

  // ---- 2. motivo ----
  y = heading('2. MOTIVO DE USO', y);
  cell(ML, y, COLS[0], 2 * ROW, 'Actividad / motivo:', { label: true });
  cell(ML + COLS[0], y, CW - COLS[0], 2 * ROW);
  y += 2 * ROW + 4;

  // ---- 3. condiciones ----
  y = heading('3. CONDICIONES DE USO Y COMPROMISO', y);
  doc.setFont('helvetica', 'normal').setFontSize(m.size).setTextColor(...INK);
  CONDITIONS.forEach(t => {
    const lines = doc.splitTextToSize(t, CW - BULLET_W);
    doc.setFillColor(...INK).circle(ML + 1.2, y + m.lh * 0.45, 0.45, 'F');
    lines.forEach(l => { doc.text(l, ML + BULLET_W, y + m.lh * 0.8); y += m.lh; });
    y += 0.9;
  });
  y += 3;

  // ---- 4. declaración y firma ----
  y = heading('4. DECLARACIÓN Y FIRMA DEL USUARIO', y);
  doc.setFont('helvetica', 'normal').setFontSize(m.size).setTextColor(...INK);
  doc.splitTextToSize(DECLARATION, CW).forEach(l => { doc.text(l, ML, y + m.lh * 0.8); y += m.lh; });
  y += 3;
  const sw = CW / 3;
  ['Nombres y Apellidos', 'Firma', 'Fecha'].forEach((t, i) => {
    line().rect(ML + i * sw, y, sw, SIG_H);
    doc.setFillColor(...LABEL_BG).rect(ML + i * sw, y + SIG_H, sw, SIG_LABEL_H, 'F');
    line().rect(ML + i * sw, y + SIG_H, sw, SIG_LABEL_H);
    doc.setFont('helvetica', 'bold').setFontSize(8.3).setTextColor(...INK);
    doc.text(t, ML + i * sw + sw / 2, y + SIG_H + SIG_LABEL_H / 2 + 1.1, { align: 'center' });
  });
  y += SIG_H + SIG_LABEL_H + 4;

  // ---- 5. uso exclusivo de administración ----
  y = heading('5. USO EXCLUSIVO DE ADMINISTRACIÓN', y);
  row(y, ['Reserva:', '', 'Fecha:', '']);
  let cx = ML + COLS[0] + 2;
  cx = checkbox(cx, y, 'AUTORIZADA');
  checkbox(cx, y, 'NO AUTORIZADA');
  slashes(ML + COLS[0] + COLS[1] + COLS[2], y, COLS[3]);
  y += ROW;
  row(y, ['Observaciones:', '', 'Responsable del registro:', '']); y += ROW;
  row(y, ['Pedido recibido el:', '', 'N.° de reserva (sistema):', '']);
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK);
  const px = ML + COLS[0], py = y + ROW / 2 + 1.1;
  doc.text('/', px + 10, py);            // dd / mm / aaaa  Hora hh : mm
  doc.text('/', px + 20, py);
  doc.setFontSize(7.6).text('Hora:', px + 33, py);
  doc.setFontSize(8.3).text(':', px + 47.5, py);

  doc.save(reservationFormFileName(building.name));
}
