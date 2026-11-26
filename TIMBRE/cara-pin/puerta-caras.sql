alter table public.puertas add column if not exists kiosco_hash text;

create table if not exists public.puertas_caras (
  id         bigint generated always as identity primary key,
  edificio   text not null,
  unidad     text not null,
  descriptor jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists puertas_caras_busqueda on public.puertas_caras (edificio, unidad);

alter table public.puertas_caras enable row level security;

revoke all on public.puertas_caras from anon, authenticated;
