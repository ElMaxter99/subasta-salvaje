'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Images, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { uploadInitialImage } from '@/lib/client/api';
import { INITIAL_CATALOG } from '@/lib/domain/initial-catalog';
import { Card } from './bits';
import type { HostCtx } from './host-context';

const MAX_BYTES = 7 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Imagen de partida común para TODOS los jugadores: subir una propia o elegir de la galería incluida (sin IA). */
export function InitialImageCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, busy, run, exec, snapshot } = ctx;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedCatalog, setPickedCatalog] = useState<string | null>(null);
  const n = snapshot.players.length;
  const theme = snapshot.game.theme;

  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error('Formato no válido. Usa PNG, JPEG o WebP.');
    if (file.size > MAX_BYTES) return toast.error('La imagen supera los 7 MB.');
    setPickedFile(file);
  }

  const catalog = [...INITIAL_CATALOG].sort((a, b) => Number(b.id === theme) - Number(a.id === theme));
  const label = pickedFile ? `la imagen «${pickedFile.name}»` : `«${INITIAL_CATALOG.find((e) => e.id === pickedCatalog)?.label ?? ''}»`;

  return (
    <Card title="Imagen de partida para todos" icon={<Images className="size-5 text-gold" aria-hidden />}>
      <p className="mb-3 text-sm text-white/70">
        Pon la misma casa inicial a todos los jugadores de una vez, sin gastar IA: sube tu imagen o elige una de la galería. Podrás cambiarla después para jugadores concretos.
      </p>
      <input ref={fileRef} id="initial-all-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
      <Button size="lg" variant="primary" className="w-full" disabled={busy !== null || n === 0} loading={busy === 'initial-all-upload'} onClick={() => fileRef.current?.click()}>
        <Upload className="size-5" aria-hidden /> Subir una imagen para todos
      </Button>

      <h3 className="mt-4 mb-2 flex items-center gap-2 text-sm font-bold text-white/80">
        <ImagePlus className="size-4" aria-hidden /> Galería de imágenes de partida
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {catalog.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={busy !== null || n === 0}
              onClick={() => {
                setPickedFile(null);
                setPickedCatalog(e.id);
              }}
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
      <p className="mt-2 text-xs text-white/50">Son ilustraciones incluidas en la app (no generadas por IA). Con IA real activa, para editarlas con OpenAI sube una imagen PNG/JPG; las de la galería sirven para el proveedor de muestra.</p>

      <ConfirmDialog
        open={pickedFile !== null || pickedCatalog !== null}
        title="¿Usar esta imagen para todos?"
        confirmLabel="Sí, aplicar a todos"
        loading={busy === 'initial-all-upload' || busy === 'initial-all-catalog'}
        onCancel={() => {
          setPickedFile(null);
          setPickedCatalog(null);
        }}
        onConfirm={async () => {
          if (pickedFile) await exec('initial-all-upload', () => uploadInitialImage(roomCode, 'all', pickedFile), 'Imagen de partida aplicada a todos');
          else if (pickedCatalog) await run('initial-all-catalog', { type: 'image.set_initial_all', catalog_id: pickedCatalog }, 'Imagen de partida aplicada a todos');
          setPickedFile(null);
          setPickedCatalog(null);
        }}
      >
        <p>
          Se usará {label} como imagen inicial de los <b>{n} jugadores</b>. Las imágenes que ya tuvieran se conservan en el historial.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
