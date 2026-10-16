import { handle, json } from '@/lib/api';
import { getRuntimeMode, missingSupabaseVars } from '@/lib/config/env';
import { getRuntimeInfo } from '@/lib/services/context';

/** Estado de configuración (sin secretos). Útil para diagnosticar despliegues. */
export const GET = handle(async () => {
  const mode = getRuntimeMode();
  return json({ mode, missing: missingSupabaseVars(), ...(mode === 'unconfigured' ? {} : { runtime: getRuntimeInfo() }) });
});
