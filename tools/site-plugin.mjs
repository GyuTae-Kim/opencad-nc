import { languages } from '../site/i18n.mjs';
import { manifestFor, manifestPath, metadata, renderMetadata, sitemapXml } from './site-metadata.mjs';

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
        const language = path.match(/\/(en|ja|zh-CN|de)\/manifest\.webmanifest$/)?.[1];
        if (language) {
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          return res.end(JSON.stringify(manifestFor(language), null, 2));
        }
        if (path !== '/sitemap.xml' && path !== sitemapPath) return next();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(sitemapXml());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      for (const { code } of languages.filter((item) => item.code !== 'ko')) {
        this.emitFile({ type: 'asset', fileName: manifestPath(code), source: JSON.stringify(manifestFor(code), null, 2) + '\n' });
      }
    },
  };
}
