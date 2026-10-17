'use client';

import { MAX_PLAYERS } from '@/lib/domain/limits';
import { providerLabel } from '@/lib/ai/labels';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Pencil, Plus, Rocket, X } from 'lucide-react';
import { Bubble, Mascot } from '@/components/mascot/mascot';
import type { MascotId } from '@/components/mascot/assets';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { createGameRequest, importPhotosRequest, saveTemplateRequest } from '@/lib/client/api';
import { CatalogEditor, validateCatalog } from './catalog-editor';
import { TemplateImport, type LoadedCatalog, type LoadedTemplate } from './template-import';
import { CUSTOM_THEME, formToTemplate } from '@/lib/domain/template';
import { ApiError, uploadItemImage } from '@/lib/client/api';
import { formatEuros, parseEurosToCents } from '@/lib/domain/money';
import { PLAYER_COLORS } from '@/lib/domain/schemas';
import { THEME_PRESETS, getThemePreset } from '@/lib/domain/themes';
import { Stepper, type StepInfo } from './new-game-stepper';

const CUSTOM = CUSTOM_THEME;
/** `2xl` (≥1536 px, p. ej. una TV a 1080p con zoom del navegador) agranda campos y botones para leer a distancia. */
const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:px-5 2xl:py-4 2xl:text-xl';
const label = 'mb-1 block text-sm font-bold 2xl:text-lg';
const card = 'space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-4 sm:p-6';

const STEPS: (StepInfo & { mascot: MascotId; say: string; title: string; hint: string })[] = [
  { id: 'modo', label: 'Quién puja', mascot: 'expr-feliz', say: '¡Empezamos!', title: '¿Quién va a pujar?', hint: 'Elige si pujáis en voz alta o cada jugador desde su móvil.' },
  { id: 'casas', label: 'Las casas', mascot: 'expr-sorprendido', say: '¡Magia!', title: '¿Cómo cambian las casas?', hint: 'Cada compra transforma la casa del jugador: con pegatinas gratis o con inteligencia artificial.' },
  { id: 'partida', label: 'Partida', mascot: 'expr-guino', say: 'Ponle nombre', title: 'Dale personalidad a la partida', hint: 'El nombre sale en la tele y la temática decide los elementos que se subastan.' },
  { id: 'reglas', label: 'Reglas', mascot: 'expr-pensativo', say: 'Ojo al dinero', title: 'Dinero y reglas', hint: 'Cuánto tiene cada jugador, la puja más baja posible y cómo se decide quién gana.' },
  { id: 'jugadores', label: 'Jugadores', mascot: 'expr-sorprendido', say: '¿Quién viene?', title: '¿Quién juega?', hint: 'Mínimo 2 para empezar. Podrás cambiarlos en la sala de espera.' },
  { id: 'resumen', label: 'Resumen', mascot: 'expr-celebrando', say: '¡Todo listo!', title: 'Revisa y crea la partida', hint: 'Pulsa «Editar» en cualquier bloque para cambiar algo.' },
];

const RANKING_LABEL = { none: 'Sin clasificación', balance: 'Gana quien conserve más dinero', items: 'Gana quien consiga más elementos', votes: 'Votación del público (la registras tú)' } as const;

function Choice({ checked, disabled, name, value, onChange, title, desc, tag }: { checked: boolean; disabled?: boolean; name: string; value: string; onChange: () => void; title: ReactNode; desc: ReactNode; tag?: string }) {
  return (
    <label className={`flex gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold/50 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-gold/60'} ${checked ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-900'}`}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 size-5 shrink-0 accent-[#fbbf24] 2xl:size-6" />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-lg font-bold 2xl:text-2xl">
          {title}
          {tag ? <span className="rounded-full bg-teal/20 px-2 py-0.5 text-xs font-bold text-teal">{tag}</span> : null}
        </span>
        <span className="block text-sm text-white/70 2xl:text-lg">{desc}</span>
      </span>
    </label>
  );
}

export function NewGameForm({ aiAvailable, aiProvider }: { aiAvailable: boolean; aiProvider: 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo' }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [name, setName] = useState('Noche de Subasta Salvaje');
  const [themeChoice, setThemeChoice] = useState('house');
  const [customTheme, setCustomTheme] = useState('');
  const [budget, setBudget] = useState('20');
  const [minBid, setMinBid] = useState('1');
  const [playMode, setPlayMode] = useState<'host' | 'mobile'>('host');
  const [imageMode, setImageMode] = useState<'stickers' | 'ai'>('stickers');
  const [ranking, setRanking] = useState<'none' | 'balance' | 'items' | 'votes'>('none');
  const [maxRounds, setMaxRounds] = useState('');
  const [integerBids, setIntegerBids] = useState(true);
  // Sin jugadores de partida: se pueden crear luego en el panel o, en modo móviles, darse de alta ellos mismos.
  const [players, setPlayers] = useState<string[]>([]);
  const [initialImageUrl, setInitialImageUrl] = useState<string | null>(null);
  const [maxPlayersText, setMaxPlayersText] = useState(String(MAX_PLAYERS));
  const maxPlayers = maxPlayersText.trim() === '' ? MAX_PLAYERS : Number(maxPlayersText);
  // Catálogo propio cargado desde una plantilla (null = el de la temática)
  const [items, setItems] = useState<LoadedCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [editingCatalog, setEditingCatalog] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplMsg, setTplMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const preset = THEME_PRESETS.find((t) => t.id === themeChoice);
  const themeValue = themeChoice === CUSTOM ? customTheme.trim() : themeChoice;
  const names = players.map((p) => p.trim()).filter(Boolean);
  /** Rondas por defecto = elementos del catálogo de la temática (las temáticas libres usan el catálogo base). */
  const defaultRounds = items?.length ?? (preset ?? getThemePreset('free'))?.items.length ?? 12;
  const roundsValue = maxRounds.trim() === '' ? defaultRounds : Number(maxRounds);
  /** Copia el catálogo de la temática para poder editarlo (a partir de aquí es un catálogo propio). */
  function customizeCatalog() {
    const base = (preset ?? getThemePreset('free'))?.items ?? [];
    setItems(base.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji, photoUrl: null, photoPath: null, photoFile: null })));
    setEditingCatalog(true);
  }

  async function saveAsTemplate() {
    const title = (tplName.trim() || name.trim()).slice(0, 80);
    setTplMsg(null);
    const err = [2, 3, 4].map((i) => validate(i)).find(Boolean);
    if (err) return setTplMsg({ ok: false, text: `Corrige antes: ${err}` });
    try {
      const r = await saveTemplateRequest(title, formToTemplate({ name, themeValue, budget, minBid, maxRounds: roundsValue, integerBids, ranking, playMode, imageMode, players: names, items }));
      setTplMsg({ ok: true, text: `${r.replaced ? 'Plantilla actualizada' : 'Plantilla guardada'}: «${r.name}». La verás en «Mis plantillas» al crear otra partida.${items?.some((i) => i.photoFile) ? ' Las fotos incluidas en un ZIP no se guardan (solo las URL).' : ''}` });
    } catch (e) {
      setTplMsg({ ok: false, text: (e as Error).message });
    }
  }

  function applyTemplate(v: LoadedTemplate) {
    setName(v.name);
    setThemeChoice(v.themeChoice);
    setCustomTheme(v.customTheme);
    setBudget(v.budget);
    setMinBid(v.minBid);
    setMaxRounds(v.maxRounds);
    setIntegerBids(v.integerBids);
    setRanking(v.ranking);
    setPlayMode(v.playMode);
    setImageMode(v.imageMode === 'ai' && !aiAvailable ? 'stickers' : v.imageMode);
    setPlayers(v.players);
    setItems(v.items);
    setInitialImageUrl(v.initialImageUrl ?? null);
    go(STEPS.length - 1); // directo al resumen para revisar
  }

  const last = step === STEPS.length - 1;
  const current = STEPS[step]!;

  // Al cambiar de paso el foco pasa al título (lectores de pantalla y mando de TV) y se sube al inicio.
  useEffect(() => {
    if (step === 0 && !headingRef.current?.dataset.touched) return;
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  /** Mensaje de error del paso `i`, o null si es válido. */
  function validate(i: number): string | null {
    if (i === 2) {
      if (!name.trim()) return 'Escribe un nombre para la partida.';
      if (!themeValue) return 'Escribe la temática.';
    }
    if (i === 3) {
      if (parseEurosToCents(budget) === null) return 'El presupuesto no es válido (usa por ejemplo 20 o 12,50).';
      const m = parseEurosToCents(minBid);
      if (m === null || m < 1) return 'La puja mínima no es válida.';
      if (integerBids && m % 100 !== 0) return 'Con pujas en euros enteros, la puja mínima también debe ser un euro entero (1, 2, 3…).';
      if (!Number.isInteger(roundsValue) || roundsValue < 1 || roundsValue > 500) return 'El máximo de rondas debe ser un número entre 1 y 500.';
    }
    if (i === 4 && (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS)) return `El máximo de jugadores debe estar entre 1 y ${MAX_PLAYERS}.`;
    if (i === 4 && names.length > maxPlayers) return `Has puesto ${names.length} jugadores y el máximo es ${maxPlayers}: quita alguno o sube el máximo.`;
    if (i === 4 && new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Hay nombres de jugador repetidos.';
    return null;
  }

  function go(to: number) {
    setError(null);
    setDir(to > step ? 1 : -1);
    if (headingRef.current) headingRef.current.dataset.touched = '1';
    setStep(to);
  }

  function next() {
    const err = validate(step);
    if (err) return setError(err);
    go(Math.min(step + 1, STEPS.length - 1));
  }

  async function create() {
    const catalogErr = items ? validateCatalog(items) : null;
    if (catalogErr) {
      go(STEPS.length - 1);
      setEditingCatalog(true);
      return setError(catalogErr);
    }
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validate(i);
      if (err) {
        go(i);
        return setError(err);
      }
    }
    setBusy(true);
    setError(null);
    try {
      const { room_code } = await createGameRequest({
        name: name.trim(),
        theme: themeValue,
        initial_budget_cents: parseEurosToCents(budget),
        min_bid_cents: parseEurosToCents(minBid),
        ranking_rule: ranking,
        play_mode: playMode,
        image_mode: imageMode,
        max_rounds: roundsValue,
        max_players: maxPlayers,
        integer_bids: integerBids,
        players: names.map((n, i) => ({ name: n, color: PLAYER_COLORS[i % PLAYER_COLORS.length] })),
        ...(items ? { items: items.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji })) } : {}),
      });
      // Fotos de la plantilla (por URL): la partida YA existe; si alguna falla se avisa en el panel pero no se bloquea nada.
      const photos = (items ?? []).filter((i) => i.photoUrl).map((i) => ({ name: i.name, url: i.photoUrl! }));
      if (photos.length > 0 || initialImageUrl) {
        setBusyLabel(photos.length ? `Descargando ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}…` : 'Descargando la imagen inicial…');
        try {
          const r = await importPhotosRequest(room_code, photos, initialImageUrl);
          const failed = [...r.failed, ...(r.initial && !r.initial.ok ? [{ name: 'Imagen inicial de la casa', reason: r.initial.reason ?? 'no se pudo guardar' }] : [])];
          if (failed.length > 0) window.sessionStorage.setItem('ss_import_notice', JSON.stringify({ code: room_code, imported: r.imported, failed }));
        } catch {
          window.sessionStorage.setItem('ss_import_notice', JSON.stringify({ code: room_code, imported: 0, failed: photos.map((p) => ({ name: p.name, reason: 'no se pudo descargar' })) }));
        }
      }
      // Fotos incrustadas en un ZIP: se suben desde el navegador con la misma ruta que la subida manual.
      const embedded = (items ?? []).filter((i) => i.photoFile);
      if (embedded.length > 0) {
        const failedEmbedded: { name: string; reason: string }[] = [];
        try {
          const snap = (await (await fetch(`/api/games/${room_code}`)).json()) as { snapshot: { items: { id: string; name: string }[] } };
          const ids = new Map<string, string[]>();
          for (const it of snap.snapshot.items) ids.set(it.name.toLowerCase(), [...(ids.get(it.name.toLowerCase()) ?? []), it.id]);
          const used = new Map<string, number>();
          let done = 0;
          for (const it of items ?? []) {
            const k = it.name.toLowerCase();
            const n = used.get(k) ?? 0;
            used.set(k, n + 1);
            if (!it.photoFile) continue;
            setBusyLabel(`Subiendo fotos ${++done}/${embedded.length}…`);
            const id = ids.get(k)?.[n];
            if (!id) { failedEmbedded.push({ name: it.name, reason: 'el elemento no existe' }); continue; }
            const file = new File([it.photoFile.data as BlobPart], it.photoFile.name.split('/').pop() ?? 'foto', { type: it.photoFile.type });
            for (let attempt = 0; ; attempt++) {
              try {
                await uploadItemImage(room_code, id, file);
                break;
              } catch (e) {
                if (e instanceof ApiError && e.code === 'rate_limited' && attempt < 2) { await new Promise((r) => setTimeout(r, 6000)); continue; }
                failedEmbedded.push({ name: it.name, reason: e instanceof ApiError ? e.message : 'no se pudo subir' });
                break;
              }
            }
          }
        } catch {
          for (const it of embedded) failedEmbedded.push({ name: it.name, reason: 'no se pudo subir' });
        }
        if (failedEmbedded.length > 0) {
          const prev = window.sessionStorage.getItem('ss_import_notice');
          const base = prev ? (JSON.parse(prev) as { failed: { name: string; reason: string }[] }) : { failed: [] };
          window.sessionStorage.setItem('ss_import_notice', JSON.stringify({ code: room_code, imported: 0, failed: [...base.failed, ...failedEmbedded] }));
        }
      }
      router.push(`/game/${room_code}/host`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setBusyLabel(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault(); // Enter dentro de un campo avanza de paso; solo en el último se crea la partida
    if (last) void create();
    else next();
  }

  const summaryRow = (title: string, to: number, children: ReactNode) => (
    <div className="rounded-2xl border border-white/10 bg-night-900 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">{title}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={() => go(to)} aria-label={`Editar ${title}`}>
          <Pencil className="size-4" aria-hidden /> Editar
        </Button>
      </div>
      <div className="text-base 2xl:text-xl">{children}</div>
    </div>
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl space-y-5 px-4 pb-32 pt-6 sm:px-6 2xl:max-w-5xl 2xl:space-y-8 2xl:pt-10">
      <div className="flex items-center justify-between">
        <Logo size="md" className="2xl:[&>img]:h-20" />
        <Link href="/" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:text-lg">
          <ArrowLeft className="size-4" aria-hidden /> Inicio
        </Link>
      </div>

      <h1 className="sr-only">Nueva partida</h1>
      <Stepper steps={STEPS} current={step} onGo={go} />

      <form onSubmit={submit} noValidate className="space-y-5">
        {/* Guía: la mascota cambia de gesto y comenta cada paso */}
        <div className="flex items-center gap-4">
          <Mascot key={current.id} variant={current.mascot} size="sm" tile motion="pop" className="2xl:[--mh:11rem]" />
          <div className="min-w-0">
            <Bubble key={current.say}>{current.say}</Bubble>
            <h2 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }} className="animate-float-in font-display text-2xl leading-tight outline-none sm:text-3xl 2xl:text-5xl" data-testid="wizard-title">
              {current.title}
            </h2>
            <p className="mt-1 text-sm text-white/65 2xl:text-xl">{current.hint}</p>
          </div>
        </div>

        <div key={step} className={`${dir === 1 ? 'ss-step-in-right' : 'ss-step-in-left'} space-y-4`} data-testid={`wizard-step-${step + 1}`}>
          {step === 0 ? (
            <>
              <TemplateImport onTemplate={applyTemplate} onCatalog={setItems} />
              <fieldset className={card}>
                <legend className="px-2 font-display text-xl 2xl:text-3xl">Quién puja</legend>
                <Choice name="play_mode" value="host" checked={playMode === 'host'} onChange={() => setPlayMode('host')} title="Pujas del anfitrión" desc="Los jugadores pujan en voz alta y tú registras cada puja desde tu panel. No necesitan móvil ni cuenta." />
                <Choice name="play_mode" value="mobile" checked={playMode === 'mobile'} onChange={() => setPlayMode('mobile')} title="Cada jugador desde su móvil" tag="Recomendado en grupo" desc="Los jugadores se unen con el código de sala (o un QR), eligen su nombre y pujan ellos mismos. Tú sigues anunciando, cerrando y adjudicando." />
              </fieldset>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <fieldset className={card}>
                <legend className="px-2 font-display text-xl 2xl:text-3xl">Cómo cambian las casas</legend>
                <Choice name="image_mode" value="stickers" checked={imageMode === 'stickers'} onChange={() => setImageMode('stickers')} title="🎨 Pegatinas con emojis" tag="Gratis" desc="Cada compra añade el emoji del elemento a la casa del jugador. Ilustraciones locales: sin IA, gratis e instantáneo." />
                <Choice
                  name="image_mode"
                  value="ai"
                  checked={imageMode === 'ai'}
                  disabled={!aiAvailable}
                  onChange={() => setImageMode('ai')}
                  title="✨ Con inteligencia artificial"
                  desc={aiAvailable ? `La IA (${providerLabel(aiProvider)}) genera la casa inicial y la va editando con cada compra. Tiene límites de generaciones por partida y por día.` : 'No disponible: este despliegue no tiene un proveedor de IA configurado (IMAGE_PROVIDER). Usa el modo pegatinas.'}
                />
              </fieldset>
            </>
          ) : null}

          {step === 2 ? (
            <section className={card}>
              <div>
                <label htmlFor="name" className={label}>Nombre de la partida</label>
                <input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="theme" className={label}>Temática</label>
                <select id="theme" value={themeChoice} onChange={(e) => setThemeChoice(e.target.value)} className={field}>
                  {THEME_PRESETS.map((t) => (
                    <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>
                  ))}
                  <option value={CUSTOM}>✏️ Otra (texto libre)</option>
                </select>
                {themeChoice === CUSTOM ? (
                  <input aria-label="Temática personalizada" placeholder="Ej.: base lunar, circo, submarino…" maxLength={120} value={customTheme} onChange={(e) => setCustomTheme(e.target.value)} className={`${field} mt-2`} />
                ) : (
                  <p className="mt-2 text-sm text-white/60 2xl:text-lg">Incluye {preset?.items.length} elementos para subastar; podrás editarlos, añadir los tuyos y generar sus imágenes.</p>
                )}
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className={card}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="budget" className={label}>Presupuesto inicial (€)</label>
                  <input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">Lo que tiene cada jugador al empezar.</p>
                </div>
                <div>
                  <label htmlFor="minbid" className={label}>Puja mínima (€)</label>
                  <input id="minbid" inputMode="decimal" value={minBid} onChange={(e) => setMinBid(e.target.value)} className={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">La primera puja de cada subasta no puede ser menor.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rounds" className={label}>Máximo de rondas</label>
                  <input id="rounds" inputMode="numeric" value={maxRounds} placeholder={String(defaultRounds)} onChange={(e) => setMaxRounds(e.target.value.replace(/\D/g, '').slice(0, 3))} className={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">Por defecto, los {defaultRounds} elementos del catálogo. Al jugarse todas las rondas la partida termina sola.</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-900 p-3 sm:mt-6 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold/50">
                  <input type="checkbox" checked={integerBids} onChange={(e) => setIntegerBids(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#fbbf24] 2xl:size-6" />
                  <span>
                    <span className="block font-bold 2xl:text-xl">Solo pujas en euros enteros</span>
                    <span className="block text-sm text-white/65 2xl:text-lg">{integerBids ? '1, 2, 3, 4… €.' : 'Se podrá pujar también 1,50 €, 2,25 €…'} Puedes cambiarlo luego en Ajustes.</span>
                  </span>
                </label>
              </div>
              <div>
                <label htmlFor="ranking" className={label}>Clasificación final (opcional)</label>
                <select id="ranking" value={ranking} onChange={(e) => setRanking(e.target.value as typeof ranking)} className={field}>
                  {(Object.keys(RANKING_LABEL) as (keyof typeof RANKING_LABEL)[]).map((k) => (
                    <option key={k} value={k}>{RANKING_LABEL[k]}</option>
                  ))}
                </select>
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section className={card}>
              <div className="rounded-2xl border border-teal/40 bg-teal/10 p-4 text-sm 2xl:text-lg" data-testid="players-help">
                <p className="font-bold text-teal">No hace falta añadir jugadores ahora</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-white/80">
                  <li>Puedes <b>crearlos más tarde</b> desde el panel de la partida (pestaña Jugadores), mientras estés en la sala de espera.</li>
                  {playMode === 'mobile' ? (
                    <li>Como la partida es <b>desde el móvil</b>, los propios jugadores pueden <b>darse de alta ellos mismos</b>: entran con el código o el QR y escriben su nombre (si dejas la política de altas «abierta», que es la de serie).</li>
                  ) : (
                    <li>Si prefieres que cada uno se dé de alta desde su móvil, elige «Cada jugador desde su móvil» en el primer paso.</li>
                  )}
                  <li>Para empezar necesitarás al menos 2 jugadores.</li>
                </ul>
              </div>
              <div>
                <label htmlFor="max-players" className="text-sm font-bold 2xl:text-lg">Máximo de jugadores (1–{MAX_PLAYERS})</label>
                <input id="max-players" inputMode="numeric" value={maxPlayersText} onChange={(e) => setMaxPlayersText(e.target.value.replace(/\D/g, '').slice(0, 2))} className={`${field} mt-1 w-28`} />
                <p className="mt-1 text-xs text-white/60 2xl:text-base">Nadie más podrá unirse a la partida al llegar a este número, aunque tenga el código. {MAX_PLAYERS} es el límite de la aplicación.</p>
              </div>
              {players.length === 0 ? <p className="text-sm text-white/60 2xl:text-lg">Todavía no has añadido ninguno.</p> : null}
              {players.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span aria-hidden className="size-6 shrink-0 rounded-full 2xl:size-8" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
                  <input aria-label={`Nombre del jugador ${i + 1}`} placeholder={`Jugador ${i + 1}`} maxLength={40} value={p} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? e.target.value : x)))} className={field} />
                  <Button type="button" variant="ghost" size="sm" aria-label={`Quitar jugador ${i + 1}`} onClick={() => setPlayers(players.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              {players.length < Math.min(maxPlayers, MAX_PLAYERS) ? (
                <Button type="button" variant={players.length === 0 ? 'primary' : 'secondary'} onClick={() => setPlayers([...players, ''])}>
                  <Plus className="size-4" aria-hidden /> Añadir jugador
                </Button>
              ) : null}
              <p className={`text-sm font-semibold ${names.length >= 2 ? 'text-teal' : 'text-white/60'} 2xl:text-lg`} aria-live="polite">
                {names.length} {names.length === 1 ? 'jugador' : 'jugadores'}{names.length < 2 ? ' · necesitarás al menos 2 para empezar (puedes crearlos luego)' : ' · ¡perfecto!'}
              </p>
            </section>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {summaryRow('Quién puja', 0, (
                <p className="font-bold">{playMode === 'host' ? 'Pujas del anfitrión' : 'Cada jugador desde su móvil'}</p>
              ))}
              {summaryRow('Las casas', 1, (
                <p className="font-bold">{imageMode === 'stickers' ? '🎨 Pegatinas con emojis (sin IA)' : '✨ Con inteligencia artificial'}</p>
              ))}
              {summaryRow('Partida', 2, (
                <>
                  <p className="font-bold">{name.trim() || '—'}</p>
                  <p className="text-white/70">{preset ? `${preset.emoji} ${preset.label}` : `✏️ ${themeValue || '—'}`}</p>
                </>
              ))}
              {summaryRow('Reglas', 3, (
                <>
                  <p>
                    Presupuesto <b className="text-gold">{formatEuros(parseEurosToCents(budget) ?? 0)}</b> · puja mínima <b className="text-gold">{formatEuros(parseEurosToCents(minBid) ?? 0)}</b>
                  </p>
                  <p className="text-white/70">{roundsValue} {roundsValue === 1 ? 'ronda' : 'rondas'} máximo · {integerBids ? 'pujas en euros enteros' : 'se admiten céntimos'}</p>
                  <p className="text-white/70">{RANKING_LABEL[ranking]}</p>
                </>
              ))}
              {items && editingCatalog ? (
                <CatalogEditor items={items} onChange={setItems} onClose={() => setEditingCatalog(false)} />
              ) : items ? (
                <div className="rounded-2xl border border-violet/40 bg-night-900 p-4 md:col-span-2" data-testid="summary-catalog">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">Catálogo propio</h3>
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingCatalog(true)} aria-label="Editar el catálogo">
                        <Pencil className="size-4" aria-hidden /> Editar catálogo
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setItems(null)} aria-label="Usar el catálogo de la temática">
                        <X className="size-4" aria-hidden /> Usar el de la temática
                      </Button>
                    </span>
                  </div>
                  <p className="text-base 2xl:text-xl">
                    <b>{items.length}</b> {items.length === 1 ? 'elemento' : 'elementos'} · {items.filter((i) => i.photoUrl || i.photoFile).length} con foto (se suben o descargan al crear la partida)
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {items.slice(0, 12).map((i, n) => (
                      <li key={i.name + n} className="flex items-center gap-1.5 rounded-full bg-night-800 px-3 py-1 text-sm 2xl:text-lg">
                        <span aria-hidden>{i.emoji ?? '📦'}</span> {i.name}{i.photoUrl || i.photoFile ? <span aria-label="con foto"> 🖼️</span> : null}
                      </li>
                    ))}
                    {items.length > 12 ? <li className="px-2 py-1 text-sm text-white/60">… y {items.length - 12} más</li> : null}
                  </ul>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-night-900 p-4 md:col-span-2" data-testid="summary-catalog-theme">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">Catálogo de la temática</h3>
                    <Button type="button" size="sm" variant="ghost" onClick={customizeCatalog} aria-label="Personalizar el catálogo">
                      <Pencil className="size-4" aria-hidden /> Personalizar catálogo
                    </Button>
                  </div>
                  <p className="text-base 2xl:text-xl"><b>{defaultRounds}</b> elementos de «{preset ? preset.label : 'temática libre'}». Puedes cambiarlos, añadir los tuyos y ponerles foto.</p>
                </div>
              )}
              <div className="rounded-2xl border border-white/10 bg-night-900 p-4 md:col-span-2" data-testid="save-template">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">Guardar como plantilla</h3>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="tplname" className={label}>Nombre de la plantilla</label>
                    <input id="tplname" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void saveAsTemplate())} maxLength={80} placeholder={name.trim() || 'Mi plantilla'} value={tplName} onChange={(e) => setTplName(e.target.value)} className={field} />
                  </div>
                  <Button type="button" variant="secondary" size="lg" onClick={() => void saveAsTemplate()}>Guardar plantilla</Button>
                </div>
                {tplMsg ? <p role={tplMsg.ok ? 'status' : 'alert'} data-testid="save-template-msg" className={`mt-2 text-sm font-semibold ${tplMsg.ok ? 'text-teal' : 'text-rose'}`}>{tplMsg.text}</p> : null}
              </div>
              {summaryRow('Jugadores', 4, (
                names.length === 0 ? (
                  <p className="text-white/70">Sin jugadores todavía: {playMode === 'mobile' ? 'podrás añadirlos en el panel o se darán de alta ellos mismos desde el móvil.' : 'podrás añadirlos en el panel (pestaña Jugadores).'}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {names.map((n, i) => (
                      <li key={n + i} className="flex items-center gap-1.5 rounded-full bg-night-800 px-3 py-1 text-sm 2xl:text-lg">
                        <span aria-hidden className="size-3 rounded-full" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} /> {n}
                      </li>
                    ))}
                  </ul>
                )
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p role="alert" data-testid="wizard-error" className="rounded-xl bg-rose/20 px-4 py-3 font-semibold text-rose 2xl:text-xl">{error}</p> : null}

        {/* Barra de navegación fija abajo: siempre al alcance del pulgar o del mando */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night-950/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 2xl:max-w-5xl">
            <Button type="button" variant="secondary" size="lg" onClick={() => go(step - 1)} disabled={step === 0 || busy} className={step === 0 ? 'invisible' : ''}>
              <ArrowLeft className="size-5" aria-hidden /> Atrás
            </Button>
            {last ? (
              <Button type="submit" variant="primary" size="xl" loading={busy} className="flex-1 sm:flex-none sm:min-w-72">
                <Rocket className="size-6" aria-hidden /> {busyLabel ?? 'Crear partida'}
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="lg" className="flex-1 sm:flex-none sm:min-w-56 2xl:min-h-16 2xl:text-xl">
                Siguiente <ArrowRight className="size-5" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}
