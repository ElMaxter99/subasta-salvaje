'use client';

import { useState } from 'react';
import { Lock, LockOpen, Smartphone, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, Notice, Pill } from './bits';
import type { HostCtx } from './host-context';

const POLICY_TEXT = { open: 'Entrada abierta', slots: 'Solo mis jugadores', closed: 'Entrada cerrada' } as const;

/**
 * Tarjeta de un toque «¿Quién puja?» del Resumen (también con la partida en curso).
 * «Abrir para móviles» = modo móviles + entrada abierta en una sola acción atómica (`game.set_access`); debajo aparece el
 * código, el QR y el enlace (JoinCard). Volver a «Las pujas las registro yo» pide confirmación si hay móviles conectados.
 */
export function AccessCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { game, players } = snapshot;
  const [confirmHost, setConfirmHost] = useState(false);
  if (game.status === 'finished') return null;
  const mobile = game.play_mode === 'mobile';
  const connected = players.filter((p) => p.claimed).length;
  const started = game.status !== 'lobby';
  const unclaimed = players.length - connected;

  return (
    <Card
      title="¿Quién puja?"
      icon={<Smartphone className="size-5 text-gold" aria-hidden />}
      className="border-gold/40"
      action={<Pill tone={mobile ? 'teal' : 'neutral'}>{mobile ? 'Pujan desde el móvil' : 'Pujas las registro yo'}</Pill>}
    >
      <div data-testid="access-card" data-mode={game.play_mode} data-policy={game.join_policy}>
        {mobile ? (
          <>
            <p className="mb-3 text-sm text-white/75">
              Los jugadores se unen con el código o el QR y pujan ellos mismos. Tú sigues anunciando, cerrando y adjudicando, y puedes registrar pujas a mano. <b>{POLICY_TEXT[game.join_policy]}</b>
              {started ? ': con la partida en marcha solo pueden reclamar una casilla libre (los nombres nuevos solo entran en la sala de espera).' : '.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="lg" disabled={busy !== null} loading={busy === 'access-host'} onClick={() => (connected > 0 ? setConfirmHost(true) : void run('access-host', { type: 'game.set_access', play_mode: 'host' }, 'Ahora las pujas las registras tú'))}>
                <Mic className="size-5" aria-hidden /> Las pujas las registro yo
              </Button>
              {game.join_policy === 'closed' ? (
                <Button variant="primary" size="lg" disabled={busy !== null} loading={busy === 'access-open'} onClick={() => run('access-open', { type: 'game.set_access', join_policy: 'open' }, 'Entrada abierta')}>
                  <LockOpen className="size-5" aria-hidden /> Abrir la entrada
                </Button>
              ) : (
                <Button variant="secondary" size="lg" disabled={busy !== null} loading={busy === 'access-close'} onClick={() => run('access-close', { type: 'game.set_access', join_policy: 'closed' }, 'Entrada cerrada: los móviles conectados siguen jugando')}>
                  <Lock className="size-5" aria-hidden /> Cerrar la entrada
                </Button>
              )}
            </div>
            {started && game.auto_award_enabled && unclaimed > 0 ? (
              <div className="mt-3">
                <Notice tone="warn">
                  Ojo: con la adjudicación automática, en modo móviles los jugadores <b>sin móvil conectado</b> ({unclaimed}) no cuentan como posibles pujadores: si registras una puja a mano por voz, la subasta puede adjudicarse al instante.
                </Notice>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-white/75">Los jugadores pujan en voz alta y tú registras cada puja. Puedes abrir la sala a los móviles cuando quieras, también con la partida en marcha: la subasta abierta no se toca.</p>
            <Button variant="primary" size="xl" disabled={busy !== null} loading={busy === 'access-mobile'} data-testid="open-mobile" onClick={() => run('access-mobile', { type: 'game.set_access', play_mode: 'mobile', join_policy: 'open' }, 'Abierto para móviles: comparte el código o el QR')}>
              <Smartphone className="size-6" aria-hidden /> Abrir para móviles
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmHost}
        title="¿Volver a registrar tú las pujas?"
        confirmLabel="Sí, las registro yo"
        loading={busy === 'access-host'}
        onCancel={() => setConfirmHost(false)}
        onConfirm={async () => {
          const r = await run('access-host', { type: 'game.set_access', play_mode: 'host' }, 'Ahora las pujas las registras tú');
          if (r) setConfirmHost(false);
        }}
      >
        <p>
          Los {connected} {connected === 1 ? 'móvil conectado dejará' : 'móviles conectados dejarán'} de poder pujar y verán un aviso en su pantalla. Conservan su casilla y su saldo, y podrás volver a abrir los móviles cuando quieras.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
