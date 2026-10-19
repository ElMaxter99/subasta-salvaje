'use client';

import { MAX_PLAYERS } from '@/lib/domain/limits';
import { providerLabel } from '@/lib/ai/labels';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Pencil, Plus, Rocket, Save, X } from 'lucide-react';
import { Bubble, Mascot } from '@/components/mascot/mascot';
import type { MascotId } from '@/components/mascot/assets';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { createGameRequest, importPhotosRequest, saveTemplateRequest } from '@/lib/client/api';
import { CatalogEditor, validateCatalog } from './catalog-editor';
import { LibraryPicker } from './library-picker';
import { HostLibraryPicker } from '@/components/host/library-image-picker';
import { LibraryImagePicker } from '@/components/admin/library-image-picker';
import { TEMPLATE_LIMITS } from '@/lib/domain/template';
import { TemplateImport, type LoadedCatalog, type LoadedTemplate } from './template-import';
import { CUSTOM_THEME, formToTemplate, parseTemplate, templateToForm, type Template } from '@/lib/domain/template';
import { adminPost } from '@/lib/client/admin-api';
import { commitTemplateImagesRequest, stageTemplateImageRequest, type StagedTemplateImage } from '@/lib/client/template-upload';
import { SystemTemplateStep, slugFromTitle, type SystemMeta } from '@/components/admin/system-template-step';
import { ApiError, uploadItemImage } from '@/lib/client/api';
import { parseOhrosToCents } from '@/lib/domain/money';
import { PLAYER_COLORS } from '@/lib/domain/schemas';
import { THEME_PRESETS, getThemePreset } from '@/lib/domain/themes';
import { Stepper, type StepInfo } from './new-game-stepper';
import { Ohros } from '@/components/ui/ohros';
import { RoundsField } from '@/components/ui/rounds-field';
import { PRESETS, planPreset, type PresetContext, type PresetId, type PresetPlan } from '@/lib/domain/presets';

const CUSTOM = CUSTOM_THEME;
/** `2xl` (≥1536 px, p. ej. una TV a 1080p con zoom del navegador) agranda campos y botones para leer a distancia. */
const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:px-5 2xl:py-4 2xl:text-xl';
const label = 'mb-1 block text-sm font-bold 2xl:text-lg';
const card = 'space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-4 sm:p-6';

const STEPS: (StepInfo & { mascot: MascotId; say: string; title: string; hint: string })[] = [
  { id: 'modo', label: 'Quién puja', mascot: 'expr-feliz', say: '¡Empezamos!', title: '¿Quién va a pujar?', hint: 'Elige si pujáis en voz alta o cada jugador desde su móvil.' },
  { id: 'casas', label: 'Las imágenes', mascot: 'expr-sorprendido', say: '¡Magia!', title: '¿Cómo cambian las imágenes?', hint: 'Cada compra transforma la imagen del jugador: con pegatinas gratis o con inteligencia artificial.' },
  { id: 'partida', label: 'Partida', mascot: 'expr-guino', say: 'Ponle nombre', title: 'Dale personalidad a la partida', hint: 'El nombre sale en la tele y la temática decide los elementos que se subastan.' },
  { id: 'reglas', label: 'Reglas', mascot: 'expr-pensativo', say: 'Ojo al dinero', title: 'Dinero y reglas', hint: 'Cuánto tiene cada jugador, la puja más baja posible y cómo se decide quién gana.' },
  { id: 'jugadores', label: 'Jugadores', mascot: 'expr-sorprendido', say: '¿Quién viene?', title: '¿Quién juega?', hint: 'Mínimo 2 para empezar. Podrás cambiarlos en la sala de espera.' },
  { id: 'resumen', label: 'Resumen', mascot: 'expr-celebrando', say: '¡Todo listo!', title: 'Revisa y crea la partida', hint: 'Pulsa «Editar» en cualquier bloque para cambiar algo.' },
];

/** Modo superadmin: mismo recorrido que el anfitrión, con un paso más («Ficha») antes del resumen. */
const SYSTEM_STEPS: typeof STEPS = [
  ...STEPS.slice(0, 5),
  { id: 'ficha', label: 'Ficha', mascot: 'expr-guino', say: 'La tarjeta', title: 'Ficha de la partida del sistema', hint: 'Título, descripción, portada, imagen inicial y fotos: lo que verán los anfitriones al elegirla.' },
  { ...STEPS[5]!, title: 'Revisa y guarda el borrador', hint: 'Pulsa «Editar» en cualquier bloque. Publicarla se hace desde la lista de plantillas, tras comprobar las imágenes.' },
];

/** Plantilla del sistema que se edita (o null para una nueva). */
export interface SystemDraft { id: string; slug: string; title: string; description: string; sort_order: number; data: Template }

/** Catálogo editable a partir del de una temática (las plantillas del sistema siempre llevan catálogo propio). */
function presetCatalog(themeChoice: string): LoadedCatalog {
  const base = (THEME_PRESETS.find((t) => t.id === themeChoice) ?? getThemePreset('free'))?.items ?? [];
  return base.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji, photoUrl: null, photoPath: null, photoFile: null }));
}

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

/** Ritmo de la partida (valores de serie de SQL: adjudicación automática apagada a 20 s, pausa 10 s, 60 s sin pujas, sin sorpresas). */
interface Pace { awardOn: boolean; awardSecs: string; gap: string; idle: string; wild: string }
const DEFAULT_PACE: Pace = { awardOn: false, awardSecs: '20', gap: '10', idle: '60', wild: '0' };
const inRange = (t: string, lo: number, hi: number) => /^\d+$/.test(t) && Number(t) >= lo && Number(t) <= hi;
const paceError = (p: Pace): string | null => {
  if (!inRange(p.awardSecs, 3, 300)) return 'Los segundos de la adjudicación automática deben estar entre 3 y 300.';
  if (!inRange(p.gap, 3, 300)) return 'La pausa entre subastas debe estar entre 3 y 300 segundos.';
  if (!inRange(p.idle, 10, 600)) return 'El tiempo sin pujas debe estar entre 10 y 600 segundos.';
  if (!inRange(p.wild, 0, 100)) return 'La probabilidad de eventos sorpresa debe estar entre 0 y 100 %.';
  return null;
};

export function NewGameForm({ aiAvailable, aiProvider, systemEditor }: { aiAvailable: boolean; systemEditor?: { draft: SystemDraft | null; uploadsEnabled: boolean }; aiProvider: 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo' }) {
  const router = useRouter();
  const steps = systemEditor ? SYSTEM_STEPS : STEPS;
  // Modo superadmin: el asistente arranca con la plantilla que se edita (o con el catálogo de la temática para poder personalizarlo).
  const [init] = useState(() => (systemEditor?.draft ? templateToForm(systemEditor.draft.data) : null));
  const [step, setStep] = useState(0);
  /** Paso más lejano al que se ha llegado: el asistente deja saltar con un clic hasta él (validando los pasos intermedios). */
  const [reached, setReached] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [name, setName] = useState(init?.name ?? (systemEditor ? 'Mi partida del sistema' : 'Noche de Subasta Salvaje'));
  const [themeChoice, setThemeChoice] = useState(init?.themeChoice ?? 'house');
  const [customTheme, setCustomTheme] = useState(init?.customTheme ?? '');
  const [budget, setBudget] = useState(init?.budget ?? '20');
  const [minBid, setMinBid] = useState(init?.minBid ?? '1');
  const [playMode, setPlayMode] = useState<'host' | 'mobile'>(init?.playMode ?? 'host');
  const [imageMode, setImageMode] = useState<'stickers' | 'ai'>(init?.imageMode === 'ai' && aiAvailable ? 'ai' : 'stickers');
  const [ranking, setRanking] = useState<'none' | 'balance' | 'items' | 'votes'>(init?.ranking ?? 'none');
  const [maxRounds, setMaxRounds] = useState(init?.maxRounds ?? '');
  const [integerBids, setIntegerBids] = useState(init?.integerBids ?? true);
  // Preset elegido y «ritmo» (adjudicación/subasta automática y sorpresas). `pace` null = valores de serie, no se envía nada.
  const [presetId, setPresetId] = useState<PresetId | null>(null);
  const [appliedPlan, setAppliedPlan] = useState<PresetPlan | null>(null);
  const [pace, setPace] = useState<Pace | null>(null);
  // Sin jugadores de partida: se pueden crear luego en el panel o, en modo móviles, darse de alta ellos mismos.
  const [players, setPlayers] = useState<string[]>(init?.players ?? []);
  const [initialImageUrl, setInitialImageUrl] = useState<string | null>(init?.initialImageUrl ?? null);
  const [housePicker, setHousePicker] = useState(false);
  const [houseTitle, setHouseTitle] = useState('');
  const [systemSlug, setSystemSlug] = useState<string | null>(null); // partida del sistema de la que sale (solo estadísticas)
  const [maxPlayersText, setMaxPlayersText] = useState(String(MAX_PLAYERS));
  const maxPlayers = maxPlayersText.trim() === '' ? MAX_PLAYERS : Number(maxPlayersText);
  // Catálogo propio cargado desde una plantilla (null = el de la temática)
  const [items, setItems] = useState<LoadedCatalog | null>(init?.items ? init.items.map((i) => ({ ...i, photoFile: null })) : systemEditor ? presetCatalog(init?.themeChoice ?? 'house') : null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [editingCatalog, setEditingCatalog] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [photoPick, setPhotoPick] = useState<number | null>(null);
  /** Imágenes elegidas en el editor del superadmin, por su dirección local (blob:): se suben al guardar. */
  const pending = useRef(new Map<string, File>());
  const addLocal = (file: File): string => {
    const url = URL.createObjectURL(file);
    pending.current.set(url, file);
    return url;
  };
  useEffect(() => {
    const map = pending.current;
    return () => { for (const u of map.keys()) URL.revokeObjectURL(u); };
  }, []);
  const [tplName, setTplName] = useState('');
  const [tplMsg, setTplMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SystemMeta>(() => {
    const d = systemEditor?.draft;
    if (d) return { slug: d.slug, title: d.title, description: d.description, sortOrder: String(d.sort_order), portada: d.data.portada ?? null, creditos: d.data.creditos ?? '', slugTouched: true };
    const title = 'Mi partida del sistema';
    return { slug: slugFromTitle(title), title, description: '', sortOrder: '100', portada: null, creditos: '', slugTouched: false };
  });
  const patchMeta = (patch: Partial<SystemMeta>) => setMeta((m) => ({ ...m, ...patch }));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [touched, setTouched] = useState(false);

  const preset = THEME_PRESETS.find((t) => t.id === themeChoice);
  const themeValue = themeChoice === CUSTOM ? customTheme.trim() : themeChoice;
  const names = players.map((p) => p.trim()).filter(Boolean);
  /** Rondas por defecto = elementos del catálogo de la temática (las temáticas libres usan el catálogo base). */
  const defaultRounds = items?.length ?? (preset ?? getThemePreset('free'))?.items.length ?? 12;
  const roundsValue = maxRounds.trim() === '' ? defaultRounds : Number(maxRounds);
  /** Lo que el asistente tiene ahora, en la forma que entiende `planPreset` (para listar qué cambia un preset y detectar ediciones a mano). */
  const presetContext = (): PresetContext => {
    const p = pace ?? DEFAULT_PACE;
    return {
      status: 'new',
      items: defaultRounds,
      play_mode: playMode,
      current: {
        initial_budget_cents: parseOhrosToCents(budget) ?? undefined,
        min_bid_cents: parseOhrosToCents(minBid) ?? undefined,
        max_rounds: Number.isInteger(roundsValue) ? roundsValue : undefined,
        integer_bids: integerBids,
        max_players: maxPlayers,
        auto_award_enabled: p.awardOn,
        auto_award_seconds: Number(p.awardSecs),
        auto_run_gap_seconds: Number(p.gap),
        auto_run_idle_seconds: Number(p.idle),
        wild_chance_pct: Number(p.wild),
        join_policy: 'open',
      },
    };
  };
  function applyPreset(id: PresetId) {
    const plan = planPreset(id, presetContext());
    const st = plan.settings;
    if (st.initial_budget_cents !== undefined) setBudget(String(st.initial_budget_cents / 100));
    if (st.min_bid_cents !== undefined) setMinBid(String(st.min_bid_cents / 100));
    if (st.max_rounds !== undefined) setMaxRounds(String(st.max_rounds));
    if (st.integer_bids !== undefined) setIntegerBids(st.integer_bids);
    if (st.max_players !== undefined) setMaxPlayersText(String(st.max_players));
    setPace({
      awardOn: st.auto_award?.enabled ?? false,
      awardSecs: String(st.auto_award?.seconds ?? 20),
      gap: String(st.auto_run?.gap_seconds ?? 10),
      idle: String(st.auto_run?.idle_seconds ?? 60),
      wild: String(st.wild_chance_pct ?? 0),
    });
    setPresetId(id);
    setAppliedPlan(plan);
    setError(null);
  }
  const presetEdited = presetId !== null && planPreset(presetId, presetContext()).changes.length > 0;
  /** Copia el catálogo de la temática para poder editarlo (a partir de aquí es un catálogo propio). */
  function customizeCatalog() {
    const base = (preset ?? getThemePreset('free'))?.items ?? [];
    setItems(base.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji, photoUrl: null, photoPath: null, photoFile: null })));
    setEditingCatalog(true);
  }

  /** Añade productos de la biblioteca al catálogo (el de la temática pasa a ser propio); los nombres repetidos se omiten. */
  function importFromLibrary(picked: LoadedCatalog) {
    const base = items ?? presetCatalog(themeChoice);
    const names = new Set(base.map((i) => i.name.trim().toLowerCase()));
    const fresh = picked.filter((p) => !names.has(p.name.trim().toLowerCase())).slice(0, Math.max(0, TEMPLATE_LIMITS.items - base.length));
    setItems([...base, ...fresh]);
    setPickerOpen(false);
    setError(fresh.length < picked.length ? `Se añadieron ${fresh.length} de ${picked.length} productos (los repetidos o los que superan el máximo de ${TEMPLATE_LIMITS.items} se omiten).` : null);
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

  function applyTemplate(v: LoadedTemplate, opts: { jump?: boolean } = {}) {
    setPresetId(null);
    setAppliedPlan(null);
    setPace(null);
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
    if (opts.jump !== false) go(steps.length - 1); // directo al resumen para revisar
  }


  const last = step === steps.length - 1;
  const current = steps[step]!;

  // Al cambiar de paso el foco pasa al título (lectores de pantalla y mando de TV) y se sube al inicio.
  useEffect(() => {
    if (step === 0 && !touched) return;
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, touched]);

  /** Mensaje de error del paso `i`, o null si es válido. */
  function validate(i: number): string | null {
    if (i === 2) {
      if (!name.trim()) return 'Escribe un nombre para la partida.';
      if (!themeValue) return 'Escribe la temática.';
    }
    if (i === 3) {
      if (parseOhrosToCents(budget) === null) return 'El presupuesto no es válido (usa por ejemplo 20 o 12,50).';
      const m = parseOhrosToCents(minBid);
      if (m === null || m < 1) return 'La puja mínima no es válida.';
      if (integerBids && m % 100 !== 0) return 'Con pujas en Ohros enteros, la puja mínima también debe ser un Ohro entero (1, 2, 3…).';
      if (!Number.isInteger(roundsValue) || roundsValue < 1 || roundsValue > 500) return 'El máximo de rondas debe ser un número entre 1 y 500.';
      if (roundsValue > defaultRounds) return `El máximo de rondas no puede superar los ${defaultRounds} elementos del catálogo.`;
      if (pace) {
        const pe = paceError(pace);
        if (pe) return pe;
      }
    }
    if (systemEditor && i === 5) {
      if (!meta.title.trim()) return 'Escribe el título de la tarjeta.';
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug) || meta.slug.length < 2) return 'El identificador solo admite minúsculas, números y guiones (mínimo 2 caracteres).';
      if (meta.portada && !/^(https:\/\/|blob:)/i.test(meta.portada)) return 'La portada no es válida: súbela o elígela de la biblioteca.';
      if (initialImageUrl && !/^(https:\/\/|blob:)/i.test(initialImageUrl)) return 'La imagen inicial no es válida: súbela o elígela de la biblioteca.';
    }
    if (i === 4 && (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS)) return `El máximo de jugadores debe estar entre 1 y ${MAX_PLAYERS}.`;
    if (i === 4 && names.length > maxPlayers) return `Has puesto ${names.length} jugadores y el máximo es ${maxPlayers}: quita alguno o sube el máximo.`;
    if (i === 4 && new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Hay nombres de jugador repetidos.';
    return null;
  }

  function go(to: number) {
    setError(null);
    setDir(to > step ? 1 : -1);
    setTouched(true);
    setReached((r) => Math.max(r, to));
    setStep(to);
  }

  /** Clic en el indicador de pasos: si se avanza, todos los pasos intermedios deben ser válidos; si no, se lleva al primero que falla. */
  function jump(to: number) {
    for (let i = step; i < to; i++) {
      const err = validate(i);
      if (err) {
        go(i);
        setError(err);
        return;
      }
    }
    go(to);
  }

  function next() {
    const err = validate(step);
    if (err) return setError(err);
    go(Math.min(step + 1, steps.length - 1));
  }

  async function create() {
    const catalogErr = items ? validateCatalog(items) : null;
    if (catalogErr) {
      go(steps.length - 1);
      setEditingCatalog(true);
      return setError(catalogErr);
    }
    for (let i = 0; i < steps.length - 1; i++) {
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
        initial_budget_cents: parseOhrosToCents(budget),
        min_bid_cents: parseOhrosToCents(minBid),
        ranking_rule: ranking,
        play_mode: playMode,
        image_mode: imageMode,
        max_rounds: Math.min(roundsValue, defaultRounds), // nunca más rondas que elementos en el catálogo (el catálogo pudo cambiar después)
        max_players: maxPlayers,
        integer_bids: integerBids,
        ...(pace
          ? {
              extras: {
                auto_award: { enabled: pace.awardOn, seconds: Number(pace.awardSecs) },
                auto_run: { gap_seconds: Number(pace.gap), idle_seconds: Number(pace.idle) },
                wild_chance_pct: Number(pace.wild),
                ...(presetId ? { preset_id: presetId } : {}),
              },
            }
          : {}),
        ...(systemSlug ? { template_slug: systemSlug } : {}),
        players: names.map((n, i) => ({ name: n, color: PLAYER_COLORS[i % PLAYER_COLORS.length] })),
        ...(items ? { items: items.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji })) } : {}),
      });
      // Fotos de la plantilla (por URL): la partida YA existe; si alguna falla se avisa en el panel pero no se bloquea nada.
      const photos = (items ?? []).filter((i) => i.photoUrl).map((i) => ({ name: i.name, url: i.photoUrl! }));
      if (photos.length > 0 || initialImageUrl) {
        setBusyLabel(photos.length ? `Descargando ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}…` : 'Descargando la imagen inicial…');
        try {
          const r = await importPhotosRequest(room_code, photos, initialImageUrl);
          const failed = [...r.failed, ...(r.initial && !r.initial.ok ? [{ name: 'Imagen inicial', reason: r.initial.reason ?? 'no se pudo guardar' }] : [])];
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

  /**
   * Superadmin: las imágenes elegidas NO se suben mientras se edita (viven en memoria, con vista previa local). Al guardar se
   * preparan todas, se publican en UN solo commit (borrando las que la plantilla ya no usa) y se guarda el borrador.
   */
  async function saveSystem() {
    const list = items ?? [];
    const catalogErr = validateCatalog(list, { allowLocal: true });
    if (catalogErr) {
      go(steps.length - 1);
      setEditingCatalog(true);
      return setError(catalogErr);
    }
    for (let i = 0; i < steps.length - 1; i++) {
      const err = validate(i);
      if (err) {
        go(i);
        return setError(err);
      }
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Preparar (sin commit) las imágenes nuevas: portada, imagen inicial y fotos de elementos con archivo local.
      const fields: { url: string | null; kind: 'cover' | 'scene' | 'item'; name: string }[] = [
        { url: meta.portada, kind: 'cover', name: 'portada' },
        { url: initialImageUrl, kind: 'scene', name: 'casa-inicial' },
        ...list.map((it) => ({ url: it.photoUrl, kind: 'item' as const, name: it.name })),
      ];
      const local = [...new Set(fields.filter((f) => f.url?.startsWith('blob:')).map((f) => f.url!))];
      const staged = new Map<string, StagedTemplateImage>();
      for (const [n, blob] of local.entries()) {
        setBusyLabel(`Preparando imágenes ${n + 1}/${local.length}…`);
        const field = fields.find((f) => f.url === blob)!;
        const file = pending.current.get(blob);
        if (!file) throw new Error('Se perdió una imagen elegida: vuelve a elegirla.');
        staged.set(blob, await stageTemplateImageRequest(meta.slug, field.kind, new File([file], `${field.name}.${file.name.split('.').pop() ?? 'jpg'}`, { type: file.type })));
      }
      // 2. Un único commit con las nuevas y el borrado de las que ya no se usan.
      setBusyLabel('Publicando imágenes…');
      const keepUrls = fields.map((f) => f.url).filter((u): u is string => Boolean(u && u.startsWith('https://')));
      const commit = await commitTemplateImagesRequest({ slug: meta.slug, templateId: systemEditor?.draft?.id ?? null, staged: [...staged.values()], keepUrls });
      const finalUrl = (blob: string | null) => {
        if (!blob || !blob.startsWith('blob:')) return blob;
        const st = staged.get(blob);
        return commit.files.find((f) => f.path === st?.path)?.url ?? null;
      };
      // 3. Guardar el borrador con los enlaces definitivos.
      setBusyLabel('Guardando…');
      const resolved = list.map((it) => ({ ...it, photoUrl: finalUrl(it.photoUrl) }));
      const base = formToTemplate({ name, themeValue, budget, minBid, maxRounds: roundsValue, integerBids, ranking, playMode, imageMode, players: names, items: resolved });
      const parsed = parseTemplate(JSON.stringify({ ...base, portada: finalUrl(meta.portada), casa_inicial: finalUrl(initialImageUrl), creditos: meta.creditos.trim() || null }));
      if (!parsed.ok) throw new Error(parsed.errors[0] ?? 'La plantilla no es válida.');
      const d = systemEditor?.draft;
      await adminPost('system-templates', { op: 'save', ...(d ? { id: d.id } : {}), slug: meta.slug, title: meta.title.trim(), description: meta.description.trim(), sort_order: Number(meta.sortOrder) || 100, data: parsed.template });
      router.push('/admin/plantillas?guardada=1');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setBusyLabel(null);
    }
  }

  /** Foto de un elemento (superadmin): se guarda en memoria hasta «Guardar borrador». */
  function uploadItemPhoto(index: number, file: File) {
    setError(null);
    const url = addLocal(file);
    setItems((cur) => (cur ? cur.map((it, k) => (k === index ? { ...it, photoUrl: url, photoFile: null, photoPath: null } : it)) : cur));
  }

  function submit(e: FormEvent) {
    e.preventDefault(); // Enter dentro de un campo avanza de paso; solo en el último se crea la partida
    if (last) void (systemEditor ? saveSystem() : create());
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
        <Link href={systemEditor ? '/admin/plantillas' : '/'} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:text-lg">
          <ArrowLeft className="size-4" aria-hidden /> {systemEditor ? 'Plantillas' : 'Inicio'}
        </Link>
      </div>

      <h1 className="sr-only">{systemEditor ? 'Plantilla del sistema' : 'Nueva partida'}</h1>
      <Stepper steps={steps} current={step} reached={reached} onGo={jump} />

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
              {systemEditor ? null : <TemplateImport onTemplate={(v, slug) => { applyTemplate(v); setSystemSlug(slug ?? null); }} onCatalog={setItems} />}
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
                <legend className="px-2 font-display text-xl 2xl:text-3xl">Cómo cambian las imágenes</legend>
                <Choice name="image_mode" value="stickers" checked={imageMode === 'stickers'} onChange={() => setImageMode('stickers')} title="🎨 Pegatinas con emojis" tag="Gratis" desc="Cada compra añade el emoji del elemento a la imagen del jugador. Ilustraciones locales: sin IA, gratis e instantáneo." />
                <Choice
                  name="image_mode"
                  value="ai"
                  checked={imageMode === 'ai'}
                  disabled={!aiAvailable}
                  onChange={() => setImageMode('ai')}
                  title="✨ Con inteligencia artificial"
                  desc={aiAvailable ? `La IA (${providerLabel(aiProvider)}) genera la imagen inicial y la va editando con cada compra. Tiene límites de generaciones por partida y por día.` : 'No disponible: este despliegue no tiene un proveedor de IA configurado (IMAGE_PROVIDER). Usa el modo pegatinas.'}
                />
              </fieldset>
              {systemEditor ? null : (
                <fieldset className={card} data-testid="wizard-house">
                  <legend className="px-2 font-display text-xl 2xl:text-3xl">Imagen inicial (opcional)</legend>
                  <p className="text-sm text-white/70 2xl:text-lg">Puedes elegir ya una foto de la biblioteca como imagen inicial de todos los jugadores. Si no, la pondrás luego desde el panel (subiéndola, de la galería o generándola).</p>
                  {initialImageUrl ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-night-900 p-2" data-testid="wizard-house-chosen">
                      {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario o vista local */}
                      <img src={initialImageUrl} alt="" referrerPolicy="no-referrer" className="aspect-[3/2] w-28 rounded-xl object-cover" />
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{houseTitle || 'Imagen inicial elegida'}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setInitialImageUrl(null); setHouseTitle(''); }} aria-label="Quitar la imagen inicial elegida"><X className="size-4" aria-hidden /></Button>
                    </div>
                  ) : null}
                  <div>
                    <Button type="button" variant="secondary" onClick={() => setHousePicker(true)} data-testid="wizard-house-from-library">Elegir de la biblioteca</Button>
                  </div>
                  <HostLibraryPicker open={housePicker} role="start" title="Elegir la imagen inicial de la biblioteca" onClose={() => setHousePicker(false)} onPick={(img) => { setInitialImageUrl(img.url); setHouseTitle(img.title); setHousePicker(false); }} />
                </fieldset>
              )}
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
            <>
            <fieldset className={card} data-testid="wizard-presets">
              <legend className="px-2 font-display text-xl 2xl:text-3xl">Preset (opcional)</legend>
              <p className="text-sm text-white/70 2xl:text-lg">Rellena de golpe el dinero, las rondas y el ritmo. Se ajusta a los {defaultRounds} elementos del catálogo y después puedes cambiar cualquier valor.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {PRESETS.map((p) => (
                  <Choice key={p.id} name="preset" value={p.id} checked={presetId === p.id && !presetEdited} onChange={() => applyPreset(p.id)} title={<>{p.emoji} {p.label}</>} desc={p.desc} />
                ))}
              </div>
              {presetId && appliedPlan ? (
                <div className="rounded-2xl border border-teal/40 bg-teal/10 p-3 text-sm 2xl:text-lg" data-testid="wizard-preset-applied" role="status">
                  <p className="font-bold text-teal">{presetEdited ? `«${appliedPlan.preset.label}» con cambios tuyos (personalizado)` : `«${appliedPlan.preset.label}» aplicado`}</p>
                  {appliedPlan.changes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-white/85">
                      {appliedPlan.changes.map((c) => <li key={c.key}>{c.label}: <span className="text-white/55 line-through">{c.from}</span> → <b className="text-gold">{c.to}</b></li>)}
                    </ul>
                  ) : <p className="text-white/80">No ha cambiado nada: ya estaba así.</p>}
                  {appliedPlan.notes.map((n) => <p key={n} className="mt-1 text-white/80">{n}</p>)}
                </div>
              ) : null}
            </fieldset>
            <section className={card}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="budget" className={label}>Presupuesto inicial (Ohros)</label>
                  <input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">Lo que tiene cada jugador al empezar.</p>
                </div>
                <div>
                  <label htmlFor="minbid" className={label}>Puja mínima (Ohros)</label>
                  <input id="minbid" inputMode="decimal" value={minBid} onChange={(e) => setMinBid(e.target.value)} className={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">La primera puja de cada subasta no puede ser menor.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rounds" className={label}>Máximo de rondas</label>
                  <RoundsField id="rounds" value={maxRounds} onChange={setMaxRounds} total={defaultRounds} inputClassName={field} />
                  <p className="mt-1 text-xs text-white/55 2xl:text-base">Por defecto, todos los elementos del catálogo (ese es también el máximo). Al jugarse todas las rondas la partida termina sola.</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-900 p-3 sm:mt-6 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold/50">
                  <input type="checkbox" checked={integerBids} onChange={(e) => setIntegerBids(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#fbbf24] 2xl:size-6" />
                  <span>
                    <span className="block font-bold 2xl:text-xl">Solo pujas en Ohros enteros</span>
                    <span className="block text-sm text-white/65 2xl:text-lg">{integerBids ? '1, 2, 3, 4… Ohros.' : 'Se podrá pujar también 1,50 Ohros, 2,25 Ohros…'} Puedes cambiarlo luego en Ajustes.</span>
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
              <details className="rounded-2xl border border-white/10 bg-night-900 p-3" data-testid="wizard-pace" open={pace !== null}>
                <summary className="cursor-pointer font-bold 2xl:text-xl">Ritmo y sorpresas (opcional)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
                    <input type="checkbox" checked={(pace ?? DEFAULT_PACE).awardOn} onChange={(e) => setPace({ ...(pace ?? DEFAULT_PACE), awardOn: e.target.checked })} className="mt-1 size-5 shrink-0 accent-[#fbbf24] 2xl:size-6" />
                    <span><b>Adjudicación automática</b><span className="block text-sm text-white/65">La subasta se adjudica sola unos segundos después de la última puja.</span></span>
                  </label>
                  <div>
                    <label htmlFor="pace-award" className={label}>Adjudicar a los (s)</label>
                    <input id="pace-award" inputMode="numeric" className={field} value={(pace ?? DEFAULT_PACE).awardSecs} onChange={(e) => setPace({ ...(pace ?? DEFAULT_PACE), awardSecs: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                  </div>
                  <div>
                    <label htmlFor="pace-wild" className={label}>Eventos sorpresa (%)</label>
                    <input id="pace-wild" inputMode="numeric" className={field} value={(pace ?? DEFAULT_PACE).wild} onChange={(e) => setPace({ ...(pace ?? DEFAULT_PACE), wild: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                  </div>
                  <div>
                    <label htmlFor="pace-gap" className={label}>Pausa entre subastas, automática (s)</label>
                    <input id="pace-gap" inputMode="numeric" className={field} value={(pace ?? DEFAULT_PACE).gap} onChange={(e) => setPace({ ...(pace ?? DEFAULT_PACE), gap: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                  </div>
                  <div>
                    <label htmlFor="pace-idle" className={label}>Sin pujas se salta a los (s)</label>
                    <input id="pace-idle" inputMode="numeric" className={field} value={(pace ?? DEFAULT_PACE).idle} onChange={(e) => setPace({ ...(pace ?? DEFAULT_PACE), idle: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-white/55 2xl:text-base">La subasta automática se enciende luego desde el panel; aquí solo se fijan sus tiempos. Todo se puede cambiar en Ajustes.</p>
              </details>
            </section>
            </>
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

          {systemEditor && step === 5 ? (
            <SystemTemplateStep
              meta={meta}
              onMeta={patchMeta}
              initialImage={initialImageUrl}
              onInitialImage={setInitialImageUrl}
              itemTitles={(items ?? []).map((i) => i.name)}
              onItemPhoto={(index, url) => setItems((cur) => (cur ? cur.map((it, k) => (k === index ? { ...it, photoUrl: url, photoFile: null, photoPath: null } : it)) : cur))}
              addLocal={addLocal}
              uploadsEnabled={systemEditor.uploadsEnabled}
            />
          ) : null}

          {last ? (
            <div className="grid gap-3 md:grid-cols-2">
              {summaryRow('Quién puja', 0, (
                <p className="font-bold">{playMode === 'host' ? 'Pujas del anfitrión' : 'Cada jugador desde su móvil'}</p>
              ))}
              {summaryRow('Las imágenes', 1, (
                <>
                  <p className="font-bold">{imageMode === 'stickers' ? '🎨 Pegatinas con emojis (sin IA)' : '✨ Con inteligencia artificial'}</p>
                  {!systemEditor && initialImageUrl ? <p className="text-white/70">Imagen inicial: {houseTitle || 'elegida'}</p> : null}
                </>
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
                    Presupuesto <b className="text-gold"><Ohros cents={parseOhrosToCents(budget) ?? 0} /></b> · puja mínima <b className="text-gold"><Ohros cents={parseOhrosToCents(minBid) ?? 0} /></b>
                  </p>
                  <p className="text-white/70">{roundsValue} {roundsValue === 1 ? 'ronda' : 'rondas'} máximo · {integerBids ? 'pujas en Ohros enteros' : 'se admiten céntimos'}</p>
                  <p className="text-white/70">{RANKING_LABEL[ranking]}</p>
                  {pace ? (
                    <p className="text-white/70" data-testid="summary-pace">
                      {presetId ? `${PRESETS.find((x) => x.id === presetId)?.label}${presetEdited ? ' (personalizado)' : ''} · ` : ''}
                      {pace.awardOn ? `adjudica a los ${pace.awardSecs} s` : 'sin adjudicación automática'} · pausa {pace.gap} s · sin pujas {pace.idle} s · sorpresas {pace.wild} %
                    </p>
                  ) : null}
                  <p className="text-white/70">Hasta {maxPlayers} jugadores</p>
                </>
              ))}
              {items && editingCatalog ? (
                <CatalogEditor items={items} onChange={setItems} onClose={() => setEditingCatalog(false)} onUploadPhoto={systemEditor?.uploadsEnabled ? (i, f) => uploadItemPhoto(i, f) : undefined} onPickPhoto={systemEditor ? (i) => setPhotoPick(i) : undefined} />
              ) : items ? (
                <div className="rounded-2xl border border-violet/40 bg-night-900 p-4 md:col-span-2" data-testid="summary-catalog">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">Catálogo propio</h3>
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPickerOpen(true)} aria-label="Importar productos de la biblioteca">
                        <Plus className="size-4" aria-hidden /> De la biblioteca
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingCatalog(true)} aria-label="Editar el catálogo">
                        <Pencil className="size-4" aria-hidden /> Editar catálogo
                      </Button>
                      {systemEditor ? null : (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setItems(null)} aria-label="Usar el catálogo de la temática">
                          <X className="size-4" aria-hidden /> Usar el de la temática
                        </Button>
                      )}
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
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPickerOpen(true)} aria-label="Importar productos de la biblioteca">
                        <Plus className="size-4" aria-hidden /> De la biblioteca
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={customizeCatalog} aria-label="Personalizar el catálogo">
                        <Pencil className="size-4" aria-hidden /> Personalizar catálogo
                      </Button>
                    </span>
                  </div>
                  <p className="text-base 2xl:text-xl"><b>{defaultRounds}</b> elementos de «{preset ? preset.label : 'temática libre'}». Puedes cambiarlos, añadir los tuyos y ponerles foto.</p>
                </div>
              )}
              {systemEditor ? summaryRow('Ficha del sistema', 5, (
                <>
                  <p className="font-bold">{meta.title || '—'} <span className="font-mono text-sm font-normal text-white/60">{meta.slug}</span></p>
                  <p className="text-white/70">{meta.description || 'Sin descripción'}</p>
                  <p className="text-white/70">Portada: {meta.portada ? '✔' : 'falta'} · Imagen inicial: {initialImageUrl ? '✔' : 'falta'} · Fotos: {(items ?? []).filter((i) => i.photoUrl).length}/{(items ?? []).length}</p>
                </>
              )) : null}
              <div className={`rounded-2xl border border-white/10 bg-night-900 p-4 md:col-span-2 ${systemEditor ? 'hidden' : ''}`} data-testid="save-template">
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

        {systemEditor ? (
          <LibraryImagePicker
            open={photoPick !== null}
            title="Elegir la foto del elemento"
            onClose={() => setPhotoPick(null)}
            onPick={(image) => { setItems((cur) => (cur && photoPick !== null ? cur.map((it, k) => (k === photoPick ? { ...it, photoUrl: image.url, photoFile: null, photoPath: null, credito: it.credito ?? (image.credit || null) } : it)) : cur)); setPhotoPick(null); }}
          />
        ) : null}
        <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={importFromLibrary} taken={new Set((items ?? presetCatalog(themeChoice)).map((i) => i.name.trim().toLowerCase()))} />

        {error ? <p role="alert" data-testid="wizard-error" className="rounded-xl bg-rose/20 px-4 py-3 font-semibold text-rose 2xl:text-xl">{error}</p> : null}

        {/* Barra de navegación fija abajo: siempre al alcance del pulgar o del mando */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night-950/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 2xl:max-w-5xl">
            <Button type="button" variant="secondary" size="lg" onClick={() => go(step - 1)} disabled={step === 0 || busy} className={step === 0 ? 'invisible' : ''}>
              <ArrowLeft className="size-5" aria-hidden /> Atrás
            </Button>
            {last ? (
              <Button type="submit" variant="primary" size="xl" loading={busy} className="flex-1 sm:flex-none sm:min-w-72">
                {systemEditor ? <Save className="size-6" aria-hidden /> : <Rocket className="size-6" aria-hidden />} {busyLabel ?? (systemEditor ? 'Guardar borrador' : 'Crear partida')}
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
