/* Datos de pago por edificio: cuentas bancarias, WhatsApp y nota (Supabase) */
import { supabase } from '../supabaseClient.js';

export const paymentInfoService = {
  /** { whatsapp, note, accounts: [{bank, account_holder, account_number, cci}] } del edificio. */
  async load(buildingId) {
    const [b, accs] = await Promise.all([
      supabase.from('buildings').select('payment_whatsapp, payment_note').eq('id', buildingId).maybeSingle(),
      supabase.from('building_bank_accounts')
        .select('id, bank, account_holder, account_number, cci, sort_order')
        .eq('building_id', buildingId).order('sort_order').range(0, 49)
    ]);
    if (b.error) throw new Error(`No se pudieron cargar los datos de pago: ${b.error.message}`);
    if (accs.error) throw new Error(`No se pudieron cargar las cuentas de pago: ${accs.error.message}`);
    return {
      whatsapp: (b.data && b.data.payment_whatsapp) || '',
      note: (b.data && b.data.payment_note) || '',
      accounts: accs.data || []
    };
  },

  async save(buildingId, { whatsapp, note, accounts }) {
    const { data, error } = await supabase.rpc('save_payment_info', {
      p_building_id: buildingId,
      p_whatsapp: whatsapp,
      p_note: note,
      p_accounts: accounts.map(a => ({
        bank: a.bank, account_holder: a.account_holder, account_number: a.account_number, cci: a.cci
      }))
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /** Enlace para abrir WhatsApp con el número (solo dígitos) y, si se indica, un mensaje ya escrito. */
  whatsappLink(number, text = '') {
    const digits = String(number || '').replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  },

  /** Mensaje predeterminado para enviar el comprobante: igual para todos, con espacios para completar. */
  receiptMessage(buildingName) {
    return [
      'Hola, les envío la captura de mi pago de la cuota de mantenimiento.',
      '',
      `*Edificio:* ${buildingName || ''}`.trimEnd(),
      '*Departamento:* ',
      '*Mes de la cuota:* ',
      '',
      'Adjunto mi comprobante. Gracias.'
    ].join('\n');
  }
};

/** Copia un texto al portapapeles (con respaldo para navegadores sin la API). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}
