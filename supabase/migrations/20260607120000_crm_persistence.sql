/*
  # CRM-persistens: oppgaver, besøk, pipeline og sentral kundelogg

  Gjør CRM-ens operative data ekte og varig, lagret per RA. CRM-en leser/skriver
  disse direkte mot Supabase (PostgREST) med innlogget brukers JWT, slik at RLS
  gjelder. Kundeloggen lagres sentralt og mates inn i appen via vbKundelogg.

  1. Nye tabeller
     - crm_tasks    – oppgaver pr. kunde (tittel, frist, status, prioritet)
     - crm_visits   – logget dialog/besøk pr. kunde (dato, type, tittel, notat, neste_steg)
     - crm_pipeline – salgsmuligheter pr. kunde (tittel, type, verdi, sannsynlighet, stage)
     - crm_kundelogg – sentral, komprimert kundelogg (base64 LZString av hendelser)
     Alle operative rader har `kundenr`, `ra` (RA-region som eier), `created_by`.

  2. Sikkerhet (RLS)
     - Alle innloggede kan LESE operative rader (RA ser portefølje, backup og leder ser alt).
     - INSERT krever created_by = auth.uid().
     - UPDATE/DELETE kun for egen rad (created_by = auth.uid()) eller admin.
     - crm_kundelogg: alle innloggede leser, kun admin skriver.

  3. Hjelpere
     - public.is_admin() (security definer) for å unngå rekursiv RLS mot profiles.
     - updated_at settes av trigger.

  4. Notater
     - Idempotent der det er praktisk (IF NOT EXISTS / drop-create policy).
*/

-- Admin-sjekk uten rekursiv RLS
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Felles updated_at-trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------------- crm_tasks (oppgaver) ----------------
create table if not exists public.crm_tasks (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  kundenr     bigint not null,
  ra          text,
  tittel      text not null,
  frist       date,
  status      text not null default 'apen' check (status in ('apen','ferdig')),
  prioritet   text not null default 'middels' check (prioritet in ('hoy','middels','lav'))
);
create index if not exists crm_tasks_kundenr_idx on public.crm_tasks (kundenr);
create index if not exists crm_tasks_ra_idx on public.crm_tasks (ra);
alter table public.crm_tasks enable row level security;

-- ---------------- crm_visits (besøk/dialog) ----------------
create table if not exists public.crm_visits (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  kundenr     bigint not null,
  ra          text,
  dato        date not null default current_date,
  type        text not null default 'annet' check (type in ('besok','mote','telefon','epost','tilbud','annet')),
  tittel      text,
  notat       text,
  neste_steg  text
);
create index if not exists crm_visits_kundenr_idx on public.crm_visits (kundenr);
create index if not exists crm_visits_ra_idx on public.crm_visits (ra);
alter table public.crm_visits enable row level security;

-- ---------------- crm_pipeline (salgsmuligheter) ----------------
create table if not exists public.crm_pipeline (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid not null default auth.uid() references auth.users on delete cascade,
  kundenr       bigint not null,
  ra            text,
  tittel        text not null,
  type          text,
  verdi         numeric default 0,
  sannsynlighet int default 50,
  stage         text not null default 'ny' check (stage in ('ny','kvalifisert','tilbud','forhandling','vunnet','tapt'))
);
create index if not exists crm_pipeline_kundenr_idx on public.crm_pipeline (kundenr);
alter table public.crm_pipeline enable row level security;

-- updated_at-triggere
drop trigger if exists crm_tasks_touch on public.crm_tasks;
create trigger crm_tasks_touch before update on public.crm_tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists crm_visits_touch on public.crm_visits;
create trigger crm_visits_touch before update on public.crm_visits
  for each row execute function public.touch_updated_at();
drop trigger if exists crm_pipeline_touch on public.crm_pipeline;
create trigger crm_pipeline_touch before update on public.crm_pipeline
  for each row execute function public.touch_updated_at();

-- RLS-policyer (felles mønster) for de tre operative tabellene
do $$
declare t text;
begin
  foreach t in array array['crm_tasks','crm_visits','crm_pipeline'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s;', t);
    execute format('create policy "%1$s read"   on public.%1$s for select to authenticated using (true);', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to authenticated with check (created_by = auth.uid());', t);
    execute format('create policy "%1$s update" on public.%1$s for update to authenticated using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());', t);
    execute format('create policy "%1$s delete" on public.%1$s for delete to authenticated using (created_by = auth.uid() or public.is_admin());', t);
  end loop;
end $$;

-- ---------------- crm_kundelogg (sentral kundelogg) ----------------
create table if not exists public.crm_kundelogg (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  uploaded_by uuid references auth.users,
  n_entries   int,
  payload_lz  text not null            -- base64 LZString av hendelses-array [{k,d,s,c}]
);
alter table public.crm_kundelogg enable row level security;
drop policy if exists "crm_kundelogg read" on public.crm_kundelogg;
drop policy if exists "crm_kundelogg insert" on public.crm_kundelogg;
create policy "crm_kundelogg read" on public.crm_kundelogg
  for select to authenticated using (true);
create policy "crm_kundelogg insert" on public.crm_kundelogg
  for insert to authenticated with check (public.is_admin());
