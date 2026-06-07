/*
  # Legg til slot på portal_html (Analyseportal + CRM)

  Appen kan nå hoste to selvstendige HTML-applikasjoner i samme skall:
  «analyse» (analyseportalen) og «crm» (CRM-prototypen). Hver slot lagres
  som egne rader i portal_html, og appen henter nyeste rad per slot.

  1. Endringer
     - Ny kolonne `slot` (text) på `public.portal_html`
       - NOT NULL, default 'analyse' (eksisterende rader = analyseportalen)
       - CHECK i ('analyse','crm')
     - Indeks på (slot, created_at desc) for rask «nyeste per slot»-henting

  2. Sikkerhet
     - RLS-policyene fra forrige migrasjon er uendret og dekker slot:
       autentiserte kan lese, kun admin kan sette inn.

  3. Notater
     - Idempotent: bruker IF NOT EXISTS slik at migrasjonen trygt kan
       kjøres på nytt.
*/

alter table public.portal_html
  add column if not exists slot text not null default 'analyse';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portal_html_slot_check'
  ) then
    alter table public.portal_html
      add constraint portal_html_slot_check check (slot in ('analyse','crm'));
  end if;
end $$;

create index if not exists portal_html_slot_created_idx
  on public.portal_html (slot, created_at desc);
