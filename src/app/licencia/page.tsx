import { LegalPage } from '@/components/legal/legal-page';
import { AUTHOR_NAME, AUTHOR_URL, LICENSE_FILE_URL, LICENSE_NAME, REPO_URL } from '@/lib/legal/site';

export const metadata = { title: 'Licencia', description: 'Licencia MIT de Subasta Salvaje: código e imágenes.', robots: { index: true, follow: true } };

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
        <h2>Logotipo, mascota e imágenes</h2>
        <p>
          El logotipo, la mascota y las demás imágenes de la marca <strong>se generaron con herramientas de IA para esta aplicación</strong> y <strong>no hay ninguna marca registrada</strong>. Se publican junto al código bajo los mismos términos de la
          licencia {LICENSE_NAME}, en la medida en que existan derechos sobre ellas (el estatus legal de las obras generadas con IA varía según la jurisdicción). Autor del proyecto: <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">{AUTHOR_NAME}</a>.
        </p>
      </section>
      <section>
        <h2>Terceros</h2>
        <p>Las dependencias, tipografías (Baloo 2 y Nunito, SIL OFL 1.1) e iconos de terceros mantienen sus propias licencias, todas permisivas y compatibles con {LICENSE_NAME}: consulta <a href="/creditos">Créditos y licencias de terceros</a>.</p>
      </section>
    </LegalPage>
  );
}
