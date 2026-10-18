-- Reacciones desde el móvil a la TV: emojis de una lista cerrada que flotan por la pantalla durante la partida activa.
-- Límites en SQL: 1 reacción cada 1,5 s por jugador y 50 por minuto por partida; solo se conservan las últimas 50 reacciones.
create table game_reactions (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index game_reactions_game_idx on game_reactions (game_id, id desc);

-- Enviar una reacción (identidad por token de jugador, como la puja del móvil).
create or replace function ss_send_reaction(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; v_emoji text := p->>'emoji'; v_id bigint;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if v_emoji is null or v_emoji not in ('👏','😱','😂','🔥','😭','🤑','🎉','🤯') then perform ss_err('invalid_input'); end if;
  if exists (select 1 from game_reactions where game_id = g.id and player_id = pl.id and created_at > clock_timestamp() - interval '1500 milliseconds') then
    perform ss_err('reaction_too_fast');
  end if;
  if (select count(*) from game_reactions where game_id = g.id and created_at > clock_timestamp() - interval '1 minute') >= 50 then
    perform ss_err('reactions_busy');
  end if;
  insert into game_reactions (game_id, player_id, emoji) values (g.id, pl.id, v_emoji) returning id into v_id;
  -- Limpieza: solo las últimas 50 de la partida.
  delete from game_reactions where game_id = g.id and id <= coalesce((select id from game_reactions where game_id = g.id order by id desc offset 50 limit 1), 0);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- La instantánea añade `reactions`: las de los últimos 10 s (la TV anima solo las nuevas que ve en directo).
alter function ss_get_state(jsonb) rename to ss_get_state_pre_reactions;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; v_game uuid;
begin
  res := ss_get_state_pre_reactions(p);
  v_game := (res->'game'->>'id')::uuid;
  res := res || jsonb_build_object('reactions', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'player_id', r.player_id, 'emoji', r.emoji, 'at', r.created_at) order by r.id)
    from game_reactions r where r.game_id = v_game and r.created_at > clock_timestamp() - interval '10 seconds'), '[]'::jsonb));
  return res;
end $$;
