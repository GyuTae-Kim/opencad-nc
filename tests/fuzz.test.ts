/**
 * 해석기 견고성 퍼징(빠른 판 — 씨앗 고정, 수 초): 합성 씨앗(tests/nc-seeds.ts — G-code 방언 다섯·Siemens·Heidenhain·MPR·PGI·KDT XML)을
 * tests/nc-mutate.ts의 바꾸기 11종으로 바꿔 앱 해석 워커와 같은 길(입력 확인 → parseNcFile → ncParsedToScene → 패널 자료)로 연다.
 * 실행 블록 한도만 20만으로 줄인다(움직이며 끝없이 도는 고리가 한도 500만까지 도는 데 수 초 걸려 — 그 한도는 따로 시험함).
 * 기대: 앱이 알고 거절하는 글(빈 파일·이진·NC 아님·판 크기 없음 등 — 한국어 Error) 말고는 예외가 없고, 한 입력이 시간 안에 끝나며,
 * 화면 좌표·이동 좌표가 모두 유한하다. 53차 대량 퍼징(로컬 표본 + 씨앗, 수만 번)의 결함 최소 재현은 tests/robustness-fuzz.test.ts에 따로 둔다.
 */
import { describe, expect, it } from 'vitest';
import { checkNcInput, ncPayload, parseOptions } from '../src/app/payload';
import { ncParsedToScene, parseNcFile } from '../src/index';
import { mutate, NC_MUTATION_KINDS, rng } from './nc-mutate';
import { NC_SEEDS } from './nc-seeds';

/** 앱 워커의 길(parseForView)과 같되 실행 블록 한도만 maxBlocks로. 거절이면 그 글, 아니면 좌표가 유한하지 않은 수 */
function open(name: string, bytes: Uint8Array, maxBlocks: number): { rejected?: string; nonFinite: number } {
  const check = checkNcInput(name, bytes);
  if (!check.ok) return { rejected: check.message, nonFinite: 0 };
  const o = parseOptions(check.kind, {});
  let parsed;
  try {
    parsed = parseNcFile(name, bytes, { ...o, gcode: { ...o.gcode, maxBlocks }, heidenhain: { ...o.heidenhain, maxBlocks } });
  } catch (e) {
    // 앱이 알고 내는 오류(판 크기 없음 등 — 한국어 글의 Error)는 거절
    if ((e as Error)?.constructor === Error && /[가-힣]/.test(String((e as Error).message))) return { rejected: (e as Error).message, nonFinite: 0 };
    throw e;
  }
  const scene = ncParsedToScene(parsed, { nc: { compPath: true }, mpr: {} });
  let nonFinite = 0;
  for (const x of [...scene.meshes, ...scene.lines, ...(scene.points ?? [])]) for (const v of x.positions) if (!Number.isFinite(v)) nonFinite++;
  if ('program' in parsed) {
    const p = ncPayload(parsed.program);
    for (let i = 0; i < (p.moves.count + 1) * 3; i++) if (!Number.isFinite(p.moves.points[i]!)) nonFinite++;
  }
  return { nonFinite };
}

describe('해석기 퍼징(빠른 판, 씨앗 고정)', () => {
  it('바꾸기 11종 × 합성 씨앗 열: 알고 거절하는 오류 말고는 예외 없음, 한 입력 3초 안, 좌표 모두 유한', () => {
    const r = rng(53);
    const PER = 2;
    let runs = 0;
    let rejected = 0;
    let slowest = { ms: 0, what: '' };
    const failures: string[] = [];
    for (const seed of NC_SEEDS) {
      const base = new TextEncoder().encode(seed.text);
      for (const kind of NC_MUTATION_KINDS) {
        for (let k = 0; k < PER; k++) {
          const s = Math.floor(r() * 2 ** 32);
          const m = mutate(base, kind, s);
          const what = `${seed.name}:${kind}:${s} ${m.detail}`;
          runs++;
          const t0 = performance.now();
          try {
            const o = open(seed.name, m.bytes, 200_000);
            const ms = performance.now() - t0;
            if (o.rejected) rejected++;
            if (ms > slowest.ms) slowest = { ms, what };
            if (ms > 3000) failures.push(`느림 ${Math.round(ms)}ms ${what}`);
            if (o.nonFinite) failures.push(`유한하지 않은 좌표 ${o.nonFinite}개 ${what}`);
          } catch (e) {
            failures.push(`예외 ${(e as Error)?.name}: ${String((e as Error)?.message).slice(0, 120)} ${what}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(runs).toBe(NC_SEEDS.length * NC_MUTATION_KINDS.length * PER);
    // 거절(빈 파일·이진 등)만 나오지 않게 — 대부분은 열린다
    expect(rejected).toBeLessThan(runs / 4);
    expect(slowest.ms).toBeLessThan(3000);
  });

  it('바꾸기는 씨앗이 같으면 같은 바이트(재현)', () => {
    const base = new TextEncoder().encode(NC_SEEDS[1]!.text);
    for (const kind of NC_MUTATION_KINDS) expect(mutate(base, kind, 7).bytes).toEqual(mutate(base, kind, 7).bytes);
  });
});
