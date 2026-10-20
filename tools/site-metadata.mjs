import { languages, languageUrl, metadataForLanguage } from '../site/i18n.mjs';
import metadata from '../site/metadata.json' with { type: 'json' };
import history from '../site/content-history.json' with { type: 'json' };
export { metadata, history };
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
