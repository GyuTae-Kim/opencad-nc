import { siteLocalization } from './tools/localization-plugin.mjs';
import { defineConfig } from 'vitest/config';
import { siteMetadata } from './tools/site-plugin.mjs';
import { serviceWorker } from './tools/sw-plugin.mjs';

// 앱(루트 index.html → src/app)과 시험을 함께 설정한다.
// GitHub Pages 프로젝트 사이트(https://gyutae-kim.github.io/opencad-nc/)에서도 돌게 상대 경로로 낸다.
// 빌드 끝에 오프라인용 서비스 워커(dist/sw.js — tools/sw-plugin.mjs)를 만든다.
export default defineConfig({
  base: './',
  plugins: [siteLocalization(), siteMetadata(), serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
