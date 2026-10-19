'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Images, Library, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { uploadInitialImage } from '@/lib/client/api';
import { applyLibraryImageRequest, type LibraryPickImage } from '@/lib/client/library-pick-api';
import { INITIAL_CATALOG } from '@/lib/domain/initial-catalog';
import { Card } from './bits';
import { HostLibraryPicker } from './library-image-picker';
import type { HostCtx } from './host-context';

const MAX_BYTES = 25 * 1024 * 1024; // el original puede ser grande: se reduce en el navegador antes de subirlo
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Pending = { kind: 'file'; file: File } | { kind: 'catalog'; id: string } | { kind: 'library'; image: LibraryPickImage } | { kind: 'generate' } | null;

/**
 * Imagen de partida común: subir una propia, elegir de la galería o GENERARLA (IA o pegatinas según el modo),
 * para los jugadores ACTUALES, los NUEVOS (los que se unan después desde el móvil o se añadan en el panel), o ambos.
 */
export function InitialImageCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, busy, run, exec, snapshot, runtime } = ctx;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [picking, setPicking] = useState(false);
  const [forCurrent, setForCurrent] = useState(true);
  const [forNew, setForNew] = useState(true);
  const n = snapshot.players.length;
  const theme = snapshot.game.theme;
  const aiMode = snapshot.game.image_mode === 'ai';
  const newKind = snapshot.game.new_player_image_kind ?? null;
  const baseJob = snapshot.jobs.find((j) => j.kind === 'base' && (j.status === 'queued' || j.status === 'running' || j.status === 'failed'));
  const canGenerate = !aiMode || runtime.aiConfigured;
  const scopeOk = forCurrent || forNew;
  const disabled = busy !== null || !scopeOk;

  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error('Formato no válido. Usa PNG, JPEG o WebP.');
    if (file.size > MAX_BYTES) return toast.error('La imagen supera los 25 MB.');
    setPending({ kind: 'file', file });
  }

  const catalog = [...INITIAL_CATALOG].sort((a, b) => Number(b.id === theme) - Number(a.id === theme));
  const what =
    pending?.kind === 'file'
      ? `la imagen «${pending.file.name}»`
      : pending?.kind === 'catalog'
        ? `«${INITIAL_CATALOG.find((e) => e.id === pending.id)?.label ?? ''}»`
        : pending?.kind === 'library'
          ? `la foto «${pending.image.title || 'de la biblioteca'}» de la biblioteca (no es IA)`
        : aiMode
          ? 'UNA imagen generada con IA, la misma para todos'
          : 'UNA ilustración base generada (pegatinas), la misma para todos';
  const who = forCurrent && forNew ? `los ${n} jugadores actuales y los que se unan después` : forCurrent ? `los ${n} jugadores actuales` : 'los jugadores que se unan después';

  async function apply() {
    const scope = { current: forCurrent, new: forNew };
    if (pending?.kind === 'file') await exec('initial-all-upload', () => uploadInitialImage(roomCode, 'all', pending.file, scope), 'Imagen de partida aplicada');
    else if (pending?.kind === 'catalog') await run('initial-all-catalog', { type: 'image.set_initial_all', catalog_id: pending.id, scope_current: scope.current, scope_new: scope.new }, 'Imagen de partida aplicada');
    else if (pending?.kind === 'library') await exec('initial-all-library', () => applyLibraryImageRequest(roomCode, { target: 'initial', image_id: pending.image.id, scope_current: scope.current, scope_new: scope.new }), 'Imagen de partida aplicada');
    else if (pending?.kind === 'generate') await run('initial-all-generate', { type: 'image.generate_initial_all', scope_current: scope.current, scope_new: scope.new }, 'Generando la imagen base compartida…');
    setPending(null);
  }

  return (
    <Card title="Imagen de partida para todos" icon={<Images className="size-5 text-gold" aria-hidden />}>
      <p className="mb-3 text-sm text-white/70">
        Pon la misma imagen inicial a todos de una vez (subiendo una foto, de la galería o generándola) y decide a quién se aplica. Después podrás cambiarla para jugadores concretos.
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

      {baseJob ? (
        <p role="status" className={`mb-3 rounded-2xl px-3 py-2 text-sm font-semibold ${baseJob.status === 'failed' ? 'bg-rose/20 text-rose' : 'bg-violet/20 text-violet-soft'}`} data-testid="base-job-status">
          {baseJob.status === 'failed'
            ? `La imagen base no se pudo generar: ${baseJob.error_message ?? 'error desconocido'}. Reintenta desde la pestaña Imágenes o elige otra opción.`
            : 'Generando la imagen base compartida… Cuando termine, todos los jugadores tendrán exactamente la misma.'}
        </p>
      ) : null}

      {newKind ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-teal/15 px-3 py-2 text-sm">
          <span>
            Los jugadores nuevos recibirán: <b>{newKind === 'generate' ? (aiMode ? 'la imagen base generada con IA (la misma para todos)' : 'la escena base generada (la misma para todos)') : 'la imagen que elegiste'}</b>.
          </span>
          <Button size="sm" variant="ghost" disabled={busy !== null} loading={busy === 'clear-new'} onClick={() => run('clear-new', { type: 'image.clear_new_player_image' }, 'Los jugadores nuevos ya no recibirán imagen por defecto')} aria-label="Quitar la imagen por defecto de los jugadores nuevos">
            <X className="size-4" aria-hidden /> Quitar
          </Button>
        </div>
      ) : null}

      <input ref={fileRef} id="initial-all-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Imagen inicial común" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="lg" variant="secondary" disabled={disabled} loading={busy === 'initial-all-library'} onClick={() => setPicking(true)} data-testid="initial-from-library" className="sm:col-span-2">
          <Library className="size-5" aria-hidden /> Elegir de la biblioteca (foto de inicio de partida)
        </Button>
        <Button size="lg" variant="primary" disabled={disabled} loading={busy === 'initial-all-upload'} onClick={() => fileRef.current?.click()}>
          <Upload className="size-5" aria-hidden /> Subir una foto para todos
        </Button>
        <Button size="lg" variant="secondary" disabled={disabled || !canGenerate} loading={busy === 'initial-all-generate'} onClick={() => setPending({ kind: 'generate' })}>
          <Sparkles className="size-5" aria-hidden /> {aiMode ? 'Generar con IA una imagen base para todos' : 'Generar una escena base para todos'}
        </Button>
      </div>
      {!canGenerate ? <p className="mt-2 text-xs text-white/55">La IA no está configurada en este despliegue: elige otra opción o cambia al modo pegatinas en Ajustes.</p> : null}
      {aiMode && canGenerate ? <p className="mt-2 text-xs text-white/55">Se genera UNA sola imagen para toda la partida (cuenta como una sola generación) y se asigna a todos, incluso a quien se una mientras se genera.</p> : null}

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

      <HostLibraryPicker open={picking} role="start" title="Elegir la imagen inicial de la biblioteca" onClose={() => setPicking(false)} onPick={(image) => { setPicking(false); setPending({ kind: 'library', image }); }} />

      <ConfirmDialog
        open={pending !== null}
        title="¿Aplicar esta imagen de partida?"
        confirmLabel="Sí, aplicar"
        loading={busy === 'initial-all-upload' || busy === 'initial-all-catalog' || busy === 'initial-all-generate' || busy === 'initial-all-library'}
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
