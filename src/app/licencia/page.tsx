import { LegalPage } from '@/components/legal/legal-page';
import { LICENSE_FILE_URL, LICENSE_NAME, REPO_URL } from '@/lib/legal/site';

export const metadata = { title: 'Licencia', description: 'Licencia del código de Subasta Salvaje (MIT) y alcance de la marca.', robots: { index: true, follow: true } };

export default function LicensePage() {
  return (
    <LegalPage title="Licencia">
      <section>
        <h2>El código es libre: licencia {LICENSE_NAME}</h2>
        <p>
          El código fuente de Subasta Salvaje se distribuye bajo la <strong>licencia {LICENSE_NAME}</strong>. En palabras sencillas: puedes <strong>usarlo, copiarlo, modificarlo, publicarlo y
          redistribuirlo gratis, incluso en proyectos comerciales</strong>, siempre que conserves el aviso de copyright y el texto de la licencia. El software se ofrece «tal cual», sin garantía de ningún tipo.
        </p>
        <p>
          Texto completo: <a href={LICENSE_FILE_URL} target="_blank" rel="noopener noreferrer">archivo LICENSE del repositorio</a> · Repositorio:{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</a>
        </p>
      </section>
      <section>
        <h2>Qué NO cubre la licencia</h2>
        <p role="status" className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
          La licencia {LICENSE_NAME} cubre el <strong>código</strong>. <strong>El nombre «Subasta Salvaje», el logotipo y la mascota</strong> (imágenes de <code>public/assets/brand/</code>, <code>public/assets/mascot/</code> y
          el paquete <code>subasta-salvaje-assets/</code>) son la marca del proyecto y <strong>sus derechos quedan reservados por el propietario</strong>: si redistribuyes o publicas tu propia versión, sustituye la marca por la tuya.
        </p>
      </section>
      <section>
        <h2>Terceros</h2>
        <p>Las dependencias, tipografías (Baloo 2 y Nunito, SIL OFL 1.1) e iconos de terceros mantienen sus propias licencias, todas permisivas y compatibles con {LICENSE_NAME}: consulta <a href="/creditos">Créditos y licencias de terceros</a>.</p>
      </section>
    </LegalPage>
  );
}
