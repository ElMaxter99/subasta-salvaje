'use client';

/** Último recurso si falla el layout raíz: sin dependencias de componentes ni de fuentes. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: '#050816', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', textAlign: 'center', padding: 20 }}>
        <div role="alert">
          <h1 style={{ color: '#fbbf24' }}>¡Vaya, se ha caído el martillo!</h1>
          <p>No se ha podido cargar la aplicación. Reintenta en unos segundos.</p>
          <button type="button" onClick={reset} style={{ background: '#fbbf24', color: '#050816', border: 0, borderRadius: 12, padding: '12px 20px', fontWeight: 800, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
