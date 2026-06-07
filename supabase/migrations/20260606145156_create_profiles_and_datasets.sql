
-- 4.1 Profiler med rolle
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'sales' check (role in ('sales','admin')),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

create policy "profiles: authenticated can read"
  on public.profiles for select to authenticated using (true);

-- Opprett profil automatisk ved ny bruker
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4.2 Datasett
create table public.datasets (
  id            bigint generated always as identity primary key,
  created_at    timestamptz default now(),
  uploaded_by   uuid references auth.users,
  filename      text,
  period_label  text,
  n_customers   int,
  n_lines       int,
  total_revenue numeric,
  payload_lz    text not null
);
alter table public.datasets enable row level security;

create policy "datasets: authenticated can read"
  on public.datasets for select to authenticated using (true);

create policy "datasets: only admins can insert"
  on public.datasets for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));
