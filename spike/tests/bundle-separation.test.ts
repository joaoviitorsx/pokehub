import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const walk = (dir: string): string[] => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
describe('o app do celular não entra no renderer do desktop', () => {
  it('nenhum arquivo de spike/src importa remote-ui nem o servidor', () => {
    for (const file of walk('spike/src').filter(f => /\.tsx?$/.test(f))) expect(readFileSync(file, 'utf8'), file).not.toMatch(/remote-ui|\.\.\/remote\/(server|hub|certs|store|guards)/);
  });
  it('o app do celular só importa do desktop a arte da pokébola', () => {
    for (const file of walk('spike/remote-ui').filter(f => /\.tsx?$/.test(f))) for (const m of readFileSync(file, 'utf8').matchAll(/from '(\.\.\/src\/[^']+)'/g)) expect(m[1], file).toBe('../src/icons');
  });
  it.skipIf(!existsSync('dist/index.html'))('no build, o JS ligado ao index.html não contém código do celular (API, pareamento, SSE)', () => {
    const html = readFileSync('dist/index.html', 'utf8');
    const scripts = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map(m => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(readFileSync(join('dist', script), 'utf8'), script).not.toMatch(/\/api\/pair|\/api\/events|__Host-ph/);
    expect(html).not.toContain('remote-');
  });
});
