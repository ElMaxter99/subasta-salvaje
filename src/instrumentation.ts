/**
 * Next llama a `onRequestError` con los errores de renderizado de servidor y de rutas que no pasaron por `handle()`.
 * Se guardan agrupados en app_errors (sin cabeceras ni cuerpos: solo ruta normalizada, método y mensaje saneado).
 */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routerKind?: string; routeType?: string }): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { recordError } = await import('@/lib/observability/record');
    const { roomFromPath } = await import('@/lib/observability/sanitize');
    const e = err as { message?: unknown; stack?: unknown; digest?: unknown; name?: unknown; code?: unknown; status?: unknown };
    // Errores de dominio esperados (404 del panel para no superadmins, 400/409…): no son averías.
    if (e.name === 'DomainError' && typeof e.status === 'number' && e.status < 500) return;
    await recordError({
      source: request.path.startsWith('/api/jobs/') ? 'cron' : 'server',
      route: request.path,
      code: 'internal',
      message: `${typeof e.name === 'string' ? e.name : 'Error'}: ${typeof e.message === 'string' ? e.message : 'error'} (${context.routeType ?? 'render'}, ${request.method})`,
      stack: `${typeof e.digest === 'string' ? `digest ${e.digest}\n` : ''}${typeof e.stack === 'string' ? e.stack : ''}`,
      room_code: roomFromPath(request.path),
    });
  } catch {
    /* la observabilidad nunca rompe nada */
  }
}
