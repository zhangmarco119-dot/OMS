-- Enable the asynchronous HTTP transport used by environment-specific
-- DingTalk attendance cron jobs. Cron schedules and secrets are configured
-- outside migrations so development and production never share endpoints or
-- credentials.
create extension if not exists pg_net with schema extensions;
