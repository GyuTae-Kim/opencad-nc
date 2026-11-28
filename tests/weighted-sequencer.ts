import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * CI 8차(시험 조각 고르게 — DWG·DXF CI 2차와 같은 꼴): CI 시험 작업이 `vitest run --shard=i/n`으로 시험 파일을 러너 여럿에 나눠 돈다.
 * 기본 나눔은 파일 경로 해시로 같은 수씩이라 무거운 파일이 한 조각에 몰릴 수 있어,
 * 앞 CI 실행에서 잰 파일 시간(`tests/shard-weights.json`, ms)에 파일마다 여는 비용(PER_FILE_MS — transform·import 어림)을 더해
 * 무거운 파일부터 지금 가장 가벼운 조각에 넣는다. 모든 조각이 같은 표·같은 파일 목록으로 같은 나눔을 셈하므로 겹치거나 빠지는 파일이 없다.
 * 표에 없는 새 파일은 표의 가운데 값으로 본다. 조각을 쓰지 않는 실행(`npm test`·`npx vitest run`)에는 닿지 않는다.
 * 표를 새로 만들 때: CI 시험 조각 기록의 「✓ tests/… (N tests) Xms」 줄에서 파일·ms를 모은다(기록의 색 글자는 「^[[…m」 글자로 적혀 있어 먼저 걷는다).
 * CI 19차부터 값은 최근 실행 여럿(여섯)의 파일별 최댓값이다(건너뛴 파일은 1 — DWG·DXF CI 16차·SKP CI 18차 꼴: 무거운 파일일수록 실행마다
 * 출렁여 한 번 잰 값·평균은 무거운 파일을 가볍게 보아 한 조각에 몰았다).
 */
const PER_FILE_MS = 600;

export class WeightedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const root = this.ctx.config.root;
    const weights = JSON.parse(readFileSync(join(root, 'tests', 'shard-weights.json'), 'utf8')) as Record<string, number>;
    const known = Object.values(weights).sort((a, b) => a - b);
    const fallback = known.length ? known[Math.floor(known.length / 2)]! : 0;
    const items = files
      .map((spec) => {
        const key = relative(root, spec.moduleId).split('\\').join('/');
        return { spec, key, w: (weights[key] ?? fallback) + PER_FILE_MS };
      })
      .sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const load = new Array<number>(shard.count).fill(0);
    const out: TestSpecification[] = [];
    for (const item of items) {
      let k = 0;
      for (let i = 1; i < load.length; i++) if (load[i]! < load[k]!) k = i;
      load[k] = load[k]! + item.w;
      if (k === shard.index - 1) out.push(item.spec);
    }
    return out;
  }
}
