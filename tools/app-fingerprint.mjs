import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { contentFingerprint, digest } from './content-dates.mjs';
import { metadata } from './site-metadata.mjs';
export function appFingerprint(root = 'dist') {
  const base = new URL(metadata.url).pathname;
  const document = contentFingerprint(readFileSync(join(root, 'index.html'), 'utf8'), path => {
    if (!path.startsWith(base)) throw new Error('Unexpected application asset: ' + path);
    return readFileSync(join(root, path.slice(base.length)));
  }, metadata.url);
  // Include executable assets: changing a CAD command changes this application
  // even when its static introduction is unchanged. Source maps are not content.
  const assets = readdirSync(join(root, 'assets')).filter(file => /\.(?:js|mjs|css)$/.test(file)).sort()
    .map(file => [file, digest(readFileSync(join(root, 'assets', file)))]);
  return digest(JSON.stringify({ document, assets }));
}
