import { languages } from '../site/i18n.mjs';
import { NC_EXTENSIONS } from '../src/extensions.ts';
import { manifestFor, manifestPath, metadata, renderMetadata, sitemapXml } from './site-metadata.mjs';

/** App manifest of a language page, with file handling for every extension the viewer opens */
const appManifest = (language) => JSON.stringify(manifestFor(language, NC_EXTENSIONS), null, 2) + '\n';

// The same generator supplies development HTML, deployment HTML and sitemap XML.
export function siteMetadata() {
  const sitemapPath = new URL(metadata.url).pathname + 'sitemap.xml';
  return {
    name: 'opencad-site-metadata',
    transformIndexHtml: { order: 'pre', handler(html) {
      if (html.split('<!-- site-metadata -->').length !== 2) throw new Error('Expected one shared metadata marker.');
      return html.replace('<!-- site-metadata -->', '<!-- localized-metadata:start -->' + renderMetadata() + '<!-- localized-metadata:end -->');
    } },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const manifest = path.match(/^\/(?:(en|ja|zh-CN|de)\/)?manifest\.webmanifest$/);
        if (manifest) {
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          return res.end(appManifest(manifest[1] ?? 'ko'));
        }
        if (path !== '/sitemap.xml' && path !== sitemapPath) return next();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(sitemapXml());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      for (const { code } of languages) this.emitFile({ type: 'asset', fileName: manifestPath(code), source: appManifest(code) });
    },
  };
}
