import type { Site } from 'opencad-site-kit/seo/site-metadata';
import type { serviceWorker } from 'opencad-site-kit/pwa/sw-plugin';
export const site: Site;
export const offline: Parameters<typeof serviceWorker>[0];
export function fileHandling(extensions: readonly string[]): Record<string, unknown>;
