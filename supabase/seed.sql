-- ==============================================================================
-- INITIAL SQL SEED DATA FOR PARKE10 (SCRIPT COMPLETO Y CORREGIDO DE POBLADO)
-- ==============================================================================

-- 1. Insertar Edificio Inicial: PARKE10
INSERT INTO buildings (
    id, code, name, address, city, country, total_units, total_floors, 
    default_due_day, elevators_count, parking_spots_count, basements_count, garage_doors_count
) VALUES (
    'b1d00000-0000-0000-0000-000000000001',
    'PK10',
    'PARKE10',
    'Av. Ejército 410, Yanahuara, Arequipa, Perú',
    'Arequipa',
    'Perú',
    52,
    11,
    5,
    2,
    52,
    2,
    2
) ON CONFLICT (code) DO NOTHING;

-- 2. Insertar Departamentos de PARKE10 (52 Unidades en 11 Pisos)
DO $$
DECLARE
    floor_num INT;
    unit_num INT;
    unit_code_str VARCHAR(20);
BEGIN
    FOR floor_num IN 1..11 LOOP
        FOR unit_num IN 1..5 LOOP
            IF (floor_num = 11 AND unit_num > 2) THEN
                EXIT; -- Solo 2 departamentos en el piso 11 (Piso 1101 y 1102)
            END IF;
            
            unit_code_str := floor_num::text || LPAD(unit_num::text, 2, '0');
            
            INSERT INTO units (building_id, code, floor, monthly_fee, status)
            VALUES ('b1d00000-0000-0000-0000-000000000001', unit_code_str, floor_num, 150.00, 'OCUPADO')
            ON CONFLICT (building_id, code) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- 3. Insertar Áreas Comunes Iniciales
INSERT INTO common_areas (
    id, building_id, name, description, capacity, opening_time, closing_time, slot_duration_hours, image_url
) VALUES 
(
    'c0000000-0000-0000-0000-000000000001',
    'b1d00000-0000-0000-0000-000000000001',
    'Piscina',
    'Piscina templada ubicada en el primer nivel del edificio.',
    15,
    '09:00',
    '21:00',
    3,
    'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=600&auto=format&fit=crop&q=80'
),
(
    'c0000000-0000-0000-0000-000000000002',
    'b1d00000-0000-0000-0000-000000000001',
    'Zona de Parrillas',
    'Zona social equipada con parrilla de acero inoxidable y comedor.',
    20,
    '11:00',
    '23:00',
    3,
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=80'
) ON CONFLICT (id) DO NOTHING;

-- 4. Insertar Regla de Interés Moratorio
INSERT INTO interest_rules (
    building_id, type, rate_percent, grace_days, applied_from_day, rounding
) VALUES (
    'b1d00000-0000-0000-0000-000000000001',
    'PORCENTAJE_DIARIO',
    0.10,
    0,
    6,
    'DOS_DECADAS'
) ON CONFLICT (building_id) DO NOTHING;

-- 5. Insertar Comunicados Iniciales
INSERT INTO announcements (
    id, building_id, title, category, date, content, is_published
) VALUES 
(
    'a0000000-0000-0000-0000-000000000001',
    'b1d00000-0000-0000-0000-000000000001',
    '🔧 Mantenimiento preventivo de bomba de agua',
    'Mantenimiento',
    CURRENT_DATE,
    'Estimados propietarios, se informa que se realizará el mantenimiento programado del sistema hidroflo de bombas de agua. Agradecemos tomar las provisiones correspondientes.',
    TRUE
),
(
    'a0000000-0000-0000-0000-000000000002',
    'b1d00000-0000-0000-0000-000000000001',
    '📢 Convocatoria a Asamblea General Ordinaria',
    'Asamblea',
    CURRENT_DATE,
    'Se invita a todos los propietarios a la Asamblea Ordinaria a realizarse en el SUM del primer piso.',
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- 6. Insertar Normas de Convivencia Iniciales
INSERT INTO rules (
    id, building_id, category, item_order, content
) VALUES
(
    'e0000000-0000-0000-0000-000000000001',
    'b1d00000-0000-0000-0000-000000000001',
    'Disposiciones generales',
    1,
    'Las presentes normas regulan la convivencia armónica de los propietarios y residentes del edificio PARKE10.'
),
(
    'e0000000-0000-0000-0000-000000000002',
    'b1d00000-0000-0000-0000-000000000001',
    'Uso de áreas comunes',
    1,
    'Toda reserva de áreas comunes (Piscina, Parrillas, SUM) debe realizarse exclusivamente a través del portal del edificio.'
),
(
    'e0000000-0000-0000-0000-000000000003',
    'b1d00000-0000-0000-0000-000000000001',
    'Ruidos y convivencia',
    1,
    'El horario de descanso rige obligatoriamente desde las 22:00 h hasta las 08:00 h.'
) ON CONFLICT (id) DO NOTHING;
