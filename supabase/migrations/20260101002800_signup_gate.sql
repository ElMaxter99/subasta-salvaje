-- Puerta de alta: ¿se puede crear una cuenta nueva con este correo? (registro abierto o correo invitado).
-- Solo informa; el acceso real sigue decidiéndolo ss_host_access.
create or replace function ss_signup_allowed(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
  v_open boolean := coalesce((ss_settings_get('{}'::jsonb)->>'signups_open')::boolean, true);
begin
  return jsonb_build_object(
    'open', v_open,
    'allowed', v_open or (v_email is not null and exists (select 1 from host_invites where email = v_email)));
end $$;
