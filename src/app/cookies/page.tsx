import { LegalPage } from '@/components/legal/legal-page';
import { STORAGE_INVENTORY } from '@/lib/legal/site';

export const metadata = { title: 'Política de cookies', description: 'Cookies y almacenamiento local que usa Subasta Salvaje.', robots: { index: true, follow: true } };

export default function CookiesPage() {
  return (
    <LegalPage title="Política de cookies y almacenamiento local" intro="Inventario real de lo que la aplicación guarda en tu navegador.">
      <section>
        <h2>Resumen</h2>
        <p>Todo lo que se guarda es <strong>técnico y necesario</strong> para que la aplicación funcione (sesión, identidad del jugador en una sala) o para recordar una preferencia que tú ajustas (sonido). Todo es <strong>propio</strong>: no hay cookies de terceros ni publicidad. Las estadísticas de visitas (Vercel Web Analytics) no usan cookies ni almacenamiento local; se describen en la <a href="/privacidad">política de privacidad</a>.</p>
      </section>
      <section>
        <h2>Inventario</h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm" data-testid="storage-table">
            <caption className="sr-only">Cookies y almacenamiento local</caption>
            <thead className="bg-night-800 text-white">
              <tr>
                <th scope="col" className="p-3">Nombre</th>
                <th scope="col" className="p-3">Tipo de almacenamiento</th>
                <th scope="col" className="p-3">Finalidad</th>
                <th scope="col" className="p-3">Duración</th>
                <th scope="col" className="p-3">Categoría</th>
                <th scope="col" className="p-3">Origen</th>
              </tr>
            </thead>
            <tbody>
              {STORAGE_INVENTORY.map((s) => (
                <tr key={s.key} className="border-t border-white/10">
                  <th scope="row" className="p-3 font-mono text-xs font-bold text-gold-soft">{s.name}</th>
                  <td className="p-3">{s.kind}</td>
                  <td className="p-3">{s.purpose} <span className="text-white/60">({s.scope})</span></td>
                  <td className="p-3">{s.duration}</td>
                  <td className="p-3">Técnica / necesaria</td>
                  <td className="p-3">{s.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-white/70">La cookie de jugador es <code>HttpOnly</code> y <code>SameSite=Lax</code> (y <code>Secure</code> en producción).</p>
      </section>
      <section>
        <h2>¿Hace falta banner de consentimiento?</h2>
        <p>Con el inventario anterior, según nuestra interpretación prudente de la normativa (LSSI-CE y guía de la AEPD), las cookies estrictamente necesarias para prestar el servicio solicitado o para comunicar entre el dispositivo y la red quedan exoneradas del consentimiento, y las preferencias que tú mismo ajustas (sonido) son una función que has pedido. Por eso <strong>no se muestra banner</strong>. Esta conclusión debe validarla un profesional.</p>
        <p>Si en el futuro se añade publicidad, analítica con cookies o cualquier cookie no técnica, habrá que: (1) añadirla a este inventario, (2) no cargarla hasta recibir consentimiento previo, (3) ofrecer un banner con «Aceptar» y «Rechazar» al mismo nivel y un modo de cambiar la decisión, y (4) actualizar la <a href="/privacidad">política de privacidad</a>.</p>
      </section>
      <section>
        <h2>Cómo borrarlas</h2>
        <p>Desde los ajustes de tu navegador puedes borrar cookies y datos del sitio. Cerrar sesión elimina la sesión del anfitrión; «salir» de una sala elimina la cookie del jugador. Si las borras, tendrás que volver a iniciar sesión o a unirte a la sala.</p>
      </section>
    </LegalPage>
  );
}
