import { LegalPage } from '@/components/legal/legal-page';
import credits from '@/lib/legal/credits.generated.json';
import { EXTRA_CREDITS, PROJECT_ASSET_NOTES, SERVICE_PROVIDERS } from '@/lib/legal/site';

export const metadata = { title: 'Créditos y licencias de terceros', description: 'Software, tipografías e iconos de terceros que usa Subasta Salvaje y sus licencias.', robots: { index: true, follow: true } };

type Dep = { name: string; version: string; license: string; homepage: string };

function DepTable({ deps, label }: { deps: Dep[]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-night-800 text-white">
          <tr><th scope="col" className="p-3">Paquete</th><th scope="col" className="p-3">Versión</th><th scope="col" className="p-3">Licencia</th></tr>
        </thead>
        <tbody>
          {deps.map((d) => (
            <tr key={d.name} className="border-t border-white/10">
              <th scope="row" className="p-3 font-bold"><a href={d.homepage} target="_blank" rel="noopener noreferrer">{d.name}</a></th>
              <td className="p-3">{d.version}</td>
              <td className="p-3">{d.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <LegalPage title="Créditos y licencias de terceros" intro="Subasta Salvaje se apoya en software libre y en servicios de terceros. Gracias a sus autores.">
      <section>
        <h2>Dependencias de ejecución</h2>
        <p>Dependencias directas del proyecto (la lista se genera con <code>node scripts/legal/build-credits.mjs</code>; las transitivas conservan sus propias licencias).</p>
        <DepTable deps={credits.dependencies} label="Dependencias de ejecución" />
      </section>
      <section>
        <details className="rounded-2xl border border-white/10 p-4">
          <summary className="cursor-pointer font-bold">Dependencias de desarrollo ({credits.devDependencies.length})</summary>
          <p className="my-2 text-sm text-white/70">Se usan para construir y probar la aplicación; no se distribuyen en el producto final.</p>
          <DepTable deps={credits.devDependencies} label="Dependencias de desarrollo" />
        </details>
      </section>
      <section>
        <h2>Tipografías e iconos</h2>
        <ul>
          {EXTRA_CREDITS.map((c) => (
            <li key={c.name}><strong>{c.name}</strong> · {c.license}{c.url ? <> · <a href={c.url} target="_blank" rel="noopener noreferrer">licencia</a></> : null}. {c.note}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Recursos gráficos del proyecto</h2>
        <ul>{PROJECT_ASSET_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
      <section>
        <h2>Servicios de terceros (no son código incluido)</h2>
        <ul>
          {SERVICE_PROVIDERS.map((p) => <li key={p.name}><strong>{p.name}:</strong> {p.role}</li>)}
        </ul>
        <p>Cada servicio se rige por sus propios términos y no forma parte de la licencia de este proyecto.</p>
      </section>
    </LegalPage>
  );
}
