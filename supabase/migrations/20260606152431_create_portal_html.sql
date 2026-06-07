
create table public.portal_html (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  uploaded_by uuid references auth.users,
  html text not null
);
alter table public.portal_html enable row level security;

create policy "portal_html: authenticated can read"
  on public.portal_html for select to authenticated using (true);

create policy "portal_html: only admins can insert"
  on public.portal_html for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));
