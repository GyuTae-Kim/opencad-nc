import { metadata, renderMetadata, sitemapXml } from './site-metadata.mjs';

// The same generator supplies development HTML, deployment HTML and sitemap XML.
export function siteMetadata() {
  const sitemapPath = new URL(metadata.url).pathname + 'sitemap.xml';
  return {
    name: 'opencad-site-metadata',
    transformIndexHtml: { order: 'pre', handler(html) {
      if (html.split('<!-- site-metadata -->').length !== 2) throw new Error('Expected one shared metadata marker.');
      return html.replace('<!-- site-metadata -->', renderMetadata());
    } },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== '/sitemap.xml' && path !== sitemapPath) return next();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(sitemapXml());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
    },
  };
}
