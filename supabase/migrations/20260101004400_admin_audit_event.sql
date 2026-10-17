-- Registra una acción del superadmin hecha desde TypeScript (p. ej. subir una imagen de plantilla). Solo escribe en admin_audit.
create or replace function ss_admin_audit_event(p jsonb) returns jsonb language plpgsql as $$
begin
  if coalesce(p->>'action', '') !~ '^[a-z_]{3,60}$' then perform ss_err('invalid_input'); end if;
  perform ss_audit(p->>'actor', p->>'action', coalesce(p->>'target_type', 'event'), p->>'target_id', coalesce(p->'payload', '{}'::jsonb));
  return jsonb_build_object('ok', true);
end $$;
