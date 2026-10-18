-- «Pausa de gracia»: el anfitrión aplaza unos segundos la adjudicación por tiempo (automática o relámpago) de la subasta en curso,
-- p. ej. porque a un jugador se le ha ido el móvil en pleno remate. Solo mueve `timer_reset_at` (la cuenta atrás se calcula como
-- max(última puja, apertura, timer_reset_at) + segundos): nunca toca saldos ni pujas y no adjudica nada.
-- Límites: 1..30 s por uso (10 por defecto) y 3 usos por subasta (`grace_uses`). Queda en el registro de eventos (`auction_grace`).
alter table auctions add column if not exists grace_uses integer not null default 0 check (grace_uses between 0 and 3);
alter table auctions add column if not exists grace_player_id uuid references players(id) on delete set null;
alter table auctions add column if not exists grace_until timestamptz;

create or replace function ss_auction_grace(p jsonb) returns jsonb language plpgsql as $$
declare g games; a auctions; v_secs int := coalesce((p->>'seconds')::int, 10); v_award int; v_due timestamptz; v_new timestamptz; v_player uuid;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if v_secs < 1 or v_secs > 30 then perform ss_err('invalid_input'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('auction_closed'); end if;
  v_award := case when a.wild_event = 'flash' then coalesce(a.auto_seconds_override, 8)
                  when a.wild_event is distinct from 'sealed' and g.auto_award_enabled then g.auto_award_seconds end;
  if v_award is null or a.current_bidder_id is null then perform ss_err('grace_not_applicable'); end if;
  if a.grace_uses >= 3 then perform ss_err('grace_limit'); end if;
  v_player := nullif(p->>'player_id', '')::uuid;
  if v_player is not null and not exists (select 1 from players where id = v_player and game_id = g.id) then perform ss_err('player_not_found'); end if;
  v_due := greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a.id and b.voided_at is null), a.opened_at), a.timer_reset_at)
           + make_interval(secs => v_award);
  -- Nuevo vencimiento = el más tardío entre «ahora» y el vencimiento actual, más los segundos de gracia.
  v_new := greatest(v_due, clock_timestamp()) + make_interval(secs => v_secs);
  update auctions set timer_reset_at = v_new - make_interval(secs => v_award), grace_uses = grace_uses + 1,
         grace_player_id = v_player, grace_until = v_new where id = a.id;
  perform ss_log(g.id, g.host_id, 'auction_grace', jsonb_build_object('auction_id', a.id, 'player_id', v_player, 'seconds', v_secs, 'uses', a.grace_uses + 1));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'seconds', v_secs, 'uses', a.grace_uses + 1);
end $$;

-- La instantánea añade `grace` ({uses, player_id, until}) a la subasta abierta tras usar la gracia (el anfitrión ve además el máximo).
alter function ss_get_state(jsonb) rename to ss_get_state_pre_grace;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; a auctions;
begin
  res := ss_get_state_pre_grace(p);
  if res->'auction' is null or jsonb_typeof(res->'auction') <> 'object' then return res; end if;
  select * into a from auctions where id = (res->'auction'->>'id')::uuid;
  if not found or a.status <> 'open' or a.grace_uses = 0 then return res; end if;
  return jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object(
    'grace', jsonb_build_object('uses', a.grace_uses, 'max', 3, 'player_id', a.grace_player_id, 'until', a.grace_until)));
end $$;
