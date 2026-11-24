-- =====================================================================
--  Apertura de puerta del portero (relé Tuya)
--  Pegá todo esto en Supabase → SQL Editor → Run. Se ejecuta una sola vez.
-- =====================================================================

-- Equipo (relé) de cada edificio
create table if not exists public.puertas (
  edificio   text primary key,                 -- archivo del edificio, ej: edificio.json
  device_id  text not null,                    -- Device ID del relé en Tuya
  codigo     text not null default 'switch_1', -- canal del relé
  pulso_ms   int  not null default 1000,       -- cuánto tiempo queda activado (0 = no lo apaga)
  updated_at timestamptz not null default now()
);

-- PIN de cada departamento (guardado con hash, nunca en texto)
create table if not exists public.puertas_pins (
  edificio   text not null,
  unidad     text not null,
  sal        text not null,
  pin_hash   text not null,
  updated_at timestamptz not null default now(),
  primary key (edificio, unidad)
);

-- Registro de aperturas e intentos
create table if not exists public.puertas_log (
  id         bigint generated always as identity primary key,
  edificio   text not null,
  unidad     text,
  ok         boolean not null,
  motivo     text,
  created_at timestamptz not null default now()
);
create index if not exists puertas_log_busqueda on public.puertas_log (edificio, unidad, created_at desc);

-- Seguridad: nadie puede leer ni escribir estas tablas desde las páginas.
-- Solo la Edge Function "puerta" accede, con la clave de servicio.
alter table public.puertas      enable row level security;
alter table public.puertas_pins enable row level security;
alter table public.puertas_log  enable row level security;
revoke all on public.puertas, public.puertas_pins, public.puertas_log from anon, authenticated;
