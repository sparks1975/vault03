CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent (re)schedule of the nightly 130point refresh.
DO $$
DECLARE jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'refresh-130point-nightly';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
  PERFORM cron.schedule(
    'refresh-130point-nightly',
    '0 3 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://project--06175a94-f581-45db-a1b7-1b13e4a953d7.lovable.app/api/public/hooks/refresh-130point',
      headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_6x7qxG3SC1qQ_HMV23F1DQ_5qmhnLSq"}'::jsonb,
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;