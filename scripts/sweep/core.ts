/**
 * 실제 파일 훑기(읽기만)의 순수 부분: 인자 읽기, 폴더 훑기, 파일 하나 해석(앱 워커와 같은 parseForView 길), 요약, 두 결과 비교.
 * CLI는 sweep.ts(훑기)·compare.ts(비교)다. 표본 파일·경로는 저장소에 넣지 않고, 결과는 각자 로컬 폴더(.runtime/sweep/…)에만 둔다.
 *
 * 결과 꼴
 * - records.jsonl: 내용(sha256)이 다른 파일마다 한 줄. 열쇠는 내용 해시(sha), 경로(path)는 이 로컬 결과에만 있다
 * - summary.json: 분류(ok·warn·empty·error)·형식·판별 개수, 예외·경고 코드별 개수, 해석 시간 백분위, 품질 지표, done: true
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseForView } from '../../src/app/payload';
import { NC_EXTENSIONS } from '../../src/extensions';
import { detectNcFormat } from '../../src/index';

/** 앱이 여는 확장자(점 없이, 소문자) */
export const SWEEP_EXTENSIONS: ReadonlySet<string> = new Set(NC_EXTENSIONS);

export const USAGE = `쓰는 법: npm run sweep -- [--dirs <폴더1>:<폴더2>] [--out .runtime/sweep/<이름>] [--jobs N] [--limit N] [--force]
  표본 폴더는 --dirs 또는 환경 변수 OPENCAD_SWEEP_DIRS(쌍점으로 구분). 둘 다 없으면 이 안내만 찍고 끝난다.
  폴더를 재귀로 훑어 NC 뷰어가 여는 확장자만 고르고, 내용(sha256)이 같은 파일은 한 번만 해석한다(C 머리 파일 .h는 뺀다).
  결과: <out>/records.jsonl(파일마다 한 줄), <out>/summary.json. 비교: npm run sweep:compare -- <전 폴더> <후 폴더> [--fail-on-change]`;

export interface SweepArgs {
  dirs: string[];
  out: string;
  jobs: number;
  limit: number | null;
  force: boolean;
  /** 병렬 훑기의 자식 프로세스(내부용): 할 일 목록 파일과 결과 파일 */
  child: { queue: string; out: string } | null;
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

/** 인자 읽기. "--" 구분자는 건너뛴다. 폴더는 --dirs(여러 번 줄 수 있음) 또는 환경 변수 OPENCAD_SWEEP_DIRS */
export function parseSweepArgs(argv: readonly string[], env: Record<string, string | undefined> = {}, now = new Date()): SweepArgs {
  const a: SweepArgs = { dirs: [], out: '', jobs: 1, limit: null, force: false, child: null };
  const split = (v: string): string[] => v.split(':').map((s) => s.trim()).filter(Boolean);
  const num = (v: string | undefined, name: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name}에는 1 이상의 정수를 주십시오: ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (k === '--') continue;
    const [flag, inline] = k.startsWith('--') && k.includes('=') ? [k.slice(0, k.indexOf('=')), k.slice(k.indexOf('=') + 1)] : [k, undefined];
    const val = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag} 값이 없습니다`);
      return v;
    };
    if (flag === '--dirs') a.dirs.push(...split(val()));
    else if (flag === '--out') a.out = val();
    else if (flag === '--jobs') a.jobs = num(val(), '--jobs');
    else if (flag === '--limit') a.limit = num(val(), '--limit');
    else if (flag === '--force') a.force = true;
    else if (flag === '--child') {
      const queue = val();
      a.child = { queue, out: argv[++i] ?? '' };
    } else throw new Error(`모르는 인자: ${k}`);
  }
  if (!a.dirs.length && env.OPENCAD_SWEEP_DIRS) a.dirs = split(env.OPENCAD_SWEEP_DIRS);
  if (!a.out) a.out = join('.runtime', 'sweep', `run-${stamp(now)}`);
  return a;
}

/** 훑을 파일 하나 */
export interface SweepFile {
  path: string;
  name: string;
  ext: string;
}

const extOf = (name: string): string => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase();

/** 폴더를 재귀로 훑어 앱이 여는 확장자의 파일을 모은다(이름 차례, node_modules·.git·링크 폴더는 건너뜀) */
export function listFiles(dirs: readonly string[], maxDepth = 24): SweepFile[] {
  const out: SweepFile[] = [];
  const walk = (dir: string, depth: number): void => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && e.name !== 'node_modules' && e.name !== '.git') walk(p, depth + 1);
      } else if (e.isFile()) {
        const ext = extOf(e.name);
        if (SWEEP_EXTENSIONS.has(ext)) out.push({ path: p, name: e.name, ext });
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  return out;
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * .h가 Heidenhain 평문이 아니라 C 머리 파일인지(훑기에서 뺀다). 앱은 .h를 확장자만으로 Heidenhain으로 보므로
 * 확장자 없이 내용만으로 판별해 Heidenhain 표지(BEGIN PGM 등)가 없고 C 전처리 줄이 있으면 C 머리 파일로 본다
 */
export function isCHeader(name: string, bytes: Uint8Array): boolean {
  if (extOf(name) !== 'h' || detectNcFormat('content-only', bytes) === 'heidenhain') return false;
  return /#\s*(ifndef|ifdef|include|define|pragma)\b/.test(new TextDecoder().decode(bytes.subarray(0, 2000)));
}

/** 경고·오류 글 → 코드(줄 번호·수·따옴표 값을 지운 틀). 같은 원인의 경고를 파일이 달라도 하나로 센다 */
export function messageCode(text: string): string {
  return text
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/[-+]?\d+(\.\d+)?/g, '#')
    .replace(/^[^:<]{1,40}:(?=\s)/, (m) => (/[가-힣]/.test(m) ? m : '…:'))
    .slice(0, 160);
}

export type SweepClass = 'ok' | 'warn' | 'empty' | 'error';

/** 파일 하나의 결과(records.jsonl 한 줄) */
export interface SweepRecord {
  sha: string;
  ext: string;
  size: number;
  /** 첫 경로(로컬 결과에만 — 저장소·보고에 옮기지 않는다) */
  path?: string;
  /** 같은 내용의 다른 경로 수 */
  dups?: number;
  cls: SweepClass;
  /** 해석한 형식(gcode·heidenhain·mpr·pgi·xml), 예외면 없음 */
  kind?: string;
  /** 판별: G-code·Heidenhain은 방언(선반이면 :lathe), MPR은 VERSION */
  format?: string;
  ms: number;
  /** 비교에 쓰는 품질 지표(시간 빼고) */
  metrics: Record<string, number>;
  /** 경고 코드 → 횟수 */
  warnings: Record<string, number>;
  error?: { code: string; message: string };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** FNV-1a 32비트(바이트 열 이어 받기) */
function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619) >>> 0;
  return h;
}
const enc = new TextEncoder();
const bytesOf = (a: ArrayBufferView | undefined): Uint8Array => (a ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(0));

/**
 * 장면 서명 둘(비교용 — 해석 결과가 한 비트라도 바뀌면 달라진다):
 * sceneSig = 묶음 id·이름·무리·개수, geomSig = 좌표(float32 비트)·색인·원본 번호(segmentIds·pointIds)
 */
export function sceneSignatures(s: { meshes: readonly { id: string; name?: string; group?: string; positions: Float32Array; indices?: ArrayBufferView }[]; lines: readonly { id: string; name?: string; group?: string; positions: Float32Array; segmentIds?: ArrayBufferView }[]; points?: readonly { id: string; name?: string; group?: string; positions: Float32Array; pointIds?: ArrayBufferView }[] }): { sceneSig: number; geomSig: number } {
  let a = 2166136261;
  let b = 2166136261;
  const items = [...s.meshes.map((m) => ['m', m, m.indices] as const), ...s.lines.map((l) => ['l', l, l.segmentIds] as const), ...(s.points ?? []).map((p) => ['p', p, p.pointIds] as const)];
  for (const [k, it, extra] of items) {
    a = fnv(a, enc.encode(`${k}|${it.id}|${it.name ?? ''}|${it.group ?? ''}|${it.positions.length}|${extra ? (extra as unknown as ArrayLike<number>).length : -1};`));
    b = fnv(fnv(b, bytesOf(it.positions)), bytesOf(extra));
  }
  return { sceneSig: a, geomSig: b };
}

/** 파일 하나를 앱 워커와 같은 길(parseForView)로 해석해 결과를 만든다(경로는 넣지 않는다) */
export function sweepOne(name: string, bytes: Uint8Array, sha = sha256(bytes)): SweepRecord {
  const rec: SweepRecord = { sha, ext: extOf(name), size: bytes.length, cls: 'ok', ms: 0, metrics: {}, warnings: {} };
  const t0 = performance.now();
  try {
    const r = parseForView(name, bytes.slice());
    rec.ms = r3(performance.now() - t0);
    rec.kind = r.kind;
    const s = r.scene;
    const m = rec.metrics;
    m.segments = s.lines.reduce((n, l) => n + l.positions.length / 6, 0);
    m.triangles = s.meshes.reduce((n, x) => n + (x.indices ? x.indices.length / 3 : x.positions.length / 9), 0);
    m.points = (s.points ?? []).reduce((n, p) => n + p.positions.length / 3, 0);
    const meta = (s.meta ?? {}) as Record<string, unknown>;
    if (r.nc) {
      const st = r.nc.stats;
      m.moves = r.nc.moves.count;
      m.tools = r.nc.tools.length;
      m.arcs = st.arcCount;
      m.holes = st.holeCount;
      m.lines = r.nc.source.lineCount;
      m.feedLength = r3(st.feedLength);
      m.rapidLength = r3(st.rapidLength);
      m.timeSec = Math.round(st.time * 100) / 100;
      rec.format = `${r.nc.dialect}${meta.lathe ? ':lathe' : ''}`;
    } else {
      const ops = (meta.operations ?? []) as { kind: string; enabled: boolean }[];
      const st = (meta.stats ?? {}) as Record<string, number>;
      m.ops = ops.length;
      m.otherOps = ops.filter((o) => o.kind === 'other').length;
      m.disabledOps = ops.filter((o) => !o.enabled).length;
      m.holes = st.holes ?? 0;
      m.contours = Number(meta.contourCount ?? 0);
      m.workpiece = meta.workpiece ? 1 : 0;
      m.lines = Number(meta.lineCount ?? 0);
      if (typeof meta.version === 'string' && meta.version) rec.format = meta.version;
    }
    const b = s.bounds;
    if (b) [...b.min, ...b.max].forEach((v, i) => (m[`bounds${i}`] = r3(v)));
    Object.assign(m, sceneSignatures(s));
    for (const w of s.warnings ?? []) {
      const c = messageCode(w);
      rec.warnings[c] = (rec.warnings[c] ?? 0) + 1;
    }
    m.warnings = (s.warnings ?? []).length;
    rec.cls = m.segments + m.triangles + m.points === 0 ? 'empty' : m.warnings > 0 ? 'warn' : 'ok';
  } catch (e) {
    rec.ms = r3(performance.now() - t0);
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    rec.cls = 'error';
    rec.error = { code: messageCode(message), message };
  }
  return rec;
}

/** 훑을 목록 만들기: 확장자 거르기 → 내용 해시로 중복 빼기 → C 머리 파일 빼기 → limit */
export function uniqueFiles(files: readonly SweepFile[], limit: number | null = null): { items: (SweepFile & { sha: string; size: number; dups: number })[]; found: number; duplicates: number; skipped: Record<string, number> } {
  const byHash = new Map<string, SweepFile & { sha: string; size: number; dups: number }>();
  let duplicates = 0;
  const skipped: Record<string, number> = { cHeader: 0, unreadable: 0 };
  for (const f of files) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(f.path));
    } catch {
      skipped.unreadable!++;
      continue;
    }
    const sha = sha256(bytes);
    const seen = byHash.get(sha);
    if (seen) {
      seen.dups++;
      duplicates++;
      continue;
    }
    if (isCHeader(f.name, bytes)) {
      skipped.cHeader!++;
      continue;
    }
    byHash.set(sha, { ...f, sha, size: bytes.length, dups: 0 });
  }
  let items = [...byHash.values()];
  if (limit !== null) items = items.slice(0, limit);
  return { items, found: files.length, duplicates, skipped };
}

/** 할 일 목록을 해석한다(경로·중복 수를 붙인다) */
export function sweepItems(items: readonly (SweepFile & { sha: string; dups: number })[]): SweepRecord[] {
  return items.map((f) => {
    const rec = sweepOne(f.name, new Uint8Array(readFileSync(f.path)), f.sha);
    rec.path = f.path;
    if (f.dups) rec.dups = f.dups;
    return rec;
  });
}

/** 백분위(가장 가까운 순위) */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const count = (m: Record<string, number>, k: string, n = 1): void => {
  m[k] = (m[k] ?? 0) + n;
};
const sortedObj = <T>(m: Record<string, T>, by: (v: T) => number): Record<string, T> => Object.fromEntries(Object.entries(m).sort((x, y) => by(y[1]) - by(x[1]) || (x[0] < y[0] ? -1 : 1)));

export interface SweepSummary {
  done: true;
  tool: 'opencad-nc sweep';
  dirs: number;
  found: number;
  duplicates: number;
  unique: number;
  skipped: Record<string, number>;
  classes: Record<SweepClass, number>;
  kinds: Record<string, number>;
  formats: Record<string, number>;
  errors: Record<string, number>;
  warnings: Record<string, { files: number; count: number }>;
  timeMs: { p50: number; p90: number; p99: number; max: number; total: number };
  byKind: Record<string, { n: number; p50: number; p90: number; max: number }>;
  quality: Record<string, number>;
  slowest: { sha: string; ext: string; size: number; ms: number }[];
}

/** 결과 요약(summary.json) */
export function summarize(records: readonly SweepRecord[], info: { dirs: number; found: number; duplicates: number; skipped: Record<string, number> }): SweepSummary {
  const classes: Record<SweepClass, number> = { ok: 0, warn: 0, empty: 0, error: 0 };
  const kinds: Record<string, number> = {};
  const formats: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const warnings: Record<string, { files: number; count: number }> = {};
  const times: Record<string, number[]> = {};
  const q: Record<string, number> = { moves: 0, arcs: 0, ops: 0, otherOps: 0, filesWithOtherOps: 0, disabledOps: 0 };
  for (const r of records) {
    classes[r.cls]++;
    const k = r.kind ?? `error:${r.ext}`;
    count(kinds, k);
    if (r.kind) count(formats, r.format ? `${r.kind}:${r.format}` : r.kind);
    if (r.error) count(errors, r.error.code);
    for (const [c, n] of Object.entries(r.warnings)) {
      const w = (warnings[c] ??= { files: 0, count: 0 });
      w.files++;
      w.count += n;
    }
    (times[k] ??= []).push(r.ms);
    q.moves! += r.metrics.moves ?? 0;
    q.arcs! += r.metrics.arcs ?? 0;
    q.ops! += r.metrics.ops ?? 0;
    q.otherOps! += r.metrics.otherOps ?? 0;
    q.disabledOps! += r.metrics.disabledOps ?? 0;
    if (r.metrics.otherOps) q.filesWithOtherOps!++;
  }
  const all = records.map((r) => r.ms).sort((a, b) => a - b);
  const n = records.length;
  q.parsedShare = n ? r3((n - classes.error) / n) : 0;
  q.cleanShare = n ? r3(classes.ok / n) : 0;
  // 판재 가공 중 그리는 가공의 몫(지원하지 않는 매크로가 아닌 것)
  q.supportedOpsShare = q.ops ? r3(1 - q.otherOps! / q.ops) : 1;
  return {
    done: true,
    tool: 'opencad-nc sweep',
    dirs: info.dirs,
    found: info.found,
    duplicates: info.duplicates,
    unique: n,
    skipped: info.skipped,
    classes,
    kinds: sortedObj(kinds, (v) => v),
    formats: sortedObj(formats, (v) => v),
    errors: sortedObj(errors, (v) => v),
    warnings: sortedObj(warnings, (v) => v.files),
    timeMs: { p50: percentile(all, 50), p90: percentile(all, 90), p99: percentile(all, 99), max: all.at(-1) ?? 0, total: r3(all.reduce((s, v) => s + v, 0)) },
    byKind: Object.fromEntries(
      Object.entries(times).map(([k, t]) => {
        const s = t.sort((a, b) => a - b);
        return [k, { n: s.length, p50: percentile(s, 50), p90: percentile(s, 90), max: s.at(-1) ?? 0 }];
      }),
    ),
    quality: q,
    slowest: [...records].sort((a, b) => b.ms - a.ms).slice(0, 8).map((r) => ({ sha: r.sha.slice(0, 16), ext: r.ext, size: r.size, ms: r.ms })),
  };
}

/** records.jsonl 읽기·쓰기 */
export const toJsonl = (records: readonly SweepRecord[]): string => records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
export const fromJsonl = (text: string): SweepRecord[] =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SweepRecord);

export interface SweepComparison {
  before: { unique: number; classes: Record<string, number> };
  after: { unique: number; classes: Record<string, number> };
  common: number;
  added: number;
  removed: number;
  /** 분류(ok·warn·empty·error)나 형식이 바뀐 파일 */
  classChanged: number;
  classChanges: { sha: string; ext: string; from: string; to: string }[];
  /** 지표·경고 코드·판별이 바뀐 파일(분류는 같아도) */
  metricChanged: number;
  metricChanges: { sha: string; ext: string; fields: Record<string, [unknown, unknown]> }[];
  /** 전에는 읽던(또는 다른 오류이던) 파일의 새 예외 */
  newErrors: { sha: string; ext: string; code: string }[];
  fixedErrors: { sha: string; ext: string; code: string }[];
  /** 경고 코드별 파일 수가 바뀐 것: [전, 후] */
  warningCodes: Record<string, [number, number]>;
  changed: boolean;
}

const clsOf = (r: SweepRecord): string => `${r.cls}${r.kind ? `:${r.kind}` : ''}`;

/** 두 훑기 결과 비교(같은 내용 해시끼리). top = 목록에 남길 수 */
export function compareRuns(before: readonly SweepRecord[], after: readonly SweepRecord[], top = 20): SweepComparison {
  const A = new Map(before.map((r) => [r.sha, r]));
  const B = new Map(after.map((r) => [r.sha, r]));
  const out: SweepComparison = {
    before: { unique: before.length, classes: {} },
    after: { unique: after.length, classes: {} },
    common: 0,
    added: 0,
    removed: 0,
    classChanged: 0,
    classChanges: [],
    metricChanged: 0,
    metricChanges: [],
    newErrors: [],
    fixedErrors: [],
    warningCodes: {},
    changed: false,
  };
  for (const r of before) count(out.before.classes, r.cls);
  for (const r of after) count(out.after.classes, r.cls);
  const wa: Record<string, number> = {};
  const wb: Record<string, number> = {};
  for (const r of before) for (const c of Object.keys(r.warnings)) count(wa, c);
  for (const r of after) for (const c of Object.keys(r.warnings)) count(wb, c);
  for (const c of new Set([...Object.keys(wa), ...Object.keys(wb)])) if ((wa[c] ?? 0) !== (wb[c] ?? 0)) out.warningCodes[c] = [wa[c] ?? 0, wb[c] ?? 0];
  for (const r of after) if (!A.has(r.sha)) out.added++;
  for (const r of before) if (!B.has(r.sha)) out.removed++;
  for (const a of before) {
    const b = B.get(a.sha);
    if (!b) continue;
    out.common++;
    const sha = a.sha.slice(0, 16);
    if (clsOf(a) !== clsOf(b)) {
      out.classChanged++;
      if (out.classChanges.length < top) out.classChanges.push({ sha, ext: a.ext, from: clsOf(a), to: clsOf(b) });
    }
    if (b.error && b.error.code !== a.error?.code) out.newErrors.push({ sha, ext: b.ext, code: b.error.code });
    if (a.error && a.error.code !== b.error?.code) out.fixedErrors.push({ sha, ext: a.ext, code: a.error.code });
    const fields: Record<string, [unknown, unknown]> = {};
    for (const k of new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])) if (a.metrics[k] !== b.metrics[k]) fields[k] = [a.metrics[k], b.metrics[k]];
    if ((a.format ?? '') !== (b.format ?? '')) fields.format = [a.format, b.format];
    const wk = (r: SweepRecord): string => JSON.stringify(Object.entries(r.warnings).sort());
    if (wk(a) !== wk(b)) fields.warnings = [a.warnings, b.warnings];
    if (Object.keys(fields).length) {
      out.metricChanged++;
      if (out.metricChanges.length < top) out.metricChanges.push({ sha, ext: a.ext, fields });
    }
  }
  out.changed = out.classChanged > 0 || out.metricChanged > 0 || out.newErrors.length > 0 || out.added > 0 || out.removed > 0;
  return out;
}

export const COMPARE_USAGE = '쓰는 법: npm run sweep:compare -- <전 결과 폴더> <후 결과 폴더> [--top N] [--json <파일>] [--fail-on-change]';

/**
 * sweep:compare 본체(compare.ts가 부른다): 두 결과 폴더의 records.jsonl을 견주어 글로 알리고, 끝낼 값을 돌려준다
 * (--fail-on-change면 바뀐 것이 있을 때 1, 인자가 틀리면 2, 그 밖 0)
 */
export function compareMain(argv: readonly string[], log: (s: string) => void = console.log): number {
  const dirs: string[] = [];
  let top = 20;
  let json: string | null = null;
  let fail = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a === '--fail-on-change') fail = true;
    else if (a === '--top') top = Math.max(1, Number(argv[++i]) || 20);
    else if (a === '--json') json = argv[++i] ?? null;
    else if (a.startsWith('--')) {
      log(`모르는 인자: ${a}\n${COMPARE_USAGE}`);
      return 2;
    } else dirs.push(a);
  }
  if (dirs.length !== 2) {
    log(COMPARE_USAGE);
    return dirs.length ? 2 : 0;
  }
  const read = (d: string) => fromJsonl(readFileSync(join(d, 'records.jsonl'), 'utf8'));
  const c = compareRuns(read(dirs[0]!), read(dirs[1]!), top);
  log(`전 ${c.before.unique}개 ${JSON.stringify(c.before.classes)} → 후 ${c.after.unique}개 ${JSON.stringify(c.after.classes)}`);
  log(`같은 내용 ${c.common}개 · 후에만 ${c.added} · 전에만 ${c.removed}`);
  log(`분류가 바뀐 파일 ${c.classChanged}개`);
  for (const x of c.classChanges) log(`  ${x.sha} .${x.ext} ${x.from} → ${x.to}`);
  log(`지표가 바뀐 파일 ${c.metricChanged}개`);
  for (const x of c.metricChanges) log(`  ${x.sha} .${x.ext} ${JSON.stringify(x.fields).slice(0, 400)}`);
  log(`새 예외 ${c.newErrors.length}개${c.newErrors.length ? ': ' + JSON.stringify(c.newErrors.slice(0, top)) : ''}`);
  log(`없어진 예외 ${c.fixedErrors.length}개`);
  const wc = Object.entries(c.warningCodes);
  log(`파일 수가 바뀐 경고 코드 ${wc.length}개`);
  for (const [k, [a, b]] of wc.slice(0, top)) log(`  ${a} → ${b}  ${k}`);
  if (json) writeFileSync(json, JSON.stringify(c, null, 1) + '\n');
  log(c.changed ? '바뀐 것이 있습니다.' : '바뀐 것이 없습니다.');
  return fail && c.changed ? 1 : 0;
}
