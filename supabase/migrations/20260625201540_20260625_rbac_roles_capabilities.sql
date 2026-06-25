/*
  # Fase 1: RBAC – roller, kapabiliteter og brukerfelt
  Merk: kapabiliteten crm.se_egen_ra defineres her, men håndheves
  først i Fase 2 (RA-skjerming av CRM-lesepolicyene).
*/
-- 1. Redigerbare rolledefinisjoner
create table if not exists public.app_roles (
  role_key     text primary key,
  label        text not null,
  capabilities text[] not null default '{}',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.app_roles enable row level security;
drop policy if exists "app_roles read"  on public.app_roles;
drop policy if exists "app_roles write" on public.app_roles;
create policy "app_roles read"  on public.app_roles for select to authenticated using (true);
create policy "app_roles write" on public.app_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
insert into public.app_roles (role_key, label, capabilities, is_system) values
  ('admin',  'Administrator', array['crm.view','crm.write','crm.se_alt','portal.upload','data.upload','kundelogg.upload','admin.brukere'], true),
  ('leder',  'Leder',         array['crm.view','crm.write','crm.se_alt'], true),
  ('selger', 'Selger',        array['crm.view','crm.write','crm.se_egen_ra'], true),
  ('lese',   'Lesetilgang',   array['crm.view','crm.se_egen_ra'], true)
on conflict (role_key) do update
  set label = excluded.label, capabilities = excluded.capabilities, is_system = excluded.is_system;
-- 2. Nye profilfelt
alter table public.profiles add column if not exists ra    text;
alter table public.profiles add column if not exists aktiv boolean not null default true;
-- 3. role: fra fast enum til FK mot app_roles
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'selger' where role = 'sales';
alter table public.profiles alter column role set default 'selger';
alter table public.profiles drop constraint if exists profiles_role_fk;
alter table public.profiles
  add constraint profiles_role_fk foreign key (role)
  references public.app_roles (role_key) on update cascade;
-- 4. Kapabilitetssjekk (security definer, unngår rekursiv RLS)
create or replace function public.has_cap(cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.app_roles r on r.role_key = p.role
    where p.id = auth.uid() and p.aktiv = true and cap = any (r.capabilities)
  );
$$;