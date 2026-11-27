// 휴대폰 로딩 비교(.github/workflows/mobile-validation.yml)의 lighthouse 여섯 번(기준·후보 × 세 번)을
// node 한 프로세스에서 lighthouse Node API로 차례로 돌린다(CI 6차).
// 명령줄 lighthouse는 번마다 node 시작·모듈 읽기를 새로 했다(번마다 시작 간격 약 10초 가운데 lighthouse 안 시간은 약 4.5초).
// 설정(--only-categories·--disable-full-page-screenshot)·Chrome 플래그·차례(기준 → 후보)·보고서 이름(<variant>-<round>.report.json·html)은
// 명령줄 때와 같고, Chrome은 번마다 새 프로필로 띄우고 끈다 — 재는 조건·세 번 가운데 값은 그대로다.
// 쓰임: lighthouse·chrome-launcher를 설치한 폴더에 복사해 `node <그 폴더>/lighthouse-rounds.mjs <출력 폴더>`
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const out = process.argv[2];
if (!out) throw new Error('usage: node lighthouse-rounds.mjs <output directory>');
const targets = [
  ['baseline', 'http://127.0.0.1:4320/'],
  ['candidate', 'http://127.0.0.1:4321/'],
];
const chromeFlags = ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];
const flags = {
  output: ['json', 'html'],
  onlyCategories: ['performance', 'accessibility', 'seo'],
  disableFullPageScreenshot: true,
  logLevel: 'silent',
};

for (const round of [1, 2, 3]) {
  for (const [variant, url] of targets) {
    const name = `${variant}-${round}`;
    const started = performance.now();
    const chrome = await chromeLauncher.launch({ chromeFlags, logLevel: 'silent' });
    const launched = performance.now();
    let ran = launched;
    try {
      const result = await lighthouse(url, { ...flags, port: chrome.port });
      ran = performance.now();
      if (!result) throw new Error(`${name}: lighthouse gave no result`);
      const error = result.lhr.runtimeError;
      if (error) throw new Error(`${name}: ${error.code} ${error.message}`);
      const [json, html] = result.report;
      await writeFile(join(out, `${name}.report.json`), json);
      await writeFile(join(out, `${name}.report.html`), html);
    } finally {
      await chrome.kill();
    }
    const done = performance.now();
    const ms = (a, b) => Math.round(b - a);
    console.log(`${name}: chrome ${ms(started, launched)} ms · lighthouse ${ms(launched, ran)} ms · write+close ${ms(ran, done)} ms`);
  }
}
