import { MascotTitle } from '@/components/mascot/mascot';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { SUPABASE_REQUIRED_VARS, getRuntimeMode, missingSupabaseVars, openAiKey } from '@/lib/config/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuración', robots: { index: false, follow: false } };

export default function SetupPage() {
  const mode = getRuntimeMode();
  const missing = missingSupabaseVars();
  const optional = [
    { name: 'OPENAI_API_KEY', ok: Boolean(openAiKey()), note: 'Generación y edición real de imágenes con IA. Sin ella los trabajos quedan en cola.' },
    { name: 'CRON_SECRET', ok: Boolean(process.env.CRON_SECRET), note: 'Protege /api/jobs/process (worker por cron).' },
  ];
  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 px-5 py-10">
      <Logo size="lg" />
      <MascotTitle variant="expr-pensativo" titleClassName="font-display text-3xl">Configuración necesaria</MascotTitle>
      <p className="text-white/75">
        {mode === 'unconfigured'
          ? 'Faltan variables de entorno de Supabase. En producción la app no arranca con datos de muestra.'
          : mode === 'demo'
            ? 'Estás en modo demo (datos locales). Para el modo real configura Supabase.'
            : 'Supabase está configurado.'}
      </p>
      <ul className="space-y-2">
        {SUPABASE_REQUIRED_VARS.map((v) => (
          <li key={v} className="flex items-center gap-3 rounded-xl bg-night-800 px-4 py-3">
            {missing.includes(v) ? <AlertTriangle className="size-5 shrink-0 text-gold" aria-hidden /> : <CheckCircle2 className="size-5 shrink-0 text-teal" aria-hidden />}
            <code className="font-bold">{v}</code>
            <span className="ml-auto text-sm text-white/60">{missing.includes(v) ? 'falta' : 'configurada'}</span>
          </li>
        ))}
        {optional.map((o) => (
          <li key={o.name} className="rounded-xl bg-night-800/60 px-4 py-3">
            <div className="flex items-center gap-3">
              {o.ok ? <CheckCircle2 className="size-5 shrink-0 text-teal" aria-hidden /> : <AlertTriangle className="size-5 shrink-0 text-white/55" aria-hidden />}
              <code className="font-bold">{o.name}</code>
              <span className="ml-auto text-sm text-white/60">{o.ok ? 'configurada' : 'opcional · no configurada'}</span>
            </div>
            <p className="mt-1 pl-8 text-sm text-white/60">{o.note}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-white/70">
        Consulta el <code>README.md</code> para crear el proyecto de Supabase, aplicar las migraciones de <code>supabase/migrations</code> y definir las variables en Vercel (Settings → Environment Variables). Después vuelve a desplegar.
      </p>
      {mode !== 'unconfigured' ? (
        <Link href="/" className="inline-block rounded-xl bg-gold px-5 py-3 font-bold text-night-950">
          Ir al inicio
        </Link>
      ) : null}
    </main>
  );
}
