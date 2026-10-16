import { LegalPage } from '@/components/legal/legal-page';
import { LICENSE_DECLARED, LICENSE_NAME, REPO_URL } from '@/lib/legal/site';

export const metadata = { title: 'Licencia', description: 'Licencia del código de Subasta Salvaje.', robots: { index: true, follow: true } };

export default function LicensePage() {
  return (
    <LegalPage title="Licencia">
      <section>
        <h2>Licencia del código: {LICENSE_NAME}</h2>
        {LICENSE_DECLARED ? (
          <p>El proyecto se distribuye bajo la licencia {LICENSE_NAME}. Consulta el repositorio para el texto completo.</p>
        ) : (
          <>
            <p role="status" className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">Este proyecto <strong>no declara por ahora ninguna licencia de código abierto</strong>: no hay archivo LICENSE ni campo de licencia. Por defecto, <strong>todos los derechos quedan reservados</strong> por su titular.</p>
            <p>En la práctica significa que, aunque el código sea visible en el repositorio, no se concede permiso para copiarlo, modificarlo, redistribuirlo ni usarlo en otros proyectos sin autorización expresa del titular.</p>
          </>
        )}
      </section>
      <section>
        <h2>Terceros</h2>
        <p>Las dependencias, tipografías e iconos de terceros mantienen sus propias licencias: consulta <a href="/creditos">Créditos y licencias de terceros</a>. El logotipo, la mascota y los recursos gráficos pertenecen a su propietario.</p>
      </section>
      <section>
        <h2>Repositorio</h2>
        <p><a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</a></p>
      </section>
    </LegalPage>
  );
}
