'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlayerScreen } from './player-screen';
import { Picker } from './picker';
import { Logo } from '@/components/ui/logo';
import { DemoBanner } from '@/components/ui/status';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { ApiError, fetchMe, leaveGameRequest } from '@/lib/client/api';
import { GameGone } from '@/components/ui/game-gone';
import { useLiveGame } from '@/lib/client/use-live-game';
import type { PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';

export function PlayView(props: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo; initialPlayerId: string | null }) {
  return (
    <ToastProvider>
      <PlayInner {...props} />
    </ToastProvider>
  );
}

function PlayInner({ roomCode, initial, runtime, initialPlayerId }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo; initialPlayerId: string | null }) {
  const toast = useToast();
  const { snapshot, connection, apply, refresh, gone } = useLiveGame({ roomCode, initial, runtime, view: 'public' });
  const [playerId, setPlayerId] = useState<string | null>(initialPlayerId);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const dropPlayer = useCallback(
    (message: string) => {
      setPlayerId(null);
      setNotice(message);
      void refresh();
    },
    [refresh],
  );

  // Si el anfitrión libera al jugador, la identidad de este móvil deja de valer.
  useEffect(() => {
    if (!playerId) return;
    const id = setInterval(() => {
      fetchMe(roomCode)
        .then((p) => {
          if (p !== playerId) dropPlayer('El anfitrión te ha liberado o tu sesión ha caducado. Elige jugador de nuevo.');
        })
        .catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [playerId, roomCode, dropPlayer]);

  const me = playerId ? snapshot.players.find((p) => p.id === playerId) : undefined;

  async function leave() {
    setLeaving(true);
    try {
      await leaveGameRequest(roomCode);
      setPlayerId(null);
      setNotice(null);
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo salir. Inténtalo de nuevo.');
    } finally {
      setLeaving(false);
    }
  }

  if (gone) return <GameGone roomCode={roomCode} />;
  if (playerId && me) {
    return (
      <>
        <DemoBanner runtime={runtime} />
        <PlayerScreen
          roomCode={roomCode}
          snapshot={snapshot}
          me={me}
          connection={connection}
          runtime={runtime}
          onSnapshot={apply}
          onLeave={leave}
          onNotPlayer={() => dropPlayer('Tu móvil ya no está identificado en esta partida. Vuelve a elegir jugador.')}
          leaving={leaving}
        />
      </>
    );
  }

  return (
    <>
      <DemoBanner runtime={runtime} />
      <div className="mx-auto min-h-dvh w-full max-w-md space-y-5 px-4 pb-10 pt-5">
        <header className="space-y-1">
          <Logo className="!text-base" />
          <h1 className="font-display text-2xl leading-tight">{snapshot.game.name}</h1>
          <p className="text-sm font-semibold text-white/70">
            Sala <span className="rounded-lg bg-night-700 px-2 py-0.5 font-mono tracking-widest text-gold">{snapshot.game.room_code}</span>
          </p>
        </header>
        <Picker
          roomCode={roomCode}
          snapshot={snapshot}
          notice={notice}
          onJoined={(id, s) => {
            apply(s);
            setNotice(null);
            setPlayerId(id);
          }}
          onStale={() => void refresh()}
        />
      </div>
    </>
  );
}
