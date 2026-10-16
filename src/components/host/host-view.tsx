'use client';

import { useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { Gavel, History, ImageIcon, LayoutDashboard, Package, Settings, Users } from 'lucide-react';
import { ConnectionBadge, DemoBanner } from '@/components/ui/status';
import { ToastProvider } from '@/components/ui/toast';
import { Logo } from '@/components/ui/logo';
import { useLiveGame } from '@/lib/client/use-live-game';
import type { HostSnapshot, RuntimeInfo } from '@/lib/domain/types';
import { AuctionPanel } from './auction-panel';
import { Pill, STATUS_LABEL } from './bits';
import { CatalogPanel } from './catalog-panel';
import { useHostRunner, type HostCtx } from './host-context';
import { JobsPanel, useAutoKick } from './jobs-panel';
import { OverviewPanel } from './overview-panel';
import { PlayersPanel } from './players-panel';
import { SettingsPanel } from './settings-panel';
import { TvLinks } from './tv-links';

type SectionId = 'resumen' | 'subasta' | 'jugadores' | 'catalogo' | 'imagenes' | 'ajustes';
const SECTIONS: { id: SectionId; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: 'resumen', label: 'Resumen', Icon: LayoutDashboard },
  { id: 'subasta', label: 'Subasta', Icon: Gavel },
  { id: 'jugadores', label: 'Jugadores', Icon: Users },
  { id: 'catalogo', label: 'Catálogo', Icon: Package },
  { id: 'imagenes', label: 'Imágenes', Icon: ImageIcon },
  { id: 'ajustes', label: 'Ajustes', Icon: Settings },
];

interface Props {
  roomCode: string;
  initial: HostSnapshot;
  runtime: RuntimeInfo;
  identity: { email: string | null; demo: boolean };
}

export function HostView(props: Props) {
  return (
    <ToastProvider>
      <HostInner {...props} />
    </ToastProvider>
  );
}

function HostInner({ roomCode, initial, runtime, identity }: Props) {
  const { snapshot, connection, apply, refresh } = useLiveGame<HostSnapshot>({ roomCode, initial, runtime, view: 'host' });
  const { busy, run, exec } = useHostRunner(roomCode, apply, refresh);
  const [section, setSection] = useState<SectionId>(initial.game.status === 'active' || initial.game.status === 'paused' ? 'subasta' : 'resumen');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ctx: HostCtx = { roomCode, snapshot, runtime, busy, run, exec };
  useAutoKick(ctx);
  const { game } = snapshot;

  function onKey(e: React.KeyboardEvent, i: number) {
    const horizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    if (!horizontal && !vertical && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = SECTIONS.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    const id = SECTIONS[next]!.id;
    setSection(id);
    tabRefs.current[id]?.focus();
  }

  const statusTone = game.status === 'active' ? 'teal' : game.status === 'paused' ? 'gold' : game.status === 'finished' ? 'rose' : 'violet';

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <DemoBanner runtime={runtime} />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="hidden md:block">
              <Logo className="!text-sm" />
            </div>
            <h1 className="truncate font-display text-lg leading-tight sm:text-2xl">{game.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-white/70">
              <span>
                Sala <b className="font-mono tracking-widest text-gold">{game.room_code}</b>
              </span>
              <Pill tone={statusTone}>{STATUS_LABEL[game.status]}</Pill>
              <ConnectionBadge state={connection} runtime={runtime} />
              {identity.email ? <span className="hidden text-xs text-white/50 lg:inline">{identity.email}</span> : null}
            </p>
          </div>
          <div className="hidden md:block">
            <TvLinks roomCode={roomCode} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pt-3 md:hidden">
        <TvLinks roomCode={roomCode} />
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 pt-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Secciones del panel" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-900/95 backdrop-blur md:sticky md:inset-x-auto md:bottom-auto md:top-28 md:h-fit md:self-start md:rounded-3xl md:border md:bg-night-800/80 md:p-2">
          <div role="tablist" aria-label="Secciones" aria-orientation="horizontal" className="grid grid-cols-6 md:grid-cols-1">
            {SECTIONS.map(({ id, label, Icon }, i) => {
              const on = section === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="panel-main"
                  tabIndex={on ? 0 : -1}
                  onKeyDown={(e) => onKey(e, i)}
                  onClick={() => setSection(id)}
                  className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-bold transition md:min-h-12 md:flex-row md:justify-start md:gap-3 md:rounded-2xl md:px-4 md:text-base ${on ? 'text-gold md:bg-gold md:text-night-950' : 'text-white/70 hover:text-white md:hover:bg-white/10'}`}
                >
                  <Icon className="size-6 md:size-5" aria-hidden />
                  {label}
                </button>
              );
            })}
            <Link href={`/game/${roomCode}/history`} className="hidden min-h-12 items-center gap-3 rounded-2xl px-4 font-bold text-white/70 hover:bg-white/10 hover:text-white md:flex">
              <History className="size-5" aria-hidden /> Historial
            </Link>
          </div>
        </nav>

        <main id="panel-main" role="tabpanel" aria-labelledby={`tab-${section}`} tabIndex={-1} className="min-w-0 pb-4">
          {section === 'resumen' ? <OverviewPanel ctx={ctx} goTo={setSection} /> : null}
          {section === 'subasta' ? <AuctionPanel ctx={ctx} /> : null}
          {section === 'jugadores' ? <PlayersPanel ctx={ctx} /> : null}
          {section === 'catalogo' ? <CatalogPanel ctx={ctx} /> : null}
          {section === 'imagenes' ? <JobsPanel ctx={ctx} refresh={refresh} /> : null}
          {section === 'ajustes' ? <SettingsPanel ctx={ctx} /> : null}
        </main>
      </div>
    </div>
  );
}
