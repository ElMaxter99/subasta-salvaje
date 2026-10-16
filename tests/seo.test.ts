import { describe, expect, it } from 'vitest';
import { gameLinkText, siteUrl } from '@/lib/seo/site';

const game = { code: 'ABC123', name: 'Noche de Subasta', status: 'active' as const, players: ['Ana', 'Beto'], winner: null };

describe('Open Graph: textos y dominio', () => {
  it('el enlace de invitación muestra el código de sala', () => {
    const t = gameLinkText('invite', game);
    expect(t.title).toContain('Noche de Subasta');
    expect(t.description).toContain('ABC123');
  });
  it('TV y resultados', () => {
    expect(gameLinkText('tv', game).title).toBe('Pantalla de TV · Noche de Subasta');
    expect(gameLinkText('results', { ...game, winner: 'Ana' }).title).toContain('gana Ana');
    expect(gameLinkText('results', game).title).not.toContain('gana');
  });
  it('sin partida usa el texto genérico de la marca', () => {
    expect(gameLinkText('invite', null).title).toBe('Subasta Salvaje');
  });
  it('siteUrl: variable pública → producción de Vercel → localhost; valores raros no rompen', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://subasta.example.com/' } as unknown as NodeJS.ProcessEnv).origin).toBe('https://subasta.example.com');
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'app.vercel.app' } as unknown as NodeJS.ProcessEnv).origin).toBe('https://app.vercel.app');
    expect(siteUrl({} as NodeJS.ProcessEnv).origin).toBe('http://localhost:3000');
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'http://[' } as unknown as NodeJS.ProcessEnv).origin).toBe('http://localhost:3000');
  });
});
