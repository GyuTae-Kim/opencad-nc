import metadata from './metadata.json' with { type: 'json' };
export const languages = [
  { code: 'ko', label: '한국어', locale: 'ko_KR' }, { code: 'en', label: 'English', locale: 'en_US' },
  { code: 'ja', label: '日本語', locale: 'ja_JP' }, { code: 'zh-CN', label: '简体中文', locale: 'zh_CN' }, { code: 'de', label: 'Deutsch', locale: 'de_DE' },
];
export const catalogs = {};
export function registerCatalog(language, content) { catalogs[language] = content; patterns.delete(language); cache.clear(); reverse=null; }
export const normalize = value => value.replace(/\s+/g, ' ').trim();
const patterns = new Map(); const cache = new Map();
// A separator (" · ", " | ", " — ", a line break) inside a pattern capture: the capture holds more than one piece of a joined sentence.
const SEPARATED = /(?:^|\s)[·|—](?:\s|$)|\n/;
const hangulCount = text => (text.match(/[가-힣]/g) ?? []).length;
let reverse = null;
export function sourceMessage(value) {
  if (['OpenCAD','Sean Kim','GitHub'].includes(value.trim())) return value;
  if (!reverse) { reverse = new Map(); for (const catalog of Object.values(catalogs)) for (const [key,text] of Object.entries(catalog)) if (text) reverse.set(normalize(text),key); }
  const source = reverse.get(normalize(value));
  return source ? (value.match(/^\s*/)?.[0] ?? '') + source + (value.match(/\s*$/)?.[0] ?? '') : value;
}
export function translate(value, language = 'ko') {
  if (language === 'ko' || typeof value !== 'string') return value;
  const key = normalize(value), catalog = catalogs[language] ?? {};
  if (catalog[key]) return catalog[key];
  if (!/[가-힣]/.test(key)) return value;
  const cacheKey = language + ':' + key;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (!patterns.has(language)) patterns.set(language, Object.keys(catalog).filter(k => /\{\d+\}/.test(k)).map(k => ({
    key: k, slots: k.match(/\{\d+\}/g), anchor: k.split(/\{\d+\}/).sort((a,b)=>b.length-a.length)[0],
    expression: new RegExp('^' + k.split(/\{\d+\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$'),
  })).sort((a,b) => b.key.replace(/\{\d+\}/g,'').length - a.key.replace(/\{\d+\}/g,'').length));
  let result = value, joined = null;
  for (const pattern of patterns.get(language)) {
    if (pattern.anchor && !key.includes(pattern.anchor)) continue;
    const match = key.match(pattern.expression);
    if (!match) continue;
    // Captures are document data, command identifiers, measurements or file names.
    // Substitute them verbatim, without translating or changing their values.
    const filled = catalog[pattern.key].replace(/\{\d+\}/g, slot => match[pattern.slots.indexOf(slot) + 1]);
    // A capture that runs over a separator and still holds Korean words may have swallowed the rest of a joined
    // sentence ("면 {0}" for "면 · 넓이 12 m² · 태그 벽" leaves "Face · 넓이 …"): keep looking for a pattern that fits,
    // and keep this one for the end, where the piece-by-piece split below wins if it leaves less Korean.
    if (match.slice(1).some(capture => SEPARATED.test(capture) && /[가-힣]/.test(capture))) {
      joined ??= filled;
      continue;
    }
    result = filled;
    break;
  }
  const disclosure = result === value ? value.match(/^(.*?)(\s*[▾▸▴▼▶▲])$/) : null;
  if (disclosure) result=translate(disclosure[1],language)+disclosure[2];
  if (result === value && /[\n]| · | \| | — /.test(value)) {
    const pieces = value.split(/(\n| · | \| | — )/);
    if (pieces.length > 1) result = pieces.map(piece => /[가-힣]/.test(piece) ? translate(piece,language) : piece).join('');
  }
  if (joined !== null && (result === value || hangulCount(joined) <= hangulCount(result))) result = joined;
  // Several messages on separate lines (a warning tooltip listing two warnings): the key above is normalized, so a pattern
  // capture may have run across the line break unseen. Translate line by line when that leaves less Korean.
  if (/\S\s*\n\s*\S/.test(value) && hangulCount(result)) {
    const lines = value.split(/(\n)/).map(piece => /[가-힣]/.test(piece) ? translate(piece,language) : piece).join('');
    if (hangulCount(lines) < hangulCount(result)) result = lines;
  }
  if (cache.size > 4000) cache.clear();
  cache.set(cacheKey, result);
  return result;
}
export function currentLanguage(url) {
  const parsed = new URL(url, metadata.url);
  const segments = parsed.pathname.split('/').filter(s => s && s !== 'index.html');
  return languages.find(item => item.code === segments.at(-1))?.code
    ?? languages.find(item => item.code === parsed.searchParams.get('lang'))?.code ?? 'ko';
}
export function languageUrl(raw, language = 'ko') {
  const url = new URL(raw, metadata.url);
  if (url.origin !== new URL(metadata.url).origin && !['127.0.0.1','localhost'].includes(url.hostname)) return raw;
  const app = url.pathname.match(/^\/(2dcad-viewer|opencad-(?:dwgdxf|skp|step|nc))\/(?:en|ja|zh-CN|de)?\/?(?:index\.html)?$/);
  if (app) {
    const name = app[1] === '2dcad-viewer' ? 'opencad-dwgdxf' : app[1];
    url.pathname = '/' + name + '/' + (language === 'ko' ? '' : language + '/');
  } else if (url.pathname === '/' || /^\/(?:en|ja|zh-CN|de)(?:\/|$)/.test(url.pathname) || /^\/(?:opencad|portfolio|research|contact|notes)(?:\/|$)/.test(url.pathname)) {
    const path = url.pathname.replace(/^\/(?:en|ja|zh-CN|de)(?=\/|$)/,'') || '/';
    url.pathname = (language === 'ko' ? '' : '/' + language) + path;
  } else return raw;
  if (url.searchParams.has('lang')) url.searchParams.delete('lang');
  return url.href;
}
export function translateData(value, language) {
  if (typeof value === 'string') return translate(value, language);
  if (Array.isArray(value)) return value.map(item => translateData(item, language));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,translateData(item,language)]));
  return value;
}
export function metadataForLanguage(language = 'ko') {
  const data = translateData(metadata, language);
  data.url = languageUrl(metadata.url, language);
  data.language = language;
  data.locale = languages.find(item => item.code === language).locale;
  data.author.url = languageUrl(metadata.author.url, language);
  data.breadcrumbs = data.breadcrumbs.map(item => ({...item, item: languageUrl(item.item, language)}));
  return data;
}
