'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { adminPost } from '@/lib/client/admin-api';
import type { AppSettings } from '@/lib/services/settings';
import { providerLabel, type ProviderLabelId } from '@/lib/ai/labels';
import { Section } from './widgets';

type Key = keyof AppSettings;

const PROVIDER_ORDER_NOTE = 'El orden de la cadena lo fija IMAGE_PROVIDERS en el servidor (Vercel); aquí solo se apaga un proveedor o se le pone un tope diario.';

export function SettingsForm({ settings, defaults, aiConfigured, providers = [] }: { settings: AppSettings; defaults: { ttlHours: number; perGame: number; perDay: number }; aiConfigured: boolean; providers?: { id: ProviderLabelId; used: number }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [days, setDays] = useState(settings.game_ttl_hours ? String(Math.round((settings.game_ttl_hours / 24) * 100) / 100) : '');
  const [perGame, setPerGame] = useState(settings.quota_per_game?.toString() ?? '');
  const [perDay, setPerDay] = useState(settings.quota_per_day?.toString() ?? '');
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(providers.map((p) => [p.id, settings.ai_provider_limits?.[p.id]?.toString() ?? ''])));
  const off = settings.ai_providers_off ?? [];

  async function save(key: Key, value: unknown, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      await adminPost('settings', { key, value });
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setBusy(null);
    }
  }
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const input = 'w-28 rounded-xl border border-white/15 bg-night-900 px-3 py-2';

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}

      <Section title="Registro de anfitriones" hint="Con el registro cerrado solo entran quienes tengan una invitación (Usuarios → Invitaciones) o ya tuvieran partidas. Las cuentas ya existentes no se tocan. El cierre se aplica en la app: la pantalla de registro de Supabase seguirá existiendo, pero esas cuentas no podrán entrar.">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${settings.signups_open ? 'bg-teal/20 text-teal' : 'bg-rose/20 text-rose'}`}>{settings.signups_open ? 'Abierto' : 'Cerrado'}</span>
          <Button variant={settings.signups_open ? 'secondary' : 'primary'} loading={busy === 'signups_open'} disabled={busy !== null} onClick={() => save('signups_open', !settings.signups_open, settings.signups_open ? 'Registro cerrado' : 'Registro abierto')}>
            {settings.signups_open ? 'Cerrar registro' : 'Abrir registro'}
          </Button>
        </div>
      </Section>

      <Section title="Borrado automático de partidas" hint={`Una partida se borra sola (con sus imágenes) tras este tiempo SIN actividad. Por defecto ${defaults.ttlHours / 24} días. Vacío = usar el valor por defecto.`}>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const d = num(days); void save('game_ttl_hours', d === null ? null : Math.round(d * 24), 'Plazo de borrado actualizado'); }}>
          <label htmlFor="ttl-days" className="text-sm font-semibold">Días</label>
          <input id="ttl-days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder={String(defaults.ttlHours / 24)} className={input} />
          <Button type="submit" variant="primary" loading={busy === 'game_ttl_hours'} disabled={busy !== null}>Guardar</Button>
          <span className="text-xs text-white/55">Entre 1 hora (0,04) y 90 días.</span>
        </form>
      </Section>

      <Section title="IA" hint={aiConfigured ? 'Interruptor general y topes de generaciones reales. Los vacíos usan las variables de entorno (o 10 por partida / 50 al día).' : 'No hay proveedor de IA configurado en el servidor (IMAGE_PROVIDER): estos ajustes se guardan pero no tienen efecto hasta que lo configures.'}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${settings.ai_enabled ? 'bg-teal/20 text-teal' : 'bg-rose/20 text-rose'}`}>{settings.ai_enabled ? 'IA activada' : 'IA apagada'}</span>
          <Button variant={settings.ai_enabled ? 'danger' : 'primary'} loading={busy === 'ai_enabled'} disabled={busy !== null} onClick={() => save('ai_enabled', !settings.ai_enabled, settings.ai_enabled ? 'IA apagada para todos' : 'IA activada')}>
            {settings.ai_enabled ? 'Apagar IA para todos' : 'Activar IA'}
          </Button>
          <span className="text-xs text-white/55">Apagada: las partidas siguen con pegatinas y los trabajos de IA quedan en cola. Nunca se cambia a un proveedor de pago.</span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save('quota_per_game', num(perGame), 'Tope por partida actualizado'); }}>
            <label className="text-sm font-semibold">Por partida<input value={perGame} onChange={(e) => setPerGame(e.target.value.replace(/\D/g, ''))} placeholder={String(defaults.perGame)} className={`${input} mt-1 block`} inputMode="numeric" /></label>
            <Button type="submit" variant="secondary" loading={busy === 'quota_per_game'} disabled={busy !== null}>Guardar</Button>
          </form>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save('quota_per_day', num(perDay), 'Tope diario actualizado'); }}>
            <label className="text-sm font-semibold">Por día (global)<input value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/\D/g, ''))} placeholder={String(defaults.perDay)} className={`${input} mt-1 block`} inputMode="numeric" /></label>
            <Button type="submit" variant="secondary" loading={busy === 'quota_per_day'} disabled={busy !== null}>Guardar</Button>
          </form>
        </div>
      </Section>

      {providers.length > 0 ? (
        <Section title="Proveedores de IA (cadena)" hint={`${PROVIDER_ORDER_NOTE} Se prueban en orden; si uno falla por cuota, límite, credenciales o red se usa el siguiente y, al final, la composición sin IA. El tope diario es aproximado (el límite duro es el global).`}>
          <ul className="space-y-3" data-testid="provider-list">
            {providers.map((p, idx) => {
              const isOff = off.includes(p.id);
              const limit = settings.ai_provider_limits?.[p.id];
              return (
                <li key={p.id} className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 p-3">
                  <div className="min-w-44">
                    <p className="font-bold">{idx + 1}. {providerLabel(p.id)}</p>
                    <p className="text-xs text-white/60">Hoy: {p.used}{limit ? ` / ${limit}` : ''} usos</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-bold ${isOff ? 'bg-rose/20 text-rose' : 'bg-teal/20 text-teal'}`}>{isOff ? 'Apagado' : 'Activo'}</span>
                  <Button
                    variant={isOff ? 'primary' : 'secondary'}
                    loading={busy === `off-${p.id}`}
                    disabled={busy !== null}
                    onClick={() => save('ai_providers_off', isOff ? off.filter((x) => x !== p.id) : [...off, p.id], isOff ? `${providerLabel(p.id)} activado` : `${providerLabel(p.id)} apagado`)}
                  >
                    {isOff ? 'Activar' : 'Apagar'}
                  </Button>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = { ...(settings.ai_provider_limits ?? {}) };
                      const v = num(limits[p.id] ?? '');
                      if (v === null) delete next[p.id];
                      else next[p.id] = v;
                      void save('ai_provider_limits', next, `Tope de ${providerLabel(p.id)} actualizado`);
                    }}
                  >
                    <label className="text-sm font-semibold">
                      Tope diario
                      <input aria-label={`Tope diario de ${providerLabel(p.id)}`} value={limits[p.id] ?? ''} onChange={(e) => setLimits({ ...limits, [p.id]: e.target.value.replace(/\D/g, '') })} placeholder="sin tope" className={`${input} mt-1 block`} inputMode="numeric" />
                    </label>
                    <Button type="submit" variant="secondary" loading={busy === 'ai_provider_limits'} disabled={busy !== null}>Guardar</Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
