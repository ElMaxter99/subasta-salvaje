-- Permisos tras eventos sorpresa, galería y deshacer adjudicación. Sólo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
revoke all on table gallery_votes from anon, authenticated;
alter table gallery_votes enable row level security;
create policy deny_all_gallery_votes on gallery_votes for all to anon, authenticated using (false) with check (false);
