'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AuctionItem } from '@/lib/domain/types';
import { useToast } from '@/components/ui/toast';
import { uploadItemImage } from '@/lib/client/api';
import { EmojiInput } from '@/components/ui/emoji-input';
import { Card, Notice, Pill, Thumb, inputCls } from './bits';
import type { HostCtx } from './host-context';

const STATUS = { available: ['Disponible', 'teal'], in_auction: ['En subasta', 'gold'], sold: ['Vendido', 'violet'], lost: ['Sin pujas · perdido', 'rose'] } as const;

function ItemForm({ initial, submitLabel, busyKey, ctx, onSubmit, onCancel }: { initial?: AuctionItem; submitLabel: string; busyKey: string; ctx: HostCtx; onSubmit: (v: { name: string; description: string; emoji: string | null }) => Promise<boolean>; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const id = initial?.id ?? 'new';
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSubmit({ name: name.trim(), description: description.trim(), emoji: emoji.trim() || null });
        if (ok && !initial) {
          setName('');
          setDescription('');
          setEmoji('');
        }
      }}
    >
      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
        <div>
          <label htmlFor={`emoji-${id}`} className="text-sm font-semibold text-white/80">
            Emoji
          </label>
          <EmojiInput id={`emoji-${id}`} ariaLabel="Emoji" className={`${inputCls} text-center text-2xl`} value={emoji} onChange={setEmoji} />
        </div>
        <div>
          <label htmlFor={`iname-${id}`} className="text-sm font-semibold text-white/80">
            Nombre
          </label>
          <input id={`iname-${id}`} className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Nombre del elemento" />
        </div>
      </div>
      <div>
        <label htmlFor={`idesc-${id}`} className="text-sm font-semibold text-white/80">
          Descripción
        </label>
        <textarea id={`idesc-${id}`} className={`${inputCls} min-h-20`} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="Qué es y cómo se ve (se usa para generar la imagen)" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant={initial ? 'success' : 'primary'} size="md" disabled={!name.trim() || ctx.busy !== null} loading={ctx.busy === busyKey}>
          {!initial ? <Plus className="size-5" aria-hidden /> : null} {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // se reduce en el navegador antes de subirla
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function CatalogPanel({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run, exec, runtime, roomCode } = ctx;
  const toast = useToast();
  const items = [...snapshot.items].sort((a, b) => a.sort_order - b.sort_order);
  const finished = snapshot.game.status === 'finished';
  // Modo pegatinas: siempre se puede (ilustración local). Modo IA: sólo si hay proveedor configurado.
  const canGenerate = snapshot.game.image_mode === 'stickers' || runtime.aiConfigured;
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AuctionItem | null>(null);

  function move(item: AuctionItem, dir: -1 | 1) {
    // Intercambia con el vecino disponible más cercano en esa dirección.
    const idx = items.findIndex((i) => i.id === item.id);
    let j = idx + dir;
    while (j >= 0 && j < items.length && items[j]!.status !== 'available') j += dir;
    if (j < 0 || j >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    void run('item-move', { type: 'item.reorder', ordered_ids: ids });
  }

  const hasNeighbour = (item: AuctionItem, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === item.id);
    return items.some((o, k) => (dir < 0 ? k < idx : k > idx) && o.status === 'available');
  };

  return (
    <div className="space-y-4">
      {!canGenerate ? (
        <Notice tone="warn">Esta partida usa IA pero no hay proveedor configurado: la generación de imágenes de elementos está desactivada.</Notice>
      ) : null}

      <Notice tone="info">
        📷 Cada elemento puede tener su <b>foto</b> (la subes tú o la genera la IA). Cuando alguien gana el elemento, la IA <b>mezcla esa foto con la imagen de su casa</b>: si la foto es un conejo rosa con un lazo azul, ese conejo aparecerá en la casa. Sin foto, la IA usa solo el nombre y la descripción. (En modo pegatinas se añade el emoji.)
      </Notice>

      <ul className="space-y-3">
        {items.map((it) => {
          const [label, tone] = STATUS[it.status];
          const locked = it.status !== 'available';
          const generating = snapshot.jobs.some((j) => j.kind === 'item' && j.item_id === it.id && (j.status === 'queued' || j.status === 'running'));
          return (
            <li key={it.id} className="rounded-3xl border border-white/10 bg-night-800/80 p-4">
              <div className="flex items-start gap-3">
                {it.image_url ? <Thumb url={it.image_url} alt={it.name} className="size-16" /> : <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-night-950 text-4xl" aria-hidden>{it.emoji ?? '🎁'}</span>}
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">{it.name}</h3>
                  <p className="line-clamp-2 text-sm text-white/65">{it.description || 'Sin descripción'}</p>
                  <div className="mt-1">
                    <Pill tone={tone}>{label}</Pill>
                  </div>
                </div>
                {!locked && !finished ? (
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Subir ${it.name}`} disabled={busy !== null || !hasNeighbour(it, -1)} onClick={() => move(it, -1)}>
                      <ArrowUp className="size-5" aria-hidden />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Bajar ${it.name}`} disabled={busy !== null || !hasNeighbour(it, 1)} onClick={() => move(it, 1)}>
                      <ArrowDown className="size-5" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
              {!finished ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="md" variant="secondary" disabled={!canGenerate || generating || busy !== null} loading={busy === `genitem-${it.id}`} title={runtime.aiConfigured ? undefined : 'Requiere un proveedor de IA configurado'} onClick={() => run(`genitem-${it.id}`, { type: 'image.request_item', item_id: it.id }, 'Imagen del elemento solicitada')}>
                    <Sparkles className="size-4" aria-hidden /> {generating ? 'Generando…' : 'Generar imagen'}
                  </Button>
                  <input
                    id={`item-photo-${it.id}`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (!PHOTO_TYPES.includes(file.type)) return toast.error('Formato no válido. Usa PNG, JPEG o WebP.');
                      if (file.size > MAX_PHOTO_BYTES) return toast.error('La imagen supera los 25 MB.');
                      void exec(`upitem-${it.id}`, () => uploadItemImage(roomCode, it.id, file), `Foto de «${it.name}» guardada`);
                    }}
                  />
                  <Button size="md" variant="secondary" disabled={busy !== null} loading={busy === `upitem-${it.id}`} onClick={() => document.getElementById(`item-photo-${it.id}`)?.click()} aria-label={`Subir foto de ${it.name}`}>
                    <Upload className="size-4" aria-hidden /> {it.image_url ? 'Cambiar foto' : 'Subir foto'}
                  </Button>
                  {it.image_url ? (
                    <Button size="md" variant="ghost" disabled={busy !== null} loading={busy === `clearitem-${it.id}`} onClick={() => run(`clearitem-${it.id}`, { type: 'item.clear_image', item_id: it.id }, 'Foto quitada')} aria-label={`Quitar foto de ${it.name}`}>
                      <ImageOff className="size-4" aria-hidden /> Quitar foto
                    </Button>
                  ) : null}
                  {!locked ? (
                    <>
                      <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => setEditing(editing === it.id ? null : it.id)}>
                        <Pencil className="size-4" aria-hidden /> Editar
                      </Button>
                      <Button size="md" variant="ghost" className="text-rose" disabled={busy !== null} onClick={() => setRemoving(it)}>
                        <Trash2 className="size-4" aria-hidden /> Eliminar
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {editing === it.id ? (
                <div className="mt-3 rounded-2xl bg-night-900 p-3">
                  <ItemForm
                    ctx={ctx}
                    initial={it}
                    submitLabel="Guardar cambios"
                    busyKey={`item-edit-${it.id}`}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (v) => {
                      const ok = !!(await run(`item-edit-${it.id}`, { type: 'item.update', item_id: it.id, ...v }, 'Elemento actualizado'));
                      if (ok) setEditing(null);
                      return ok;
                    }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!finished ? (
        <Card title="Añadir elemento" icon={<Plus className="size-5 text-gold" aria-hidden />}>
          <ItemForm ctx={ctx} submitLabel="Añadir al catálogo" busyKey="item-add" onSubmit={async (v) => !!(await run('item-add', { type: 'item.add', ...v }, 'Elemento añadido'))} />
        </Card>
      ) : null}

      <ConfirmDialog
        open={!!removing}
        title="Eliminar elemento"
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={busy === 'item-remove'}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await run('item-remove', { type: 'item.remove', item_id: removing.id }, 'Elemento eliminado');
          setRemoving(null);
        }}
      >
        <p>
          Se eliminará <b>{removing?.name}</b> del catálogo.
        </p>
      </ConfirmDialog>
    </div>
  );
}
