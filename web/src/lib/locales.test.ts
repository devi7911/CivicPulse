import { describe, expect, it } from 'vitest';
import { CORE_KEYS } from './i18n';

// Every locale lists its strings in CORE_KEYS order; a missing or extra line would shift every
// translation after it, so check the counts and that no entry is empty.
const files = import.meta.glob<{ default: string[] }>('./locales/*.ts', { eager: true });

describe('locales', () => {
  it('has the expected languages', () => {
    const langs = Object.keys(files).map((f) => f.replace('./locales/', '').replace('.ts', '')).sort();
    expect(langs).toEqual(['as', 'bn', 'doi', 'gu', 'hi', 'kn', 'kok', 'ks', 'mai', 'ml', 'mr', 'ne', 'or', 'pa', 'sa', 'sd', 'ta']);
  });
  for (const [file, mod] of Object.entries(files)) {
    it(`${file} matches the core keys`, () => {
      expect(mod.default).toHaveLength(CORE_KEYS.length);
      expect(mod.default.every((s) => typeof s === 'string' && s.trim().length > 0)).toBe(true);
    });
  }
  it('keeps the emergency number as 112 in every language', () => {
    const i = CORE_KEYS.indexOf('amber.call112');
    for (const mod of Object.values(files)) expect(mod.default[i]).toContain('112');
  });
});
