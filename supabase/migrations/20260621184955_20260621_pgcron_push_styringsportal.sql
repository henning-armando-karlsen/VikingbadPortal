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
--    - Ingen Authorization-header trengs (verify_jwt = false)
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

-- Planlegg ny jobb hvert 10. minutt
SELECT cron.schedule(
  'push-til-styringsportal',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://cdzlfszlvwibhufsmzkj.supabase.co/functions/v1/push-til-styringsportal',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);
