# CRM integrert i Vikingbad-portalen

CRM-prototypen er nå en fullverdig del av appskallet, side om side med analyseportalen.
Du bytter mellom dem med en segmentvelger i topplinjen (**Analyseportal ↔ CRM**).

## Hva som er endret

**Databasen** — `supabase/migrations/20260607100000_add_slot_to_portal_html.sql`
- Ny kolonne `slot` på `portal_html` (`'analyse'` | `'crm'`, default `'analyse'`).
- Eksisterende rader blir automatisk `'analyse'`, så analyseportalen virker som før.
- Indeks `(slot, created_at desc)` for rask «nyeste per slot»-henting.
- RLS er uendret: alle innloggede kan lese, kun admin kan laste opp.

**Appen**
- `src/App.tsx` — henter nyeste HTML for begge slots, holder en `view`-tilstand
  (lagres i `localStorage['vbView']`), og monterer **to** iframes samtidig.
  Bytte av visning skjer ved å vise/skjule – ingen reload, så CRM-tilstand bevares.
- `src/components/PortalFrame.tsx` — generalisert ramme som fyller containeren og
  kan skjules uten å avmonteres (`hidden`).
- `src/components/TopBar.tsx` — felles topplinje for **alle** roller, med
  segmentvelger. Admin får i tillegg tre opplastingsknapper: **Portal**, **CRM**
  og **Datasett**.
- `src/lib/supabase.ts` — ny type `PortalSlot`.
- `public/crm.html` — den medfølgende CRM-prototypen, brukt som standard.

## Slik virker CRM-innlastingen
1. Finnes en opplastet CRM i databasen (`slot='crm'`) → den brukes.
2. Ellers faller appen tilbake til `public/crm.html` (følger med bygget),
   så CRM-en er tilgjengelig umiddelbart uten opplasting.

Admin kan når som helst laste opp en ny CRM-HTML via **CRM**-knappen i topplinjen,
nøyaktig som med analyseportalen.

## Full datakobling: CRM hydreres fra analyseportalens datasett

CRM-en bygger nå hele kundeuniverset fra **samme datasett som
analyseportalen** (`localStorage['vbDataset2']`), i stedet for hardkodede
`const DATA`. Hydreringen ligger i en tydelig merket blokk øverst i CRM-ens
script (`public/crm.html`), rett etter `DATA`/`KAMP`-definisjonene, og kjører
før resten av appen. Finnes intet datasett, faller CRM-en tilbake til de
innebygde demodataene.

**Dette kommer fra analyseportalen (live):**
kundenr, navn, segment, score, fylke, poststed, RA-region, siste kontaktdato
(fra kundeloggen), helår i fjor, hittil i fjor/i år, utvikling (vokser/faller/…),
utvikling i kr og %, budsjett hittil, budsjettoppnåelse, DG%, og årsbudsjett.
Disse driver KPI-er, «Min dag»-prioritering, neste-beste-handling,
kontaktmålstatus, kundekort, segment- og RA-filter («Vis som»), og
ledelsesaggregatene.

**Avledet av reelle data + Betjeningsmodellen:**
- `status` (aktiv/hvilende) fra utviklingskategorien.
- Kontaktmål i dager per segment fra minimumsrytmen (A≈30, B≈37, C≈90, D/E≈180).
- Reell siste kontakt legges som én logg-post slik at «utenfor kontaktmål»
  beregnes mot ekte dato.

**Ekte dialog fra kundeloggen (37 542 hendelser):**
Kundeloggen er bakt inn i CRM-en (komprimert) og legges på hvert kundekort som
dialog-/aktivitetshistorikk, matchet på kundenr. Den driver «Dialog»-fanen,
Aktiviteter-modulen, «siste dialog»/kontaktmål på Min dag, og aktivitetstallene
i Ledelse. Loggtypene mappes til CRM-ens aktivitetstyper (Utgående→telefon,
E-post/SMS→e-post, Fysisk møte→besøk osv.). CRM-en leser primært
`localStorage['vbKundelogg']` hvis appen legger den der, ellers den innebygde
loggen — så den kan oppdateres uten ombygging.

**Komplett kundekort (illustrative felt):**
For at kortet skal være komplett (forhåndsvisning mot ledelse) fylles øvrige
operative/eksterne felt deterministisk pr. kunde: kontaktpersoner, kreditt,
Brreg/DNB, kategorimiks (forankret i ekte YTD-tall), oppgaver (avledet av ekte
risiko/kontaktmål), pipeline, rabatter, saker, utstillinger og
kampanjedeltakelse. Disse er illustrative, ikke ekte kilder – jf. bunnteksten i
CRM-en. Neste steg for at de skal bli ekte og varige er egne Supabase-tabeller
(med RLS per RA) + Brreg/DNB-integrasjon.

CRM-en bygges av `tools/build_crm.cjs` (+ `tools/hydration.js`); se `tools/README.md`.

> RA-dimensjonen: datasettet har RA-**region**, ikke selgernavn. «Vis som»
> filtrerer derfor på region. Vil du ha navngitt RA/selger må Kundedata-arket
> inneholde en selger-/KAM-kolonne som tas inn i `recompute.js`.

## Deploy
1. Kjør den nye migrasjonen mot Supabase-prosjektet (idempotent og trygg å
   kjøre på nytt):
   `supabase/migrations/20260607100000_add_slot_to_portal_html.sql`
2. `npm install && npm run build` (krever `VITE_SUPABASE_URL` og
   `VITE_SUPABASE_ANON_KEY` i miljøet).
3. Publiser `dist/` som før.

Ingen datamigrering av innhold trengs – CRM-en lastes fra den medfølgende fila
til du eventuelt laster opp en oppdatert versjon.

## Persistens og sentral datakobling (klar for Bolt)

**Migrasjon `20260607120000_crm_persistence.sql`** legger til:
- `crm_tasks`, `crm_visits`, `crm_pipeline` — operative data pr. kunde, lagret
  per RA (`ra` + `created_by`). RLS: alle innloggede leser (RA ser portefølje,
  leder/backup ser alt); man endrer/sletter kun egne rader (eller admin).
- `crm_kundelogg` — sentral kundelogg (base64 LZString). Alle leser, kun admin skriver.
- `is_admin()` (security definer) for å unngå rekursiv RLS mot `profiles`.

**Slik henger det sammen:**
- Appen injiserer `window.__VB_CFG__` (Supabase-URL + anon-nøkkel) i CRM-iframen
  via `PortalFrame.headInject`. CRM-en lager ingen egen innlogging — den henter
  brukerøkten fra `localStorage` (samme origin) og kaller PostgREST med brukerens
  JWT, så RLS gjelder.
- Ved innlogging laster appen nyeste kundelogg til `localStorage['vbKundelogg']`.
  CRM-en bruker den foran den innebygde loggen → sentral oppdatering uten ombygging.
- Admin laster opp ny kundelogg via «Kundelogg»-knappen (parser `kundelogg.html`,
  pakker ut gzip og rekomprimerer til `crm_kundelogg`).

**Atferd:**
- I appen (med konfig + økt): oppgaver og besøk leses fra / skrives til Supabase.
  Logging av dialog og avhuking av oppgaver lagres umiddelbart. De illustrative
  oppgavene slås av.
- Frittstående (uten konfig): illustrativ forhåndsvisning i minnet (som før).

**Til Bolt:** Pipeline-tabellen er klar, men UI for pipeline (og evt. flytting av
saker/utstillinger til egne tabeller) bygges videre der. RA-dimensjonen er
fortsatt region; navngitt RA krever en selger-kolonne i Kundedata.

## Deploy (oppdatert rekkefølge)
1. Kjør CRM-migrasjonene i Supabase (i rekkefølge):
   `20260607100000_add_slot_to_portal_html.sql`, `20260607120000_crm_persistence.sql`
   og `20260607130000_crm_state.sql`.
2. Last opp kundeloggen én gang via «Kundelogg»-knappen (admin).
3. `npm install && npm run build` (krever `VITE_SUPABASE_URL` og `VITE_SUPABASE_ANON_KEY`).
4. Publiser `dist/`.
