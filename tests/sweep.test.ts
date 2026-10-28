/**
 * 실제 파일 훑기 도구(scripts/sweep/) 자체 시험: 직접 만든 작은 합성 표본(임시 폴더)으로 인자·훑기·중복 빼기·분류·요약·비교·CLI를 본다.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareMain, compareRuns, fromJsonl, isCHeader, listFiles, messageCode, parseSweepArgs, percentile, sceneSignatures, summarize, sweepItems, sweepOne, toJsonl, uniqueFiles, type SweepRecord } from '../scripts/sweep/core';
import { viteNodeCli } from '../scripts/sweep/vite-node';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const MILL = 'G21 G17 G90 G54\nT1 M6\nS1000 M3\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X40\nG3 X60 Y20 I0 J20\nG0 Z5\nM30\n';
const NO_UNITS = 'G90\nT1 M6\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X10\nM30\n';
const HH = '0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S1000\n2 L X+0 Y+0 Z+5 R0 FMAX\n3 L Z-1 F100\n4 L X+20\n5 END PGM T MM\n';
const C_HEADER = '#ifndef A_H\n#define A_H\nint a(void);\n#endif\n';
const MPR = '[H\nVERSION="4.0 Alpha"\n_BSX=100.000000\n_BSY=50.000000\n_BSZ=19.000000\n\n<100 \\WerkStck\\\nLA="100"\nBR="50"\nDI="19"\n\n<102 \\BohrVert\\\nXA="20"\nYA="25"\nTI="10"\nDU="8"\n\n<139 \\Komponente\\\nIN="teil.mpr"\n!\n';
const BINARY = new Uint8Array(4096).map((_, i) => (i % 3 ? 0 : 0x41));

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nc-sweep-test-'));
  const put = (p: string, b: string | Uint8Array): void => {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), typeof b === 'string' ? enc(b) : b);
  };
  put('a/mill.nc', MILL);
  put('b/copy-of-mill.tap', MILL); // 같은 내용
  put('b/no-units.nc', NO_UNITS);
  put('b/deep/panel.mpr', MPR);
  put('c/prog.h', HH);
  put('c/lib.h', C_HEADER); // C 머리 파일: 뺀다
  put('c/data.bin.nc', BINARY);
  put('c/notes.txt', MILL); // 앱이 열지 않는 확장자
  put('c/node_modules/x.nc', MILL); // 건너뛰는 폴더
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('인자', () => {
  it('--dirs(쌍점·여러 번·=)와 환경 변수, 기본 출력 폴더', () => {
    const now = new Date('2026-10-27T01:02:03Z');
    expect(parseSweepArgs(['--', '--dirs', 'a:b', '--dirs=c', '--jobs', '3', '--limit=5'], {}, now)).toEqual({ dirs: ['a', 'b', 'c'], out: join('.runtime', 'sweep', 'run-20261027-010203'), jobs: 3, limit: 5, force: false, child: null });
    expect(parseSweepArgs([], { OPENCAD_SWEEP_DIRS: 'x: y' }).dirs).toEqual(['x', 'y']);
    // 인자가 환경 변수보다 먼저
    expect(parseSweepArgs(['--dirs', 'p'], { OPENCAD_SWEEP_DIRS: 'x' }).dirs).toEqual(['p']);
    expect(parseSweepArgs(['--out', '.runtime/sweep/before']).out).toBe('.runtime/sweep/before');
    expect(parseSweepArgs([]).dirs).toEqual([]);
    expect(() => parseSweepArgs(['--jobs', '0'])).toThrow(/--jobs/);
    expect(() => parseSweepArgs(['--what'])).toThrow(/모르는 인자/);
  });
});

describe('훑기와 중복 빼기', () => {
  it('앱이 여는 확장자만 이름 차례로, node_modules는 건너뛴다', () => {
    const names = listFiles([root]).map((f) => f.path.slice(root.length + 1));
    expect(names).toEqual(['a/mill.nc', 'b/copy-of-mill.tap', 'b/deep/panel.mpr', 'b/no-units.nc', 'c/data.bin.nc', 'c/lib.h', 'c/prog.h']);
  });

  it('내용(sha256)이 같으면 한 번, C 머리 파일 .h는 빼고 Heidenhain .h는 둔다', () => {
    const u = uniqueFiles(listFiles([root]));
    expect(u.found).toBe(7);
    expect(u.duplicates).toBe(1);
    expect(u.skipped).toEqual({ cHeader: 1, unreadable: 0 });
    expect(u.items.map((f) => f.name)).toEqual(['mill.nc', 'panel.mpr', 'no-units.nc', 'data.bin.nc', 'prog.h']);
    expect(u.items[0]!.dups).toBe(1);
    expect(u.items[0]!.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(uniqueFiles(listFiles([root]), 2).items.length).toBe(2);
    expect(isCHeader('lib.h', enc(C_HEADER))).toBe(true);
    expect(isCHeader('prog.h', enc(HH))).toBe(false);
    expect(isCHeader('a.nc', enc(C_HEADER))).toBe(false);
  });
});

describe('파일 하나(앱 워커와 같은 해석 길)', () => {
  it('G-code: 형식·방언·지표와 장면 서명', () => {
    const r = sweepOne('mill.nc', enc(MILL));
    expect(r).toMatchObject({ cls: 'ok', kind: 'gcode', ext: 'nc', size: MILL.length, warnings: {} });
    expect(r.metrics).toMatchObject({ moves: 4, tools: 1, arcs: 1, warnings: 0 });
    expect(r.metrics.segments).toBeGreaterThan(4);
    expect(r.format).toBe('iso');
    expect(r.path).toBeUndefined();
    // 같은 내용은 같은 서명, 좌표가 하나라도 다르면 geomSig가 다르다
    const again = sweepOne('x.nc', enc(MILL));
    expect([again.metrics.sceneSig, again.metrics.geomSig]).toEqual([r.metrics.sceneSig, r.metrics.geomSig]);
    const moved = sweepOne('x.nc', enc(MILL.replace('G1 X40', 'G1 X41')));
    expect(moved.metrics.sceneSig).toBe(r.metrics.sceneSig);
    expect(moved.metrics.geomSig).not.toBe(r.metrics.geomSig);
  });

  it('경고가 있으면 warn(경고는 코드로 센다), 그릴 것이 없으면 empty, 예외는 error', () => {
    const w = sweepOne('no-units.nc', enc(NO_UNITS));
    expect(w.cls).toBe('warn');
    expect(Object.keys(w.warnings)).toEqual(['단위 코드(G#/G#)가 없어 mm로 봄']);
    expect(sweepOne('e.nc', enc('G21 G90\nM30\n')).cls).toBe('empty');
    const b = sweepOne('data.bin.nc', BINARY);
    expect(b.cls).toBe('error');
    expect(b.kind).toBeUndefined();
    expect(b.error!.code).toMatch(/이진 자료/);
  });

  it('MPR: 판별(VERSION)·가공 수·지원하지 않는 매크로', () => {
    const r = sweepOne('panel.mpr', enc(MPR));
    expect(r).toMatchObject({ kind: 'mpr', format: '4.0 Alpha', cls: 'warn' });
    expect(r.metrics).toMatchObject({ ops: 2, otherOps: 1, workpiece: 1 });
    expect(Object.keys(r.warnings)[0]).toMatch(/Komponente/);
  });

  it('경고 코드: 줄 번호·수·따옴표 값을 지운다', () => {
    expect(messageCode('94번 줄: 지원하지 않는 매크로 <188 \\Easyedge\\ — 목록에만 넣음 (모두 4번)')).toBe('#번 줄: 지원하지 않는 매크로 <# \\Easyedge\\ — 목록에만 넣음 (모두 #번)');
    expect(messageCode("T2: 알 수 없는 식 'A+B'")).toBe("…: 알 수 없는 식 '…'");
  });
});

describe('요약과 비교', () => {
  const recs = (): SweepRecord[] => sweepItems(uniqueFiles(listFiles([root])).items);

  it('요약: 분류·형식·예외·경고 코드·시간 백분위·품질 지표, done', () => {
    const s = summarize(recs(), { dirs: 1, found: 7, duplicates: 1, skipped: { cHeader: 1 } });
    expect(s.done).toBe(true);
    expect(s.unique).toBe(5);
    expect(s.classes).toEqual({ ok: 2, warn: 2, empty: 0, error: 1 });
    expect(s.kinds).toEqual({ gcode: 2, 'error:nc': 1, heidenhain: 1, mpr: 1 });
    expect(Object.values(s.errors)).toEqual([1]);
    expect(s.warnings['단위 코드(G#/G#)가 없어 mm로 봄']).toEqual({ files: 1, count: 1 });
    expect(s.quality).toMatchObject({ ops: 2, otherOps: 1, filesWithOtherOps: 1, supportedOpsShare: 0.5, parsedShare: 0.8 });
    expect(s.timeMs.max).toBeGreaterThanOrEqual(s.timeMs.p50);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([], 90)).toBe(0);
  });

  it('비교: 같으면 바뀐 것 없음, 분류·지표·새 예외·더하고 빠진 파일을 가린다', () => {
    const a = recs();
    expect(compareRuns(a, fromJsonl(toJsonl(a))).changed).toBe(false);
    const b = fromJsonl(toJsonl(a));
    const mill = b.find((r) => r.kind === 'gcode' && r.cls === 'ok')!;
    mill.metrics.segments! += 1;
    const warn = b.find((r) => r.cls === 'warn' && r.kind === 'gcode')!;
    warn.cls = 'error';
    warn.error = { code: '새 오류', message: '새 오류' };
    warn.warnings = {};
    b.push({ ...mill, sha: 'f'.repeat(64) });
    const c = compareRuns(a, b.filter((r) => r.kind !== 'heidenhain'));
    expect(c).toMatchObject({ changed: true, classChanged: 1, metricChanged: 2, added: 1, removed: 1 });
    expect(c.newErrors).toEqual([{ sha: warn.sha.slice(0, 16), ext: warn.ext, code: '새 오류' }]);
    expect(c.metricChanges.find((x) => x.sha === mill.sha.slice(0, 16))!.fields.segments).toEqual([mill.metrics.segments! - 1, mill.metrics.segments]);
    expect(c.warningCodes['단위 코드(G#/G#)가 없어 mm로 봄']).toEqual([1, 0]);
  });

  it('sweep:compare: --fail-on-change면 바뀐 것이 있을 때 1, 인자가 없으면 쓰는 법만', () => {
    const a = recs();
    const dir = (name: string, r: SweepRecord[]): string => {
      const d = join(root, 'out', name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'records.jsonl'), toJsonl(r));
      return d;
    };
    const before = dir('before', a);
    const same = dir('same', a);
    const b = fromJsonl(toJsonl(a));
    b[0]!.metrics.segments! += 2;
    const changed = dir('changed', b);
    const log: string[] = [];
    expect(compareMain(['--', before, same, '--fail-on-change'], (s) => log.push(s))).toBe(0);
    expect(log.at(-1)).toBe('바뀐 것이 없습니다.');
    expect(compareMain([before, changed, '--fail-on-change'], () => {})).toBe(1);
    expect(compareMain([before, changed], () => {})).toBe(0);
    const json = join(root, 'out', 'cmp.json');
    compareMain([before, changed, '--json', json], () => {});
    expect(JSON.parse(readFileSync(json, 'utf8')).metricChanged).toBe(1);
    expect(compareMain([], () => {})).toBe(0);
    expect(compareMain([before], () => {})).toBe(2);
    expect(compareMain([before, same, '--bad'], () => {})).toBe(2);
  });

  it('장면 서명은 id·개수와 좌표 비트를 따로 본다', () => {
    const base = { meshes: [], lines: [{ id: 'l', positions: new Float32Array([0, 0, 0, 1, 0, 0]), segmentIds: new Uint32Array([0]) }] };
    const s0 = sceneSignatures(base);
    expect(sceneSignatures({ ...base, lines: [{ ...base.lines[0]!, id: 'k' }] }).sceneSig).not.toBe(s0.sceneSig);
    const s1 = sceneSignatures({ ...base, lines: [{ ...base.lines[0]!, segmentIds: new Uint32Array([1]) }] });
    expect(s1.sceneSig).toBe(s0.sceneSig);
    expect(s1.geomSig).not.toBe(s0.geomSig);
  });
});

describe('CLI(npm run sweep)', () => {
  const VITE_NODE = viteNodeCli();
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [VITE_NODE, 'scripts/sweep/sweep.ts', '--', ...args], { encoding: 'utf8', env: { ...process.env, OPENCAD_SWEEP_DIRS: '', ...env } });

  it('폴더가 없으면 쓰는 법만 찍고 0, 자식 둘로 나눠 훑어 합친 결과는 한 프로세스와 같다, 기준 결과는 덮어쓰지 않는다', () => {
    const none = run([]);
    expect(none.status).toBe(0);
    expect(none.stdout).toMatch(/쓰는 법: npm run sweep/);
    const one = join(root, 'out', 'one');
    const two = join(root, 'out', 'two');
    expect(run(['--dirs', join(root, 'a') + ':' + join(root, 'b') + ':' + join(root, 'c'), '--out', one]).status).toBe(0);
    const r2 = run(['--out', two, '--jobs', '2'], { OPENCAD_SWEEP_DIRS: [join(root, 'a'), join(root, 'b'), join(root, 'c')].join(':') });
    expect(r2.status, r2.stderr).toBe(0);
    const strip = (d: string) => fromJsonl(readFileSync(join(d, 'records.jsonl'), 'utf8')).map((r) => ({ ...r, ms: 0 }));
    expect(strip(two)).toEqual(strip(one));
    const s = JSON.parse(readFileSync(join(two, 'summary.json'), 'utf8'));
    expect(s).toMatchObject({ done: true, dirs: 3, found: 7, duplicates: 1, unique: 5, jobs: 2 });
    // 경로는 records.jsonl(로컬 결과)에만
    expect(JSON.stringify(s)).not.toContain(root);
    expect(readFileSync(join(two, 'records.jsonl'), 'utf8')).toContain(root);
    expect(run(['--dirs', join(root, 'a'), '--out', one]).status).toBe(2);
    expect(run(['--dirs', join(root, 'a'), '--out', one, '--force']).status).toBe(0);
  });
});
