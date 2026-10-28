/**
 * vite-node 실행 파일 자리: 설치된 vite-node의 package.json `bin`을 따른다.
 * 판마다 자리가 달라(3.x `vite-node.mjs`, 5.x `dist/cli.mjs`) 경로를 박아 두지 않는다.
 * 훑기(sweep.ts)가 자식 프로세스를 띄울 때와 그 시험(tests/sweep.test.ts)이 CLI를 돌릴 때 쓴다.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export function viteNodeCli(): string {
  const pkgPath = createRequire(import.meta.url).resolve('vite-node/package.json');
  const bin = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }).bin;
  return resolve(dirname(pkgPath), typeof bin === 'string' ? bin : bin['vite-node']!);
}
