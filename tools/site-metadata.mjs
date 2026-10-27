import { readFileSync } from 'node:fs';
import { languages, languageUrl, metadataForLanguage, translate } from '../site/i18n.mjs';
import metadata from '../site/metadata.json' with { type: 'json' };
import history from '../site/content-history.json' with { type: 'json' };
export { metadata, history };
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Home-screen install: site/manifest.webmanifest is the Korean source (the build writes manifest.webmanifest). Other languages
// get a translated copy at <language>/manifest.webmanifest whose start_url is that language page (scope stays the whole app).
export const manifestPath = (language = 'ko') => (language === 'ko' ? '' : language + '/') + 'manifest.webmanifest';
/**
 * Offline app file handling for the extensions the viewer opens (dotless, as in src/extensions.ts NC_EXTENSIONS):
 * Android share target (POST ./share-target, handled by the service worker), desktop "Open with" (file_handlers →
 * launchQueue, all chosen files in one window so a main program and its subprograms open as one job) and launch_handler.
 * Actions are relative to the manifest, so a language manifest shares into and opens files on its own language page.
 */
export function fileHandling(extensions) {
  const exts = [...new Set(extensions.map((e) => '.' + String(e).toLowerCase()))];
  const xml = exts.filter((e) => e === '.xml');
  return {
    share_target: { action: './share-target', method: 'POST', enctype: 'multipart/form-data',
      params: { files: [{ name: 'file', accept: [...exts, 'text/plain', 'text/x-gcode', 'application/xml', 'text/xml', 'application/octet-stream'] }] } },
    file_handlers: [{ action: './', accept: { 'text/plain': exts.filter((e) => e !== '.xml'), ...(xml.length ? { 'application/xml': xml } : {}) }, launch_type: 'single-client' }],
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
  };
}
export function manifestFor(language = 'ko', extensions = null) {
  const source = JSON.parse(readFileSync(new URL('../site/manifest.webmanifest', import.meta.url), 'utf8'));
  const files = extensions ? fileHandling(extensions) : {};
  if (language === 'ko') return { ...source, ...files };
  return { ...source, name: translate(source.name, language), short_name: translate(source.short_name, language),
    description: translate(source.description, language), lang: language, start_url: './', scope: '../',
    icons: source.icons.map((icon) => ({ ...icon, src: '../' + icon.src })), ...files };
}
export function renderMetadata(language = 'ko') {
  const metadata = metadataForLanguage(language);
  const image = metadata.image;
  const tags = [`<title>${escape(metadata.title)}</title>`, `<link rel="canonical" href="${escape(metadata.url)}">`,
    `<link rel="sitemap" type="application/xml" href="${escape(languageUrl(metadata.url,'ko'))}sitemap.xml">`];
  const names = { description: metadata.description, robots: 'index, follow, max-image-preview:large', author: metadata.author.name,
    'twitter:card': 'summary_large_image', 'twitter:title': metadata.title, 'twitter:description': metadata.description,
    'twitter:image': image.url, 'twitter:image:alt': image.alt };
  const properties = { 'og:type': 'website', 'og:site_name': metadata.siteName, 'og:locale': metadata.locale,
    'og:title': metadata.title, 'og:description': metadata.description, 'og:url': metadata.url,
    'og:image': image.url, 'og:image:secure_url': image.url, 'og:image:type': image.type,
    'og:image:width': image.width, 'og:image:height': image.height, 'og:image:alt': image.alt };
  for (const [name, content] of Object.entries(names)) tags.push(`<meta name="${name}" content="${escape(content)}">`);
  for (const [property, content] of Object.entries(properties)) tags.push(`<meta property="${property}" content="${escape(content)}">`);
  for (const item of [...languages, { code: 'ko', label: 'x-default' }]) tags.push(`<link rel="alternate" hreflang="${item.label === 'x-default' ? 'x-default' : item.code}" href="${escape(languageUrl(metadata.url,item.code))}">`);
  // Relative to the application root (language pages carry <base href="../">).
  tags.push(`<link rel="manifest" href="./${manifestPath(language)}">`, `<meta name="apple-mobile-web-app-title" content="${escape(manifestFor(language).short_name)}">`);
  const graph = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', '@id': metadata.url + '#app', ...metadata.application, url: metadata.url,
      description: metadata.description, inLanguage: metadata.language, image: image.url, author: metadata.author, dateModified: history.lastmod },
    { '@type': 'BreadcrumbList', itemListElement: metadata.breadcrumbs },
  ] };
  tags.push(`<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`);
  return tags.join('\n    ');
}
export function sitemapXml() {
  const alternates = [...languages.map(({code}) => `<xhtml:link rel="alternate" hreflang="${code}" href="${escape(languageUrl(metadata.url,code))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${escape(metadata.url)}"/>`].join('');
  const urls = languages.map(({code}) => `  <url><loc>${escape(languageUrl(metadata.url,code))}</loc><lastmod>${escape(history.lastmod)}</lastmod>${alternates}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
