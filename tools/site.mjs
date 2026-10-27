// 이 앱의 사이트 설정(opencad-site-kit): 검색 정보·언어 페이지·앱 정보와 오프라인 서비스 워커. vite.config.ts와 시험이 같이 쓴다.
// src/extensions.ts를 가져오므로 Vite·vitest에서만 읽는다(opencad-site 명령은 이 파일을 읽지 않는다).
import metadata from '../site/metadata.json' with { type: 'json' };
import history from '../site/content-history.json' with { type: 'json' };
import '../site/i18n.mjs';
import { NC_EXTENSIONS } from '../src/extensions.ts';
import { defineSite } from 'opencad-site-kit/seo/site-metadata';
import { serviceWorkerSource } from './sw-source.mjs';

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

// 앱 정보 원본은 site/manifest.webmanifest: 한국어도 빌드가 쓰고(여는 확장자의 파일 연결을 더해), 언어별 링크·홈 화면 이름은 검색 정보 자리에
export const site = defineSite({ metadata, history, manifest: {
  source: new URL('../site/manifest.webmanifest', import.meta.url), emitDefault: true, links: 'metadata',
  extend: (manifest) => ({ ...manifest, ...fileHandling(NC_EXTENSIONS) }),
} });

/** serviceWorker(offline): 판 이름은 예전처럼 미리 담는 파일 이름·내용(사이에 \0) 지문의 앞 12자리 */
export const offline = {
  source: ({ version, precache }) => serviceWorkerSource({ version, urls: precache }),
  version: { length: 12, separator: '\0', terminator: '' },
};
