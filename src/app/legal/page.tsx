import { HolderBlock, LegalPage } from '@/components/legal/legal-page';
import { APP_NAME, REPO_URL } from '@/lib/legal/site';

export const metadata = { title: 'Aviso legal', description: 'Aviso legal y datos del titular de Subasta Salvaje.', robots: { index: true, follow: true } };

export default function LegalNoticePage() {
  return (
    <LegalPage title="Aviso legal" intro={`Información general sobre ${APP_NAME}, una aplicación web de subastas creativas multijugador para juegos entre amigos.`}>
      <section>
        <h2>Titular del sitio</h2>
        <HolderBlock />
        <p className="text-sm text-white/70">Estos datos los configura el propietario mediante variables de entorno. Si ves el aviso de «pendiente», aún no se han completado y no debe darse por válido ningún dato de titularidad.</p>
      </section>
      <section>
        <h2>Objeto</h2>
        <p>{APP_NAME} permite crear partidas en las que los jugadores pujan con dinero ficticio por objetos y ven evolucionar una imagen («su casa»). No se maneja dinero real ni se realizan pagos entre usuarios.</p>
      </section>
      <section>
        <h2>Uso adecuado</h2>
        <p>Quien use la aplicación se compromete a no introducir contenido ilícito, ofensivo o que vulnere derechos de terceros (nombres de jugador, nombres de objetos, fotos o textos para la IA), y a no intentar perjudicar el servicio. El anfitrión es responsable del contenido que introduce en sus partidas y de contar con permiso para usar las fotos que suba.</p>
      </section>
      <section>
        <h2>Imágenes generadas por IA</h2>
        <p>Cuando la generación por IA está activada, las imágenes pueden contener errores o resultados inesperados. El modo «pegatinas» no usa IA. La subasta no depende de que la IA funcione.</p>
      </section>
      <section>
        <h2>Propiedad intelectual</h2>
        <p>El código, el logotipo, la mascota y los demás recursos gráficos pertenecen a su propietario o a terceros que se citan en <a href="/creditos">Créditos y licencias de terceros</a>. Consulta la <a href="/licencia">página de licencia</a> para saber qué se permite hacer con el código.</p>
      </section>
      <section>
        <h2>Responsabilidad</h2>
        <p>El servicio se ofrece «tal cual», sin garantías de disponibilidad continua. Las partidas se borran automáticamente tras un periodo de inactividad (ver <a href="/privacidad">Privacidad</a>).</p>
      </section>
      <section>
        <h2>Código fuente</h2>
        <p><a href={REPO_URL} target="_blank" rel="noopener noreferrer">Repositorio del proyecto</a>.</p>
      </section>
    </LegalPage>
  );
}
