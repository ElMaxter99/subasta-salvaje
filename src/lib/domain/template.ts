import { z } from 'zod';
import { MAX_PLAYERS } from './limits';
import { formatEuros } from './money';
import { THEME_PRESETS } from './themes';
import type { HostSnapshot } from './types';

/**
 * Plantilla de partida: un archivo JSON que el anfitrión rellena FUERA de la app (o exporta de una partida) y sube para crear la
 * partida ya configurada. Las claves están en español y los importes en euros (más fáciles de escribir a mano).
 * Es entrada NO confiable: se valida entera con Zod y nunca se interpreta como HTML ni se ejecuta.
 */
export const TEMPLATE_FORMAT = 'subasta-salvaje/plantilla@1';
export const TEMPLATE_LIMITS = { items: 100, players: MAX_PLAYERS, fileBytes: 512 * 1024 } as const;

const text = (msg: string) => z.string({ error: msg });
const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();

const itemSchema = z.object({
  titulo: text('el título debe ser un texto').transform(clean).pipe(z.string().min(1, 'falta el título').max(80, 'el título supera los 80 caracteres')),
  descripcion: text('la descripción debe ser un texto').transform(clean).pipe(z.string().max(500, 'la descripción supera los 500 caracteres')).optional().default(''),
  emoji: text('el emoji debe ser un texto').max(8, 'el emoji es demasiado largo').nullable().optional(),
  /** URL https de la foto del elemento (se descarga al crear la partida). */
  foto: text('la foto debe ser una URL').trim().max(500, 'la URL de la foto supera los 500 caracteres').nullable().optional(),
  /** Autoría o fuente de la foto (opcional, solo informativo; p. ej. «Wikimedia Commons · CC BY-SA»). */
  credito: text('el crédito debe ser un texto').transform(clean).pipe(z.string().max(120, 'el crédito supera los 120 caracteres')).nullable().optional(),
});

export const templateSchema = z.object({
  formato: z.literal(TEMPLATE_FORMAT, { error: `«formato» debe ser exactamente "${TEMPLATE_FORMAT}"` }),
  nombre: text('el nombre debe ser un texto').transform(clean).pipe(z.string().min(1, 'falta el nombre de la partida').max(80, 'el nombre supera los 80 caracteres')),
  tematica: text('la temática debe ser un texto').transform(clean).pipe(z.string().min(1, 'falta la temática').max(120, 'la temática supera los 120 caracteres')),
  reglas: z
    .object({
      presupuesto: z.number({ error: 'el presupuesto debe ser un número en euros' }).min(0, 'el presupuesto no puede ser negativo').max(1_000_000, 'el presupuesto es demasiado alto').optional(),
      puja_minima: z.number({ error: 'la puja mínima debe ser un número en euros' }).min(0.01, 'la puja mínima debe ser al menos 0,01 €').max(1_000_000, 'la puja mínima es demasiado alta').optional(),
      rondas_maximas: z.number({ error: 'las rondas deben ser un número' }).int('las rondas deben ser un número entero').min(1, 'las rondas deben ser al menos 1').max(500, 'las rondas no pueden pasar de 500').optional(),
      pujas_enteras: z.boolean({ error: '«pujas_enteras» debe ser true o false' }).optional(),
      clasificacion: z.enum(['ninguna', 'saldo', 'elementos', 'votos'], { error: '«clasificacion» debe ser ninguna, saldo, elementos o votos' }).optional(),
      modo_juego: z.enum(['anfitrion', 'movil'], { error: '«modo_juego» debe ser anfitrion o movil' }).optional(),
      modo_imagenes: z.enum(['pegatinas', 'ia'], { error: '«modo_imagenes» debe ser pegatinas o ia' }).optional(),
    })
    .optional()
    .default({}),
  jugadores: z.array(text('cada jugador debe ser un texto').transform(clean).pipe(z.string().min(1, 'hay un nombre de jugador vacío').max(40, 'un nombre de jugador supera los 40 caracteres')), { error: '«jugadores» debe ser una lista de nombres' }).max(TEMPLATE_LIMITS.players, `como máximo ${TEMPLATE_LIMITS.players} jugadores`).optional().default([]),
  /** Solo plantillas del sistema: URL https de la portada de la tarjeta y de la imagen inicial de la casa (se copia a la partida). */
  portada: text('la portada debe ser una URL').trim().max(500, 'la URL de la portada supera los 500 caracteres').nullable().optional(),
  /** Autoría o fuente de las imágenes de la plantilla (se muestra en la tarjeta de «Partidas del sistema»). */
  creditos: text('los créditos deben ser un texto').transform(clean).pipe(z.string().max(200, 'los créditos superan los 200 caracteres')).nullable().optional(),
  casa_inicial: text('la casa inicial debe ser una URL').trim().max(500, 'la URL de la casa inicial supera los 500 caracteres').nullable().optional(),
  catalogo: z.array(itemSchema, { error: '«catalogo» debe ser una lista de elementos' }).max(TEMPLATE_LIMITS.items, `como máximo ${TEMPLATE_LIMITS.items} elementos`).optional(),
});
export type Template = z.infer<typeof templateSchema>;
export type TemplateItem = z.infer<typeof itemSchema>;

/** Campos que entiende el asistente de «Nueva partida» (valores de formulario, no céntimos). */
export interface TemplateFormValues {
  name: string;
  themeChoice: string; // id de temática predefinida o '__custom__'
  customTheme: string;
  budget: string;
  minBid: string;
  maxRounds: string;
  integerBids: boolean;
  ranking: 'none' | 'balance' | 'items' | 'votes';
  playMode: 'host' | 'mobile';
  imageMode: 'stickers' | 'ai';
  players: string[];
  /** Imagen inicial de la casa (URL https) que trae la plantilla: se copia a la partida al crearla. */
  initialImageUrl: string | null;
  /** Solo plantillas del sistema: portada de la tarjeta y créditos de las imágenes. */
  portada?: string | null;
  creditos?: string | null;
  items: { name: string; description: string; emoji: string | null; photoUrl: string | null; /** Ruta de una foto DENTRO de un ZIP (p. ej. fotos/sofa.jpg) */ photoPath: string | null; /** Solo plantillas del sistema: autoría de la foto. */ credito?: string | null }[] | null;
}

export const CUSTOM_THEME = '__custom__';
const RANKING = { ninguna: 'none', saldo: 'balance', elementos: 'items', votos: 'votes' } as const;
const RANKING_BACK = { none: 'ninguna', balance: 'saldo', items: 'elementos', votes: 'votos' } as const;
const num = (n: number) => String(n).replace('.', ',');

export type TemplateParse = { ok: true; template: Template; warnings: string[] } | { ok: false; errors: string[] };

function pathText(path: PropertyKey[]): string {
  const [a, b, c] = path;
  if (a === 'catalogo' && typeof b === 'number') return `Elemento ${b + 1} del catálogo${c ? ` (${String(c)})` : ''}`;
  if (a === 'jugadores' && typeof b === 'number') return `Jugador ${b + 1}`;
  if (a === 'reglas' && b) return `reglas.${String(b)}`;
  return a ? String(a) : 'plantilla';
}

/** Lee y valida el texto de una plantilla. Devuelve la plantilla, o una lista de errores legibles (máx. 12). */
export function parseTemplate(raw: string, opts: { zip?: boolean } = {}): TemplateParse {
  if (raw.length > TEMPLATE_LIMITS.fileBytes) return { ok: false, errors: [`El archivo es demasiado grande (máximo ${TEMPLATE_LIMITS.fileBytes / 1024} KB).`] };
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: ['El archivo no es un JSON válido (revisa comas, comillas y llaves).'] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['La plantilla debe ser un objeto JSON con «formato», «nombre» y «tematica».'] };
  const r = templateSchema.safeParse(data);
  if (!r.success) {
    const errors = r.error.issues.slice(0, 12).map((i) => {
      const where = pathText(i.path);
      // Un campo ausente sale como «Invalid input…»: se dice claro
      return i.code === 'invalid_type' && /undefined/.test(i.message) ? `${where}: falta este campo obligatorio.` : `${where}: ${i.message}`;
    });
    return { ok: false, errors };
  }
  const t = r.data;
  const warnings: string[] = [];
  const known = new Set(['formato', 'nombre', 'tematica', 'reglas', 'jugadores', 'catalogo', 'portada', 'casa_inicial', 'creditos']);
  for (const k of Object.keys(data as object)) if (!known.has(k)) warnings.push(`Se ignora el campo desconocido «${k}».`);
  const names = t.jugadores.map((n) => n.toLowerCase());
  if (new Set(names).size !== names.length) return { ok: false, errors: ['jugadores: hay nombres repetidos.'] };
  const whole = t.reglas.pujas_enteras ?? true;
  if (whole && t.reglas.puja_minima !== undefined && Math.round(t.reglas.puja_minima * 100) % 100 !== 0) {
    return { ok: false, errors: ['reglas.puja_minima: con «pujas_enteras» activadas la puja mínima debe ser un euro entero (1, 2, 3…); pon «pujas_enteras»: false para admitir céntimos.'] };
  }
  for (const [campo, url] of [['portada', t.portada], ['casa_inicial', t.casa_inicial]] as const) {
    if (url && !/^https:\/\//i.test(url)) return { ok: false, errors: [`${campo}: debe ser una URL https://.`] };
  }
  if (t.catalogo) {
    if (t.reglas.rondas_maximas && t.reglas.rondas_maximas > t.catalogo.length) warnings.push(`Las rondas máximas (${t.reglas.rondas_maximas}) superan los elementos del catálogo (${t.catalogo.length}).`);
    const titles = t.catalogo.map((i) => i.titulo.toLowerCase());
    if (new Set(titles).size !== titles.length) warnings.push('Hay elementos del catálogo con el mismo título.');
    t.catalogo.forEach((it, i) => {
      if (it.foto && !/^https:\/\//i.test(it.foto) && !(opts.zip && isLocalPhotoPath(it.foto))) {
        warnings.push(`Elemento ${i + 1} («${it.titulo}»): la foto debe ser una URL https://${opts.zip ? ' o una ruta dentro del ZIP (fotos/archivo.jpg)' : ' (las rutas de archivo solo funcionan dentro de un ZIP)'}; se ignorará.`);
      }
    });
  }
  return { ok: true, template: t, warnings };
}

/** Ruta relativa segura dentro de un ZIP: sin esquema, sin «..» ni rutas absolutas. */
export function isLocalPhotoPath(s: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('/') && !s.startsWith('\\') && !s.split(/[\\/]/).includes('..') && /\.(png|jpe?g|webp)$/i.test(s);
}

/** Valores que carga el asistente a partir de una plantilla ya validada. */
export function templateToForm(t: Template): TemplateFormValues {
  const key = t.tematica.toLowerCase();
  const preset = THEME_PRESETS.find((p) => p.id === key || p.label.toLowerCase() === key);
  return {
    name: t.nombre,
    themeChoice: preset ? preset.id : CUSTOM_THEME,
    customTheme: preset ? '' : t.tematica,
    budget: t.reglas.presupuesto !== undefined ? num(t.reglas.presupuesto) : '20',
    minBid: t.reglas.puja_minima !== undefined ? num(t.reglas.puja_minima) : '1',
    maxRounds: t.reglas.rondas_maximas ? String(t.reglas.rondas_maximas) : '',
    integerBids: t.reglas.pujas_enteras ?? true,
    ranking: RANKING[t.reglas.clasificacion ?? 'ninguna'],
    playMode: t.reglas.modo_juego === 'movil' ? 'mobile' : 'host',
    imageMode: t.reglas.modo_imagenes === 'ia' ? 'ai' : 'stickers',
    players: t.jugadores,
    initialImageUrl: t.casa_inicial && /^https:\/\//i.test(t.casa_inicial) ? t.casa_inicial : null,
    portada: t.portada ?? null,
    creditos: t.creditos ?? null,
    items: t.catalogo ? t.catalogo.map((i) => ({ name: i.titulo, description: i.descripcion, emoji: i.emoji ?? null, photoUrl: i.foto && /^https:\/\//i.test(i.foto) ? i.foto : null, credito: i.credito ?? null, photoPath: i.foto && isLocalPhotoPath(i.foto) ? i.foto.replace(/\\/g, '/') : null })) : null,
  };
}

/** Plantilla a partir de los valores del asistente (para «Guardar como plantilla»). Las fotos incrustadas en un ZIP no se guardan (solo URLs). */
export function formToTemplate(v: { name: string; themeValue: string; budget: string; minBid: string; maxRounds: number; integerBids: boolean; ranking: TemplateFormValues['ranking']; playMode: TemplateFormValues['playMode']; imageMode: TemplateFormValues['imageMode']; players: string[]; items: { name: string; description: string; emoji: string | null; photoUrl: string | null; credito?: string | null }[] | null }): Template {
  const euros = (s: string, d: number) => {
    const n = Number(s.trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const preset = THEME_PRESETS.find((p) => p.id === v.themeValue);
  return {
    formato: TEMPLATE_FORMAT,
    nombre: v.name.trim() || 'Mi partida',
    tematica: preset ? preset.label : v.themeValue || 'Casa',
    reglas: { presupuesto: euros(v.budget, 20), puja_minima: Math.max(euros(v.minBid, 1), 0.01), rondas_maximas: v.maxRounds, pujas_enteras: v.integerBids, clasificacion: RANKING_BACK[v.ranking], modo_juego: v.playMode === 'mobile' ? 'movil' : 'anfitrion', modo_imagenes: v.imageMode === 'ai' ? 'ia' : 'pegatinas' },
    jugadores: v.players,
    catalogo: v.items ? v.items.map((i) => ({ titulo: i.name, descripcion: i.description, emoji: i.emoji, foto: i.photoUrl, ...(i.credito ? { credito: i.credito } : {}) })) : undefined,
  };
}

/** Plantilla vacía con ejemplos para que el anfitrión la edite a mano. */
export function blankTemplate(): Template {
  return {
    formato: TEMPLATE_FORMAT,
    nombre: 'Noche de Subasta Salvaje',
    tematica: 'Casa',
    reglas: { presupuesto: 20, puja_minima: 1, rondas_maximas: 3, pujas_enteras: true, clasificacion: 'ninguna', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
    jugadores: ['Ana', 'Beto'],
    catalogo: [
      { titulo: 'Piscina infinita', descripcion: 'Piscina de borde infinito con agua turquesa.', emoji: '🏊', foto: null },
      { titulo: 'Sofá gigante', descripcion: 'Un sofá enorme y mullido.', emoji: '🛋️', foto: 'https://ejemplo.com/fotos/sofa.jpg' },
      { titulo: 'Chimenea de piedra', descripcion: 'Con el fuego encendido.', emoji: '🔥', foto: null },
    ],
  };
}

/** Plantilla a partir de una partida existente (las fotos no se exportan: sus URLs son temporales). */
export function templateFromSnapshot(s: Pick<HostSnapshot, 'game' | 'players' | 'items'>): Template {
  return {
    formato: TEMPLATE_FORMAT,
    nombre: s.game.name,
    tematica: s.game.theme,
    reglas: {
      presupuesto: s.game.initial_budget_cents / 100,
      puja_minima: s.game.min_bid_cents / 100,
      rondas_maximas: s.game.total_rounds || undefined,
      pujas_enteras: s.game.integer_bids ?? true,
      clasificacion: RANKING_BACK[s.game.ranking_rule],
      modo_juego: s.game.play_mode === 'mobile' ? 'movil' : 'anfitrion',
      modo_imagenes: s.game.image_mode === 'ai' ? 'ia' : 'pegatinas',
    },
    jugadores: s.players.map((p) => p.name),
    catalogo: s.items.map((i) => ({ titulo: i.name, descripcion: i.description, emoji: i.emoji, foto: null })),
  };
}

/** Texto resumido para mostrar en la interfaz. */
export function templateSummary(t: Template): string {
  const r = t.reglas;
  return `${t.catalogo?.length ?? 0} elementos · ${t.jugadores.length} jugadores${r.presupuesto !== undefined ? ` · ${formatEuros(Math.round(r.presupuesto * 100))} cada uno` : ''}`;
}
