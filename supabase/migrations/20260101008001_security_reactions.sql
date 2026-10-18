-- Permisos de las reacciones. Solo Supabase.
revoke all on table game_reactions from anon, authenticated;
alter table game_reactions enable row level security;
create policy deny_all_game_reactions on game_reactions for all to anon, authenticated using (false) with check (false);
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
