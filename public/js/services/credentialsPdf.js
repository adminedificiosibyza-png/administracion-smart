/* Credenciales de acceso en PDF: tarjeta horizontal de 9.66 x 6.8 cm, para imprimir y pegar como adhesivo.
 * Se genera en el navegador (la contraseña no sale de la computadora). jsPDF se carga bajo demanda. */
import { loadScript, JSPDF_URL } from './reportPdf.js';

const PORTAL_URL = 'https://portal.ibyzaedificios.com';

// QR que apunta DIRECTO al portal (sin servicios intermedios). Matriz 29 x 29, nivel de corrección M.
// Para cambiar el dominio hay que generar otra matriz con la nueva dirección y reemplazar estas filas.
const QR_ROWS = [
  '11111110100100011111101111111', '10000010110110110100101000001', '10111010001011110011101011101',
  '10111010111000001100001011101', '10111010011101000101001011101', '10000010001010100111101000001',
  '11111110101010101010101111111', '00000000111001100100000000000', '10110111010001101111001001011',
  '00111001110010011111111110001', '11010010111110110100000100110', '00001001100101110011011100001',
  '11001111001000000100000101100', '01101000010101000101001000111', '01001111100110100101010010111',
  '01011001001001011001010010010', '01001011010100010011000011010', '01100101011111010100100101110',
  '10011110110010011010101100100', '00110001110110011110101010100', '01010111110101011110111111100',
  '00000000100001101111100011111', '11111110101101001011101011010', '10000010100000011010100011011',
  '10111010000000110100111110110', '10111010110100111110010111001', '10111010110010101101000100101',
  '10000010001101101000111011010', '11111110110100010001110101010'
];

const ACCENT = [51, 93, 113];       // #335d71, el azul de las normas
const TEXT = [34, 40, 44];
const MUTED = [112, 120, 126];
const INK = [28, 34, 38];           // módulos del QR
const PANEL = [236, 241, 244];      // recuadros suaves (usuario y contraseña, QR)
const DIVIDER = [214, 223, 228];    // líneas finas de separación
const WHITE = [255, 255, 255];
// Tamaño final de la tarjeta: 96.6 x 68.1 mm (9.66 x 6.8 cm). El diseño está pensado sobre 105 x 74 mm (A7);
// este envoltorio reduce todas las medidas y tamaños de letra en la misma proporción, para no rehacer las coordenadas.
const DESIGN_W = 105, DESIGN_H = 74, SCALE = 0.92;

function scaled(doc, S) {
  const proxy = new Proxy(doc, {
    get(target, prop) {
      const fn = target[prop];
      if (typeof fn !== 'function') return fn;
      return (...args) => {
        let a = args;
        if (prop === 'setFontSize' || prop === 'setLineWidth') a = [args[0] * S];
        else if (prop === 'text') a = args.map((v, i) => (i === 1 || i === 2) ? v * S : v);
        else if (prop === 'rect' || prop === 'line') a = args.map((v, i) => i < 4 ? v * S : v);
        else if (prop === 'roundedRect') a = args.map((v, i) => i < 6 ? v * S : v);
        else if (prop === 'splitTextToSize') a = [args[0], args[1] * S, ...args.slice(2)];
        const r = fn.apply(target, a);
        if (prop === 'getTextWidth') return r / S;
        return r === target ? proxy : r;
      };
    }
  });
  return proxy;
}
const clean = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function credentialsPdfFileName(loginName) {
  return `Credenciales_${clean(loginName)}.pdf`;
}

/**
 * @param {{loginName:string, password:string, places?:Array<{unit:string, building:string}>}} data
 *   places: departamento(s) y edificio(s) de la persona (puede ir vacío si todavía no tiene departamento).
 */
export async function exportCredentialsPdf({ loginName, password, places = [] }) {
  await loadScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const doc = scaled(new jsPDF({ orientation: 'landscape', unit: 'mm', format: [DESIGN_H * SCALE, DESIGN_W * SCALE] }), SCALE);
  const W = DESIGN_W, H = DESIGN_H;              // se dibuja sobre 105 x 74; el envoltorio lo reduce al tamaño final

  // Todo se alinea con el texto del recuadro sombreado; el recuadro sobresale 3.5 mm a la izquierda
  const PANEL_X = 6, PANEL_W = 64.5, PAD = 3.5;
  const LEFT = PANEL_X + PAD, RIGHT = W - 8, COL_W = PANEL_W - 2 * PAD;
  const CARD_X = PANEL_X + PANEL_W + 2, CARD_W = RIGHT - CARD_X;

  // Texto ajustado al ancho: baja el tamaño de letra hasta que entre en las líneas permitidas
  const fit = (text, { font = 'helvetica', style = 'normal', size, maxW, maxLines, min = 5 }) => {
    let s = size, lines;
    do {
      doc.setFont(font, style).setFontSize(s);
      lines = doc.splitTextToSize(String(text), maxW);
      if (lines.length <= maxLines) break;
      s -= 0.4;
    } while (s > min);
    return { lines, size: s };
  };
  const lh = size => size * 0.42;
  // Una sola línea que se achica hasta caber en el ancho
  const oneLine = (text, { style = 'bold', size, maxW, min = 5 }) => {
    let s = size;
    doc.setFont('helvetica', style).setFontSize(s);
    while (doc.getTextWidth(String(text)) > maxW && s > min) { s -= 0.3; doc.setFontSize(s); }
    return s;
  };
  // Letras separadas a mano (mayúsculas pequeñas): sin depender de opciones de la librería
  const spaced = (text, x, y, gap, align = 'left') => {
    const chars = [...String(text)];
    const total = chars.reduce((w, ch) => w + doc.getTextWidth(ch), 0) + gap * (chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : x;
    chars.forEach(ch => { doc.text(ch, cx, y); cx += doc.getTextWidth(ch) + gap; });
  };
  const label = (text, y) => doc.setFont('helvetica', 'bold').setFontSize(5).setTextColor(...MUTED).text(text, LEFT, y);

  // ---- edificio y departamentos ----
  const groups = [];
  places.forEach(p => {
    let g = groups.find(x => x.building === p.building);
    if (!g) { g = { building: p.building, units: [] }; groups.push(g); }
    g.units.push(p.unit);
  });
  groups.forEach(g => g.units.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })));
  groups.sort((a, b) => String(a.building).localeCompare(String(b.building), 'es'));
  const single = groups.length === 1;

  // ---- marco fino (el borde del adhesivo) ----
  doc.setDrawColor(...ACCENT).setLineWidth(0.5).roundedRect(2, 2, W - 4, H - 4, 3, 3, 'S');

  // ---- encabezado: nombre del edificio y portal; a la derecha, el departamento ----
  const TITLE_MAX = 44;
  if (single) {
    const name = String(groups[0].building).toLocaleUpperCase('es');
    const size = oneLine(name, { size: 14, maxW: TITLE_MAX, min: 6.5 });
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...ACCENT).text(name, LEFT, 12.6);
    doc.setFont('helvetica', 'normal').setFontSize(4.8).setTextColor(...MUTED);
    spaced('PORTAL DE PROPIETARIOS', LEFT, 16.6, 0.35);
    const unitsLabel = groups[0].units.length > 1 ? 'DEPARTAMENTOS' : 'DEPARTAMENTO';
    const unitsText = groups[0].units.join(', ');
    const us = oneLine(unitsText, { size: 10, maxW: 36, min: 6 });
    doc.setFont('helvetica', 'bold').setFontSize(4.8).setTextColor(...MUTED);
    const cy = 12.85;   // centro vertical del título + subtítulo de la izquierda
    spaced(unitsLabel, RIGHT - [...unitsLabel].reduce((w, ch) => w + doc.getTextWidth(ch), 0) - 0.35 * (unitsLabel.length - 1), cy - 1.84, 0.35);
    doc.setFont('helvetica', 'bold').setFontSize(us).setTextColor(...ACCENT).text(unitsText, RIGHT, cy + 3.03, { align: 'right' });
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(9.6).setTextColor(...ACCENT).text('PORTAL DE PROPIETARIOS', LEFT, 13.4);
    if (groups.length) {   // varios edificios: una línea por edificio, alineadas a la derecha
      const rows = groups.map(g => `${g.building}: Dpto ${g.units.join(', ')}`);
      let size = 5.6;
      doc.setFont('helvetica', 'bold');
      while (size > 4.2 && (Math.max(...rows.map(r => { doc.setFontSize(size); return doc.getTextWidth(r); })) > 38 || rows.length * lh(size) * 1.2 > 10.5)) size -= 0.2;
      doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...ACCENT);
      const step = lh(size) * 1.2, capH = size * 0.3528 * 0.72, cy = 12.2;   // cy: centro vertical del título de la izquierda
      const first = cy - (rows.length - 1) * step / 2 + capH / 2;
      rows.forEach((r, i) => doc.text(r, RIGHT, first + i * step, { align: 'right' }));
    }
  }
  doc.setDrawColor(...DIVIDER).setLineWidth(0.25).line(LEFT, 19.6, RIGHT, 19.6);

  // ---- recuadro sombreado con usuario y contraseña ----
  const user = fit(loginName, { style: 'bold', size: 11.5, maxW: COL_W, maxLines: 2 });
  const pass = fit(password, { font: 'courier', style: 'bold', size: 15, maxW: COL_W, maxLines: 1 });
  const panelTop = 23;
  const userBase = panelTop + 4.2 + 5.2;
  const label2 = userBase + (user.lines.length - 1) * lh(user.size) + 5.6;
  const passBase = label2 + 5.8;
  const panelBottom = Math.max(passBase + 3.2, panelTop + 26.6);
  doc.setFillColor(...PANEL).roundedRect(PANEL_X, panelTop, PANEL_W, panelBottom - panelTop, 2.2, 2.2, 'F');
  label('USUARIO (NOMBRE COMPLETO)', panelTop + 4.2);
  doc.setFont('helvetica', 'bold').setFontSize(user.size).setTextColor(...TEXT);
  user.lines.forEach((l, i) => doc.text(l, LEFT, userBase + i * lh(user.size)));
  label('CONTRASEÑA', label2);
  doc.setFont('courier', 'bold').setFontSize(pass.size).setTextColor(...TEXT).text(pass.lines[0], LEFT, passBase);

  // ---- tarjeta suave con el QR y su leyenda ----
  const QR_SIZE = 19.6, n = QR_ROWS.length, m = QR_SIZE / n;
  doc.setFillColor(...PANEL).roundedRect(CARD_X, panelTop, CARD_W, panelBottom - panelTop, 2.2, 2.2, 'F');
  const qx = CARD_X + (CARD_W - QR_SIZE) / 2, qy = panelTop + 2.4;
  doc.setFillColor(...WHITE).rect(qx - 1, qy - 1, QR_SIZE + 2, QR_SIZE + 2, 'F');   // zona en blanco que necesita el lector
  doc.setFillColor(...INK);
  QR_ROWS.forEach((row, r) => { for (let c = 0; c < n; c++) if (row[c] === '1') doc.rect(qx + c * m, qy + r * m, m + 0.02, m + 0.02, 'F'); });
  doc.setFont('helvetica', 'bold').setFontSize(4.3).setTextColor(...ACCENT);
  spaced('ESCANEE PARA INGRESAR', CARD_X + CARD_W / 2, panelBottom - 2, 0.12, 'center');

  // ---- abajo: sitio web a la izquierda y aviso de seguridad a la derecha ----
  const top = panelBottom + 5.2;
  const SPLIT = 53.5;
  doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(...ACCENT).text(PORTAL_URL, LEFT, top + 2.4);
  doc.setFont('helvetica', 'normal').setFontSize(5).setTextColor(...MUTED);
  doc.text(['Ingrese desde su celular', 'o computadora.'], LEFT, top + 6);
  doc.setDrawColor(...DIVIDER).setLineWidth(0.25).line(SPLIT, top - 0.4, SPLIT, top + 9.2);
  doc.setFont('helvetica', 'normal').setFontSize(5).setTextColor(...MUTED);
  doc.text(doc.splitTextToSize('Por seguridad, cambie su contraseña en el primer ingreso («Mi Perfil») y no comparta sus credenciales.', RIGHT - SPLIT - 4), SPLIT + 4, top + 2.4);

  doc.save(credentialsPdfFileName(loginName));
}