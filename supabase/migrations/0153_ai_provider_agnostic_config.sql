-- Make the AI provider configuration provider-agnostic. The administrator
-- supplies an OpenAI-compatible base URL, an API key, and a model. The model
-- list is discovered from the configured provider's /models endpoint.

drop function if exists public.admin_get_ai_provider_config();
drop function if exists public.admin_save_ai_provider_config(text, text, text, boolean);
drop function if exists public.service_get_ai_provider_config();
drop function if exists private.ai_provider_model_allowed(text, text);

alter table private.ai_provider_config drop column if exists provider;
alter table private.ai_provider_config alter column base_url set default 'https://api.deepseek.com';
alter table private.ai_provider_config alter column base_url set not null;
update private.ai_provider_config set base_url = 'https://api.deepseek.com' where base_url is null;

create or replace function public.admin_get_ai_provider_config()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_config private.ai_provider_config%rowtype;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  select * into v_config from private.ai_provider_config where singleton;
  return jsonb_build_object(
    'base_url', v_config.base_url,
    'model', v_config.model,
    'api_key_configured', v_config.api_key is not null,
    'api_key_last4', case when v_config.api_key is null then null else right(v_config.api_key, 4) end,
    'configured_at', v_config.configured_at
  );
end;
$$;

create or replace function public.admin_save_ai_provider_config(
  p_base_url text,
  p_model text,
  p_api_key text default null,
  p_clear_api_key boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_new_key text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;

  if p_base_url is null
    or p_base_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^?#]*)?/?$' then
    raise exception 'invalid AI provider base URL' using errcode = '22023';
  end if;
  if nullif(btrim(p_model), '') is null then
    raise exception 'invalid AI model' using errcode = '22023';
  end if;

  if p_clear_api_key then
    v_new_key := null;
  elsif p_api_key is not null and nullif(btrim(p_api_key), '') is not null then
    v_new_key := btrim(p_api_key);
    if char_length(v_new_key) not between 12 and 300
      or v_new_key !~ '^[A-Za-z0-9._-]+$' then
      raise exception 'API key format is invalid' using errcode = '22023';
    end if;
  else
    select api_key into v_new_key from private.ai_provider_config where singleton;
  end if;

  update private.ai_provider_config
  set base_url = btrim(p_base_url),
      model = btrim(p_model),
      api_key = v_new_key,
      configured_by = auth.uid(),
      configured_at = now(),
      updated_at = now()
  where singleton;

  return public.admin_get_ai_provider_config();
end;
$$;

create or replace function public.service_get_ai_provider_config()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_config private.ai_provider_config%rowtype;
begin
  select * into v_config from private.ai_provider_config where singleton;
  return jsonb_build_object(
    'base_url', v_config.base_url,
    'api_key', v_config.api_key,
    'model', v_config.model
  );
end;
$$;

revoke all on function public.admin_get_ai_provider_config(),
  public.admin_save_ai_provider_config(text, text, text, boolean),
  public.service_get_ai_provider_config()
from public, anon, authenticated;

grant execute on function public.admin_get_ai_provider_config(),
  public.admin_save_ai_provider_config(text, text, text, boolean)
to authenticated;

grant execute on function public.service_get_ai_provider_config()
to service_role;
