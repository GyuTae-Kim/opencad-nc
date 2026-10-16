import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMetadata, metadata, history, sitemapXml } from './site-metadata.mjs';
import { assertContentDate, updatedHistory, validateDate } from './content-dates.mjs';
test('one configuration supplies search, sharing and application descriptions and date', () => {
  const dom = new JSDOM(`<head>${renderMetadata()}</head>`);
  const doc = dom.window.document;
  for (const selector of ['meta[name=description]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.equal(doc.querySelector(selector).content, metadata.description);
  const app = JSON.parse(doc.querySelector('script').textContent)['@graph'][0];
  assert.equal(app.description, metadata.description); assert.equal(app.dateModified, history.lastmod);
  assert.ok(sitemapXml().includes(`<lastmod>${history.lastmod}</lastmod>`));
  dom.window.close();
});
test('unchanged rebuilds preserve dates; changed app assets require an explicit later date', () => {
  const old = { '/': { lastmod: '2026-01-01T00:00:00Z', fingerprint: 'a' } };
  assert.deepEqual(updatedHistory(old, { '/': 'a' }, '2026-02-01T00:00:00Z'), old);
  assert.equal(updatedHistory(old, { '/': 'b' }, '2026-02-01T00:00:00Z')['/'].lastmod, '2026-02-01T00:00:00Z');
  assert.throws(() => validateDate('2999-01-01T00:00:00Z'));
});

test('application and sharing-image changes invalidate dates, while identical content keeps the date', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { resolve, join } = await import('node:path');
  const { appFingerprint } = await import('./app-fingerprint.mjs');
  mkdirSync('.runtime', { recursive: true });
  const root = mkdtempSync(resolve('.runtime/seo-fingerprint-'));
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<html><head>' + renderMetadata() + '</head><body><main><h1>Fixture app</h1></main></body></html>');
    writeFileSync(join(root, 'og-opencad.jpg'), 'initial image');
    writeFileSync(join(root, 'assets/app.js'), 'initial app');
    const before = appFingerprint(root);
    const record = { lastmod: '2026-01-01T00:00:00Z', fingerprint: before };
    assertContentDate('/', record, appFingerprint(root));
    writeFileSync(join(root, 'assets/app.js'), 'changed app');
    assert.throws(() => assertContentDate('/', record, appFingerprint(root)), /content changed/);
    writeFileSync(join(root, 'assets/app.js'), 'initial app');
    assert.equal(appFingerprint(root), before);
    writeFileSync(join(root, 'og-opencad.jpg'), 'changed image');
    assert.notEqual(appFingerprint(root), before);
    assert.throws(() => updatedHistory({ '/': record }, { '/': 'changed' }, record.lastmod), /later/);
    assert.throws(() => validateDate('2026-02-30T00:00:00Z'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
