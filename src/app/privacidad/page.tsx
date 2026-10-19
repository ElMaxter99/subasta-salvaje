import { HolderBlock, LegalPage } from '@/components/legal/legal-page';
import { SERVICE_PROVIDERS } from '@/lib/legal/site';

export const metadata = { title: 'Política de privacidad', description: 'Qué datos trata Subasta Salvaje, para qué, con quién se comparten y cuáles son tus derechos.', robots: { index: true, follow: true } };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidad" intro="Describimos solo lo que la aplicación hace de verdad con tus datos.">
      <section>
        <h2>Responsable</h2>
        <HolderBlock />
      </section>
      <section>
        <h2>Qué datos tratamos y para qué</h2>
        <ul>
          <li><strong>Cuenta de anfitrión:</strong> correo electrónico y contraseña (gestionados por Supabase Auth; la contraseña no la vemos en claro). Sirve para iniciar sesión y recuperar tus partidas. Si el propietario configura el envío de correo, tu dirección se comunica a Resend únicamente para enviarte los correos de la cuenta (confirmación, recuperación de contraseña, invitaciones). En modo demo no hay cuentas.</li>
          <li><strong>Partidas:</strong> nombre, ajustes, catálogo de objetos (nombres, descripciones, fotos que subas) y resultados.</li>
          <li><strong>Jugadores:</strong> solo un alias o nombre que elige el anfitrión o el propio jugador. No hay cuenta ni correo de jugador. En el modo «móviles» se guarda en el dispositivo una cookie técnica con un token para reconocerlo (ver <a href="/cookies">Cookies</a>).</li>
          <li><strong>Pujas y compras:</strong> importes ficticios, quién pujó y qué se adjudicó.</li>
          <li><strong>Imágenes:</strong> la imagen de cada jugador (a partir de la imagen base) y sus versiones sucesivas, generadas por IA o por pegatinas.</li>
          <li><strong>Estadísticas de visitas:</strong> la aplicación usa Vercel Web Analytics para contar visitas a páginas. Según Vercel, funciona sin cookies ni almacenamiento en tu dispositivo y no identifica a las personas; registra la página visitada, de dónde vienes, país, dispositivo y navegador. Antes de enviar nada, la aplicación quita de la dirección el código de la partida y todo lo que sigue a «?», no mide el panel de administración y respeta «No rastrear» y «Global Privacy Control» de tu navegador.</li>
          <li><strong>Errores técnicos y uso agregado:</strong> para detectar fallos, la aplicación guarda en su propia base de datos (sin servicios de terceros) los errores inesperados del servidor y del navegador —fecha, ruta sin identificadores, código, mensaje y traza técnica ya depurados de contraseñas, claves, correos y direcciones IP— y contadores diarios agregados (partidas, pujas, peticiones por tipo de ruta). No se guardan cuerpos de petición, cookies, tokens ni direcciones IP, y no hay cookies ni almacenamiento nuevos en tu dispositivo. Solo los ve el superadmin y los errores se borran a los 30 días (configurable).</li>
          <li><strong>Registros técnicos:</strong> la plataforma de alojamiento puede registrar direcciones IP y peticiones por seguridad y para limitar abusos (límites de uso por IP). Los registros de la aplicación se depuran de secretos.</li>
        </ul>
        <p>La base jurídica es la ejecución del servicio que solicitas y el interés legítimo en mantenerlo seguro. No se toman decisiones automatizadas con efectos jurídicos sobre las personas.</p>
      </section>
      <section>
        <h2>Datos enviados a proveedores de IA</h2>
        <p>Solo si el propietario ha configurado un proveedor de imágenes real (Cloudflare Workers AI, Pollinations, AI Horde, Hugging Face u OpenAI), se envían a ese proveedor los textos (prompts construidos con el nombre del objeto comprado y el tema de la partida) y las imágenes necesarias (la imagen actual del jugador y, si el anfitrión la subió, la foto del objeto) para generar o editar la imagen. No envíes fotos de personas ni datos personales en los textos. Sin proveedor configurado, o en modo «pegatinas», no se envía nada fuera.</p>
      </section>
      <section>
        <h2>Encargados y servicios de terceros</h2>
        <ul>
          {SERVICE_PROVIDERS.map((p) => (
            <li key={p.name}><strong>{p.name}:</strong> {p.role} <a href={p.url} target="_blank" rel="noopener noreferrer">Su política de privacidad</a>.</li>
          ))}
        </ul>
        <p>Estos proveedores pueden tratar datos fuera de la Unión Europea según su propia configuración; consulta sus políticas.</p>
      </section>
      <section>
        <h2>Lo que NO hacemos</h2>
        <p>No usamos publicidad, seguimiento entre sitios ni píxeles de terceros, no vendemos datos y no cargamos fuentes ni scripts desde servidores de terceros (las tipografías y el script de estadísticas se sirven desde la propia aplicación). La única excepción son las imágenes de portada de las «Partidas del sistema», que, si el propietario las aloja en un CDN externo, se cargan desde allí. Las únicas estadísticas son las de visitas descritas arriba. Comprobado en el código en la fecha de la última actualización; si esto cambia, esta política se actualizará.</p>
      </section>
      <section>
        <h2>Conservación y borrado</h2>
        <ul>
          <li>Las partidas inactivas se <strong>borran automáticamente</strong> pasado un plazo configurable (7 días por defecto), junto con sus jugadores, pujas e imágenes.</li>
          <li>El anfitrión puede borrar sus partidas manualmente.</li>
          <li>El superadmin de la aplicación puede <strong>borrar una cuenta</strong> de anfitrión junto con todas sus partidas, y bloquearla en caso de abuso.</li>
          <li>Las copias de seguridad de los proveedores pueden conservar datos un tiempo adicional según sus políticas.</li>
        </ul>
      </section>
      <section>
        <h2>Tus derechos</h2>
        <p>Puedes solicitar acceso, rectificación, supresión, limitación, oposición y portabilidad de tus datos, y presentar una reclamación ante la autoridad de control (en España, la Agencia Española de Protección de Datos). Escribe a los datos de contacto del responsable indicados arriba; si aún figura «pendiente», el propietario debe completarlos.</p>
      </section>
      <section>
        <h2>Menores</h2>
        <p>La aplicación no está dirigida a menores de 14 años como usuarios con cuenta. Los anfitriones tienen cuenta y deben ser mayores de edad o contar con autorización de sus tutores; los jugadores solo usan un alias, y el anfitrión debe evitar introducir datos personales de menores (apellidos, fotos).</p>
      </section>
    </LegalPage>
  );
}
