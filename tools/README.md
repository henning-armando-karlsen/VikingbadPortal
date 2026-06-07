# Bygg integrert CRM på nytt

CRM-en (`public/crm.html`) bygges fra prototypen + kundeloggen ved å injisere
LZString, den komprimerte kundeloggen og hydreringsblokken (`hydration.js`).

Når du oppdaterer CRM-prototypen eller kundeloggen:
1. Legg nye kildefiler i `/mnt/user-data/uploads/` (eller juster stiene øverst i `build_crm.cjs`).
2. `node tools/build_crm.cjs`  → skriver ny `public/crm.html`.
3. `npm run build` og publiser `dist/`.

Hydreringen leser primært `localStorage['vbKundelogg']` (base64-LZString av
logg-hendelsene) hvis appen legger den der, ellers den innebygde `VB_LOG_B64`.
Datasettet leses fra `localStorage['vbDataset2']` (samme som analyseportalen).
