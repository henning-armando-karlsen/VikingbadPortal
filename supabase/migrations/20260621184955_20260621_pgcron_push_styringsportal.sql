-- # Planlegg push-til-styringsportal med pg_cron
--
-- 1. Aktiverer extensions
--    - pg_cron: jobbplanlegger for PostgreSQL
--    - pg_net: asynkron HTTP fra SQL
--
-- 2. Ny cron-jobb
--    - Navn: push-til-styringsportal
--    - Frekvens: hvert 10. minutt
--    - Kaller edge-funksjonen push-til-styringsportal via net.http_post
--    - Leser prosjekt-URL og publiserbar noekkel fra Vault
--    - Oppretter ikke jobben foer begge verdiene finnes i miljoet
--
-- 3. Idempotens: gammel jobb med samme navn avregistreres foerst

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Fjern gammel jobb hvis den finnes
DO $$
BEGIN
  PERFORM cron.unschedule('push-til-styringsportal');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Planlegg bare jobben i miljoer som har egne Vault-verdier.
-- Dette hindrer preview-grener i aa kalle produksjonsprosjektet.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
  ) AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'publishable_key'
  ) THEN
    PERFORM cron.schedule(
      'push-til-styringsportal',
      '*/10 * * * *',
      $job$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'project_url'
          LIMIT 1
        ) || '/functions/v1/push-til-styringsportal',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'publishable_key'
            LIMIT 1
          )
        )
      )
      $job$
    );
  ELSE
    RAISE NOTICE 'Skipping push-til-styringsportal: project_url or publishable_key is missing from Vault';
  END IF;
END
$migration$;
