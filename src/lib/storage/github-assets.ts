import { redactSecrets } from '@/lib/security/redact';

/**
 * Alojamiento externo de las fotos de las plantillas del sistema: un repositorio PÚBLICO de GitHub servido por jsDelivr.
 * Se escribe con la API de contenidos de GitHub (PUT /repos/{repo}/contents/{ruta}) usando un token de acceso con permiso
 * SOLO sobre ese repositorio. El enlace devuelto va fijado al commit (`@sha`): se sirve al instante y nunca cambia
 * (las ramas se cachean horas en jsDelivr y una foto nueva podría tardar en aparecer).
 * Sin probar contra GitHub real desde este entorno: se prueba con `fetch` simulado.
 */
export interface GithubAssetsConfig {
  repo: string; // «usuario/repositorio»
  token: string;
  branch: string;
}

export class AssetUploadError extends Error {
  constructor(message: string, readonly kind: 'config' | 'auth' | 'not_found' | 'conflict' | 'rate' | 'network' | 'other') {
    super(message);
    this.name = 'AssetUploadError';
  }
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PATH_RE = /^[a-z0-9][a-z0-9._/-]{0,200}$/;

export interface UploadedAsset {
  path: string;
  /** Enlace público fijado al commit. */
  url: string;
  sha: string;
  /** true si el archivo ya existía (mismo contenido): no se vuelve a subir. */
  existed: boolean;
}

export interface GithubAssets {
  put(path: string, bytes: Uint8Array, message: string): Promise<UploadedAsset>;
}

/** Subida por lotes (biblioteca): TODO el lote entra en UN solo commit. */
export interface GithubBatchAssets {
  /** Prepara el contenido (blob de Git, sin crear commit)… */
  stageBlob(bytes: Uint8Array): Promise<string>;
  /** …y publica TODOS los archivos preparados en UN solo commit (API de datos de Git). */
  commitMany(files: { path: string; blobSha: string }[], message: string): Promise<{ sha: string; files: UploadedAsset[] }>;
}

export function createGithubAssets(cfg: GithubAssetsConfig, fetchImpl: typeof fetch = fetch, apiBase = 'https://api.github.com'): GithubAssets & GithubBatchAssets {
  if (!REPO_RE.test(cfg.repo)) throw new AssetUploadError('GITHUB_ASSETS_REPO debe ser «usuario/repositorio».', 'config');
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'subasta-salvaje' };
  const contents = (p: string) => `${apiBase}/repos/${cfg.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new AssetUploadError(`No se pudo contactar con GitHub: ${redactSecrets((e as Error).message)}`, 'network');
    }
  }
  const fail = async (res: Response): Promise<never> => {
    const detail = redactSecrets((await res.text().catch(() => '')).slice(0, 200));
    if (res.status === 401 || res.status === 403) throw new AssetUploadError(`GitHub rechazó el token (${res.status}). Revisa GITHUB_ASSETS_TOKEN: debe tener permiso de escritura de contenidos sobre ${cfg.repo}. ${detail}`, res.status === 403 && /rate|abuse/i.test(detail) ? 'rate' : 'auth');
    if (res.status === 404) throw new AssetUploadError(`GitHub no encuentra el repositorio ${cfg.repo} (o el token no lo ve).`, 'not_found');
    if (res.status === 409) throw new AssetUploadError('GitHub detectó una subida simultánea; inténtalo de nuevo.', 'conflict');
    if (res.status === 429) throw new AssetUploadError('GitHub limita el ritmo de subidas; espera un minuto.', 'rate');
    throw new AssetUploadError(`GitHub respondió ${res.status}: ${detail}`, 'other');
  };
  const urlFor = (sha: string, path: string) => `https://cdn.jsdelivr.net/gh/${cfg.repo}@${sha}/${path}`;

  async function headSha(): Promise<string> {
    const res = await call(`${apiBase}/repos/${cfg.repo}/commits/${encodeURIComponent(cfg.branch)}`);
    if (!res.ok) return fail(res);
    const j = (await res.json().catch(() => null)) as { sha?: string } | null;
    if (!j?.sha) throw new AssetUploadError('GitHub no devolvió el commit de la rama.', 'other');
    return j.sha;
  }

  const gitUrl = (p: string) => `${apiBase}/repos/${cfg.repo}/git/${p}`;
  const json = async <T>(res: Response): Promise<T> => {
    if (!res.ok) return fail(res);
    return (await res.json().catch(() => ({}))) as T;
  };
  const checkPath = (path: string) => {
    if (!PATH_RE.test(path) || path.includes('..') || path.includes('//')) throw new AssetUploadError('Ruta de archivo no válida.', 'config');
  };

  return {
    async stageBlob(bytes) {
      const j = await json<{ sha?: string }>(await call(gitUrl('blobs'), { method: 'POST', body: JSON.stringify({ content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }) }));
      if (!j.sha) throw new AssetUploadError('GitHub no devolvió el identificador del archivo preparado.', 'other');
      return j.sha;
    },

    async commitMany(files, message) {
      if (files.length === 0) throw new AssetUploadError('No hay archivos que publicar.', 'config');
      for (const f of files) checkPath(f.path);
      for (let attempt = 0; ; attempt++) {
        const head = await headSha();
        const parent = await json<{ tree?: { sha?: string } }>(await call(gitUrl(`commits/${head}`)));
        if (!parent.tree?.sha) throw new AssetUploadError('GitHub no devolvió el árbol de la rama.', 'other');
        const tree = await json<{ sha?: string }>(await call(gitUrl('trees'), { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.blobSha })) }) }));
        if (!tree.sha) throw new AssetUploadError('GitHub no devolvió el árbol nuevo.', 'other');
        const commit = await json<{ sha?: string }>(await call(gitUrl('commits'), { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) }));
        if (!commit.sha) throw new AssetUploadError('GitHub no devolvió el commit creado.', 'other');
        const ref = await call(gitUrl(`refs/heads/${cfg.branch.split('/').map(encodeURIComponent).join('/')}`), { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
        if (ref.status === 422 && attempt < 2) continue; // la rama se movió mientras tanto: se rehace sobre la nueva cabeza
        if (!ref.ok) return fail(ref);
        const sha = commit.sha;
        return { sha, files: files.map((f) => ({ path: f.path, url: urlFor(sha, f.path), sha, existed: false })) };
      }
    },

    async put(path, bytes, message) {
      checkPath(path);
      // ¿Ya está? (mismo contenido = misma ruta, porque el nombre lleva el hash): no se duplica.
      const existing = await call(`${contents(path)}?ref=${encodeURIComponent(cfg.branch)}`);
      if (existing.ok) {
        const sha = await headSha();
        return { path, url: urlFor(sha, path), sha, existed: true };
      }
      if (existing.status !== 404) return fail(existing);
      for (let attempt = 0; ; attempt++) {
        const res = await call(contents(path), { method: 'PUT', body: JSON.stringify({ message, content: Buffer.from(bytes).toString('base64'), branch: cfg.branch }) });
        if (res.status === 409 && attempt < 2) continue; // otra subida acaba de mover la rama: se reintenta
        if (!res.ok) return fail(res);
        const j = (await res.json().catch(() => null)) as { commit?: { sha?: string } } | null;
        const sha = j?.commit?.sha;
        if (!sha) throw new AssetUploadError('GitHub no devolvió el commit creado.', 'other');
        return { path, url: urlFor(sha, path), sha, existed: false };
      }
    },
  };
}
