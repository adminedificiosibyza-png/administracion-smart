/* Initial Seed Data for PARKE10 - Building Management System */

import { OFFICIAL_RULES, RULES_INTRO, RULES_VERSION } from './rulesData.js';

// Debe declararse antes de INITIAL_SEED: los datos iniciales la usan al cargar el módulo
const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export const INITIAL_SEED = {
  building: {
    id: 'bld-parke10',
    code: 'PK10',
    name: 'PARKE10',
    address: 'Av. Ejército 410, Yanahuara, Arequipa, Perú',
    city: 'Arequipa',
    country: 'Perú',
    total_units: 52,
    total_floors: 11,
    default_due_day: 5, // Fee due date (5th of each month)
    
    // Configurable parameters (No hardcoded values, left editable in admin)
    elevators_count: 2, // Configurable
    parking_spots_count: 52, // Configurable
    basements_count: 2, // Configurable
    garage_doors_count: 2, // Configurable
    surveillance_hours: '24/7 Monitoreo e Ingreso Controlado'
  },

  // Common Areas Configuration
  common_areas: [
    {
      id: 'area-terraza',
      building_id: 'bld-parke10',
      name: 'Terraza – Zona de Parrillas y Piscina',
      description: 'Zona común recreativa ubicada en la terraza: zona de parrillas y piscina.',
      // Horario máximo de uso (las reservas son libres dentro de estos límites)
      schedule: {
        weekday: { open: '08:00', close: '18:00' }, // Lunes a viernes
        weekend: { open: '08:00', close: '20:00' }  // Sábados y domingos
      },
      is_active: true,
      image_url: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=600&auto=format&fit=crop&q=80'
    }
  ],
  // Overdue Interest Rules (Configurable per building)
  interest_rule: {
    building_id: 'bld-parke10',
    type: 'PORCENTAJE_DIARIO', // 'PORCENTAJE_DIARIO' or 'MONTO_FIJO'
    rate_percent: 0.1, // 0.1% per day late after the 5th
    fixed_amount: 0,
    grace_days: 0, // Applies right after 5th
    applied_from_day: 6,
    rounding: 'DOS_DECADAS', // Rounding to 2 decimal places
    is_active: true
  },

  // Units list (52 units across 11 floors)
  units: generate52Units(),

  // Sample Reservations
  reservations: [
    {
      id: 'res-001',
      code: 'PK10-00001',
      building_id: 'bld-parke10',
      area_id: 'area-terraza',
      area_name: 'Terraza – Zona de Parrillas y Piscina',
      unit_code: '502',
      owner_name: 'Carlos Mendoza',
      phone: '+51 987 654 321',
      date: '2026-10-10',
      start_time: '15:00',
      end_time: '18:00',
      motive: 'Tarde familiar',
      accepted_terms: true,
      status: 'CONFIRMADA', // CONFIRMADA, CANCELADA, FINALIZADA, BLOQUEADA
      created_at: '2026-10-01T10:30:00Z'
    },
    {
      id: 'res-002',
      code: 'PK10-00002',
      building_id: 'bld-parke10',
      area_id: 'area-terraza',
      area_name: 'Terraza – Zona de Parrillas y Piscina',
      unit_code: '101',
      owner_name: 'Ana María Torres',
      phone: '+51 954 123 789',
      date: '2026-10-10',
      start_time: '12:00',
      end_time: '15:00',
      motive: 'Almuerzo de cumpleaños',
      accepted_terms: true,
      status: 'CONFIRMADA',
      created_at: '2026-10-02T14:15:00Z'
    },
    // Solicitudes pendientes para el mismo horario: tiene prioridad la creada primero
    {
      id: 'res-003',
      code: 'PK10-00003',
      building_id: 'bld-parke10',
      area_id: 'area-terraza',
      area_name: 'Terraza – Zona de Parrillas y Piscina',
      unit_code: '502',
      owner_name: 'Carlos Mendoza',
      phone: '+51 987 654 321',
      date: '2026-10-17',
      start_time: '15:00',
      end_time: '17:00',
      motive: 'Reunión familiar',
      accepted_terms: true,
      status: 'PENDIENTE',
      created_at: '2026-10-07T10:15:12Z'
    },
    {
      id: 'res-004',
      code: 'PK10-00004',
      building_id: 'bld-parke10',
      area_id: 'area-terraza',
      area_name: 'Terraza – Zona de Parrillas y Piscina',
      unit_code: '301',
      owner_name: 'Beatriz Quispe',
      phone: '+51 954 111 222',
      date: '2026-10-17',
      start_time: '15:00',
      end_time: '17:00',
      motive: 'Cumpleaños',
      accepted_terms: true,
      status: 'PENDIENTE',
      created_at: '2026-10-07T10:23:40Z'
    }
  ],

  // Administrative Time Blocks (e.g. maintenance)
  reservation_blocks: [
    {
      id: 'blk-001',
      building_id: 'bld-parke10',
      area_id: 'area-terraza',
      area_name: 'Terraza – Zona de Parrillas y Piscina',
      date: '2026-10-15',
      start_time: '09:00',
      end_time: '18:00',
      reason: 'Mantenimiento preventivo de bombas y filtrado',
      created_by: 'Administradora PARKE10',
      created_at: '2026-10-03T09:00:00Z'
    }
  ],

  // Cuotas por período (Julio a Octubre 2026)
  maintenance_fees: generateFeeHistory(),

  // Payment History log
  payments: [
    {
      id: 'pay-001',
      fee_id: 'fee-2026-10-502',
      unit_code: '502',
      owner_name: 'Carlos Mendoza',
      period: 'Octubre 2026',
      amount: 150.00,
      payment_date: '2026-10-03',
      method: 'Transferencia bancaria',
      operation_number: 'BCP-98451204',
      status: 'VERIFICADO', // VERIFICADO, POR_VERIFICAR, RECHAZADO
      notes: 'Pago puntual cuota de mantenimiento Octubre',
      proof_file: 'comprobante_dpto502_oct2026.pdf',
      registered_by: 'Administradora PARKE10',
      registered_at: '2026-10-03T11:20:00Z'
    }
  ],

  // Announcements / Comunicados
  announcements: [
    {
      id: 'ann-001',
      building_id: 'bld-parke10',
      title: '🔧 Mantenimiento preventivo de bomba de agua',
      category: 'Mantenimiento',
      date: '2026-10-05',
      content: 'Estimados propietarios, se informa que el día jueves 8 de octubre de 08:00 h a 11:00 h se realizará el mantenimiento programado del sistema hidroflo de bombas de agua. Agradecemos tomar las provisiones correspondientes.',
      is_published: true,
      attachment_url: null,
      created_at: '2026-10-05T08:00:00Z'
    },
    {
      id: 'ann-002',
      building_id: 'bld-parke10',
      title: '📢 Convocatoria a Asamblea General Ordinaria',
      category: 'Asamblea',
      date: '2026-09-28',
      content: 'Se invita a todos los propietarios a la Asamblea Ordinaria a realizarse el día sábado 17 de octubre a las 19:00 h en el SUM (primer piso). Se tratará la presentación del informe de gestión y aprobación de presupuesto 2027.',
      is_published: true,
      attachment_url: 'convocatoria_asamblea_2026.pdf',
      created_at: '2026-09-28T15:30:00Z'
    }
  ],

  // Normas de convivencia oficiales (ver rulesData.js)
  rules_version: RULES_VERSION,
  rules_intro: RULES_INTRO,
  rules: JSON.parse(JSON.stringify(OFFICIAL_RULES)),

  // Administrative Audit Log
  audit_logs: [
    {
      id: 'aud-001',
      building_id: 'bld-parke10',
      action: 'REGISTRO_PAGO',
      description: 'Registró el pago de cuota de Octubre para el Dpto 502 por el monto de S/ 150.00 (Operación BCP-98451204)',
      performed_by: 'Administradora PARKE10',
      timestamp: '2026-10-03T11:20:00Z'
    },
    {
      id: 'aud-002',
      building_id: 'bld-parke10',
      action: 'BLOQUEO_RESERVA',
      description: 'Creó un bloqueo de horario en la Piscina para el 15/10/2026 motivo: Mantenimiento preventivo',
      performed_by: 'Administradora PARKE10',
      timestamp: '2026-10-03T09:00:00Z'
    }
  ]
};

// Helper: Generate 52 Units across 11 floors for PARKE10
function generate52Units() {
  const units = [];
  const names = [
    'Ana María Torres', 'Luis Fernando Gómez', 'Beatriz Quispe', 'Carlos Mendoza',
    'Diego Vargas', 'Elena Ramos', 'Francisco Huamán', 'Gabriela Flores',
    'Hugo Alarcón', 'Inés Gutiérrez', 'Javier Beltrán', 'Karen Salcedo',
    'Leonardo Pacheco', 'Mónica Espinoza', 'Néstor Cárdenas', 'Olga Zúñiga'
  ];

  let unitIndex = 1;
  for (let floor = 1; floor <= 11; floor++) {
    // 5 units per floor for floors 1 to 10 (50 total) + 2 units on floor 11 (2 total) = 52 units
    const unitsOnFloor = floor === 11 ? 2 : (floor === 10 ? 5 : 5);
    for (let u = 1; u <= unitsOnFloor; u++) {
      if (unitIndex > 52) break;
      const unitNum = `${floor}${String(u).padStart(2, '0')}`;
      const ownerName = unitNum === '502' ? 'Carlos Mendoza' : names[(unitIndex - 1) % names.length];
      const phone = unitNum === '502' ? '+51 987 654 321' : `+51 9${Math.floor(10000000 + Math.random() * 90000000)}`;
      const email = unitNum === '502' ? 'carlos.mendoza@parke10.pe' : `propietario${unitNum}@parke10.pe`;

      units.push({
        id: `unit-${unitNum}`,
        building_id: 'bld-parke10',
        code: unitNum,
        floor: floor,
        owner_name: ownerName,
        phone: phone,
        email: email,
        monthly_fee: 150.00,
        status: 'OCUPADO'
      });
      unitIndex++;
    }
  }
  return units;
}

// Etiqueta legible de un período: '2026-10-01' -> 'Octubre 2026'
export function periodLabel(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

// Helper: cuotas Julio-Octubre 2026 (52 deptos por mes). Octubre mantiene
// el resumen original: 43 pagadas, 2 por verificar, 7 pendientes.
// days_late / interest_amount se recalculan automáticamente al leer (ver feeService).
export function generateFeeHistory() {
  const units = generate52Units();
  const fees = [];
  const months = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];

  months.forEach(periodMonth => {
    const ym = periodMonth.slice(0, 7);
    const dueDate = `${ym}-05`;
    units.forEach((unit, idx) => {
      let status = 'PAGADO';
      let paymentDate = `${ym}-03`;

      if (ym === '2026-10') {
        if (unit.code === '502') { paymentDate = '2026-10-03'; }
        else if (idx < 7) { status = 'PENDIENTE'; paymentDate = null; }
        else if (idx < 9) { status = 'POR_VERIFICAR'; paymentDate = '2026-10-04'; }
      } else if (ym === '2026-09') {
        if (idx < 3) { status = 'PENDIENTE'; paymentDate = null; }
        else if (idx === 10 || idx === 11) { paymentDate = '2026-09-12'; } // pago tardío
      } else if (ym === '2026-08') {
        if (idx === 0) { status = 'PENDIENTE'; paymentDate = null; }
        else if (idx === 12) { paymentDate = '2026-08-09'; } // pago tardío
      }

      const feeAmount = 150.00;
      fees.push({
        id: `fee-${ym}-${unit.code}`,
        building_id: 'bld-parke10',
        unit_id: unit.id,
        unit_code: unit.code,
        owner_name: unit.owner_name,
        period: periodLabel(periodMonth),
        period_month: periodMonth,
        due_date: dueDate,
        fee_amount: feeAmount,
        days_late: 0,
        interest_amount: 0,
        total_amount: feeAmount,
        total_pending: status === 'PAGADO' ? 0 : feeAmount,
        status: status,
        payment_date: paymentDate
      });
    });
  });

  return fees;
}