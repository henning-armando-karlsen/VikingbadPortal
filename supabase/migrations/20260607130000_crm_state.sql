/*
  # CRM-persistens del 2: per-kunde overlay (crm_state)

  Oppgaver og besøk lagres relasjonelt (crm_tasks/crm_visits). Resten av de
  redigerbare feltene på kundekortet (saker, utstillinger, rabatter, ønsker,
  tilbud, interne kommentarer, backup-RA og grunndata-rettelser) lagres som ett
  JSON-overlay pr. (kunde, bruker). Da blir HELE kortet varig, og endringer
  fanges uansett hvor i CRM-en de gjøres.

  1. Tabell
     - crm_state(kundenr, created_by, ra, state jsonb)
       UNIQUE (kundenr, created_by) → upsert pr. bruker.

  2. Sikkerhet (RLS)
     - Les: alle innloggede.
     - Skriv (insert/update): kun egen rad (created_by = auth.uid()) eller admin.

  3. Notater
     - Overlay overskriver de illustrative verdiene ved innlasting for kunder der
       brukeren har lagret endringer. Oppgaver/besøk ligger IKKE i overlayet.
*/

create table if not exists public.crm_state (
  kundenr     bigint not null,
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  ra          text,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (kundenr, created_by)
);
alter table public.crm_state enable row level security;

drop trigger if exists crm_state_touch on public.crm_state;
create trigger crm_state_touch before update on public.crm_state
  for each row execute function public.touch_updated_at();

drop policy if exists "crm_state read"   on public.crm_state;
drop policy if exists "crm_state insert" on public.crm_state;
drop policy if exists "crm_state update" on public.crm_state;
drop policy if exists "crm_state delete" on public.crm_state;
create policy "crm_state read"   on public.crm_state for select to authenticated using (true);
create policy "crm_state insert" on public.crm_state for insert to authenticated with check (created_by = auth.uid());
create policy "crm_state update" on public.crm_state for update to authenticated using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
create policy "crm_state delete" on public.crm_state for delete to authenticated using (created_by = auth.uid() or public.is_admin());
