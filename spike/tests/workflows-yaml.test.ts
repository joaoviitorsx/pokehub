import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// O GitHub recusa o workflow inteiro se o YAML for inválido (ex.: "name: A (B: C)" sem aspas).
// js-yaml já vem como dependência do electron-builder.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(source: string): unknown };
const files = ['.github/workflows/desktop.yml', '.github/workflows/release.yml', '.github/dependabot.yml'];

describe('workflows do GitHub', () => {
  for (const file of files) it(`${file} é YAML válido e tem jobs/updates`, () => {
    const doc = yaml.load(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(doc && typeof doc === 'object').toBe(true);
    expect(Boolean(doc.jobs || doc.updates)).toBe(true);
  });
});
