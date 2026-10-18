-- Permisos de «ceder la puja». Solo Supabase.
revoke all on table auction_yields from anon, authenticated;
alter table auction_yields enable row level security;
create policy deny_all_auction_yields on auction_yields for all to anon, authenticated using (false) with check (false);
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
