// User interface texts. Every visible string comes from a locale file (locales/<language>.json);
// the language is set in the instance configuration (language, default "en").
// t('a.b', { n }) looks up a key, fills {placeholders} and, for objects with one/other, picks the
// plural form by n. Missing keys fall back to English, then to the key itself.
import config from './config.js';
import en from '../locales/en.json';
import de from '../locales/de.json';

export const LOCALES = { en, de };
export const LANGUAGE = LOCALES[config.language] ? config.language : 'en';
const dict = LOCALES[LANGUAGE];
export const NUMBER_LOCALE = dict.meta.numberLocale;

const lookup = (d, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);

export function t(key, vars = {}) {
  let s = lookup(dict, key);
  if (s === undefined) s = lookup(en, key);
  if (s === undefined) return key;
  if (s && typeof s === 'object' && !Array.isArray(s) && 'other' in s) s = vars.n === 1 ? s.one : s.other;
  if (typeof s !== 'string') return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
