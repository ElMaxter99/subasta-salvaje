'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Images, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { uploadInitialImage } from '@/lib/client/api';
import { INITIAL_CATALOG } from '@/lib/domain/initial-catalog';
import { Card } from './bits';
import type { HostCtx } from './host-context';

const MAX_BYTES = 7 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Pending = { kind: 'file'; file: File } | { kind: 'catalog'; id: string } | { kind: 'generate' } | null;

/**
 * Imagen de partida común: subir una propia, elegir de la galería o GENERARLA (IA o pegatinas según el modo),
 * para los jugadores ACTUALES, los NUEVOS (los que se unan después desde el móvil o se añadan en el panel), o ambos.
 */
export function InitialImageCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, busy, run, exec, snapshot, runtime } = ctx;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [forCurrent, setForCurrent] = useState(true);
  const [forNew, setForNew] = useState(true);
  const n = snapshot.players.length;
  const theme = snapshot.game.theme;
  const aiMode = snapshot.game.image_mode === 'ai';
  const newKind = snapshot.game.new_player_image_kind ?? null;
  const canGenerate = !aiMode || runtime.aiConfigured;
  const scopeOk = forCurrent || forNew;
  const disabled = busy !== null || !scopeOk;

  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error('Formato no válido. Usa PNG, JPEG o WebP.');
    if (file.size > MAX_BYTES) return toast.error('La imagen supera los 7 MB.');
    setPending({ kind: 'file', file });
  }

  const catalog = [...INITIAL_CATALOG].sort((a, b) => Number(b.id === theme) - Number(a.id === theme));
  const what =
    pending?.kind === 'file'
      ? `la imagen «${pending.file.name}»`
      : pending?.kind === 'catalog'
        ? `«${INITIAL_CATALOG.find((e) => e.id === pending.id)?.label ?? ''}»`
        : aiMode
          ? 'una imagen generada con IA para cada jugador'
          : 'una escena vacía generada (pegatinas) para cada jugador';
  const who = forCurrent && forNew ? `los ${n} jugadores actuales y los que se unan después` : forCurrent ? `los ${n} jugadores actuales` : 'los jugadores que se unan después';

  async function apply() {
    const scope = { current: forCurrent, new: forNew };
    if (pending?.kind === 'file') await exec('initial-all-upload', () => uploadInitialImage(roomCode, 'all', pending.file, scope), 'Imagen de partida aplicada');
    else if (pending?.kind === 'catalog') await run('initial-all-catalog', { type: 'image.set_initial_all', catalog_id: pending.id, scope_current: scope.current, scope_new: scope.new }, 'Imagen de partida aplicada');
    else if (pending?.kind === 'generate') await run('initial-all-generate', { type: 'image.generate_initial_all', scope_current: scope.current, scope_new: scope.new }, 'Generación de imágenes iniciales solicitada');
    setPending(null);
  }

  return (
    <Card title="Imagen de partida para todos" icon={<Images className="size-5 text-gold" aria-hidden />}>
      <p className="mb-3 text-sm text-white/70">
        Pon la misma casa inicial a todos de una vez (subiendo una foto, de la galería o generándola) y decide a quién se aplica. Después podrás cambiarla para jugadores concretos.
      </p>

      <fieldset className="mb-3 rounded-2xl border border-white/10 bg-night-900 p-3">
        <legend className="px-1 text-sm font-bold text-white/80">¿A quién se aplica?</legend>
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" className="size-5 accent-[#fbbf24]" checked={forCurrent} onChange={(e) => setForCurrent(e.target.checked)} />
          Jugadores actuales ({n})
        </label>
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" className="size-5 accent-[#fbbf24]" checked={forNew} onChange={(e) => setForNew(e.target.checked)} />
          Jugadores nuevos (los que se unan después desde el móvil o añadas en el panel)
        </label>
        {!scopeOk ? <p className="text-sm text-rose">Marca al menos una opción.</p> : null}
      </fieldset>

      {newKind ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-teal/15 px-3 py-2 text-sm">
          <span>
            Los jugadores nuevos recibirán: <b>{newKind === 'generate' ? (aiMode ? 'una imagen generada con IA' : 'una escena generada (pegatinas)') : 'la imagen que elegiste'}</b>.
          </span>
          <Button size="sm" variant="ghost" disabled={busy !== null} loading={busy === 'clear-new'} onClick={() => run('clear-new', { type: 'image.clear_new_player_image' }, 'Los jugadores nuevos ya no recibirán imagen por defecto')} aria-label="Quitar la imagen por defecto de los jugadores nuevos">
            <X className="size-4" aria-hidden /> Quitar
          </Button>
        </div>
      ) : null}

      <input ref={fileRef} id="initial-all-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="lg" variant="primary" disabled={disabled} loading={busy === 'initial-all-upload'} onClick={() => fileRef.current?.click()}>
          <Upload className="size-5" aria-hidden /> Subir una foto para todos
        </Button>
        <Button size="lg" variant="secondary" disabled={disabled || !canGenerate} loading={busy === 'initial-all-generate'} onClick={() => setPending({ kind: 'generate' })}>
          <Sparkles className="size-5" aria-hidden /> {aiMode ? 'Generar con IA para todos' : 'Generar escena para todos'}
        </Button>
      </div>
      {!canGenerate ? <p className="mt-2 text-xs text-white/55">La IA no está configurada en este despliegue: elige otra opción o cambia al modo pegatinas en Ajustes.</p> : null}
      {aiMode && canGenerate ? <p className="mt-2 text-xs text-white/55">Cada imagen generada cuenta para el límite de generaciones de IA de la partida.</p> : null}

      <h3 className="mt-4 mb-2 flex items-center gap-2 text-sm font-bold text-white/80">
        <ImagePlus className="size-4" aria-hidden /> Galería de imágenes de partida
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {catalog.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPending({ kind: 'catalog', id: e.id })}
              className="group w-full overflow-hidden rounded-2xl border border-white/10 bg-night-900 text-left transition hover:border-gold focus-visible:border-gold disabled:opacity-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/catalog/initial/${e.id}`} alt="" className="aspect-[3/2] w-full object-cover" />
              <span className="block px-2 py-1.5 text-sm font-bold">
                {e.emoji} {e.label}
                {e.id === theme ? <span className="ml-1 text-xs text-gold">· de tu temática</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/50">Las de la galería son ilustraciones incluidas en la app (no generadas por IA). Con IA real, para editarlas sube una imagen PNG/JPG.</p>

      <ConfirmDialog
        open={pending !== null}
        title="¿Aplicar esta imagen de partida?"
        confirmLabel="Sí, aplicar"
        loading={busy === 'initial-all-upload' || busy === 'initial-all-catalog' || busy === 'initial-all-generate'}
        onCancel={() => setPending(null)}
        onConfirm={apply}
      >
        <p>
          Se usará {what} para {who}. Las imágenes que ya tuvieran se conservan en el historial.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
