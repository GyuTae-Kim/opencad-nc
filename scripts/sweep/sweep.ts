/**
 * 실제 파일 훑기(읽기만): npm run sweep -- [--dirs <폴더1>:<폴더2>] [--out .runtime/sweep/<이름>] [--jobs N] [--limit N] [--force]
 * 표본 폴더는 --dirs 또는 OPENCAD_SWEEP_DIRS(쌍점 구분). 둘 다 없으면 쓰는 법만 찍고 0으로 끝난다(CI에서 돌지 않는다).
 * 앱 워커와 같은 해석 길(parseForView)로 읽어 <out>/records.jsonl·summary.json을 쓴다(core.ts).
 * --jobs N이면 할 일을 N개 자식 프로세스(같은 스크립트 --child)로 나눠 해석하고 합친다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE, fromJsonl, listFiles, parseSweepArgs, summarize, sweepItems, toJsonl, uniqueFiles, type SweepFile, type SweepRecord } from './core';

const HERE = dirname(fileURLToPath(import.meta.url));
const VITE_NODE = resolve(HERE, '../../node_modules/vite-node/vite-node.mjs');

type Item = SweepFile & { sha: string; size: number; dups: number };

/** 자식 프로세스 N개로 나눠 해석(차례를 섞지 않게 나눈 몫마다 결과 파일) */
async function runJobs(items: Item[], jobs: number, out: string): Promise<SweepRecord[]> {
  const parts: Item[][] = Array.from({ length: jobs }, () => []);
  items.forEach((it, i) => parts[i % jobs]!.push(it));
  const tmp = join(out, '.jobs');
  mkdirSync(tmp, { recursive: true });
  const runs = parts.map(
    (part, k) =>
      new Promise<SweepRecord[]>((res, rej) => {
        const queue = join(tmp, `queue-${k}.json`);
        const result = join(tmp, `records-${k}.jsonl`);
        writeFileSync(queue, JSON.stringify(part));
        const child = spawn(process.execPath, [VITE_NODE, fileURLToPath(import.meta.url), '--', '--child', queue, result], { stdio: ['ignore', 'ignore', 'inherit'] });
        child.on('error', rej);
        child.on('exit', (code) => (code === 0 ? res(fromJsonl(readFileSync(result, 'utf8'))) : rej(new Error(`자식 훑기 ${k}가 ${code}로 끝남`))));
      }),
  );
  try {
    return (await Promise.all(runs)).flat();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseSweepArgs(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error(USAGE);
    return 2;
  }
  if (args.child) {
    const items = JSON.parse(readFileSync(args.child.queue, 'utf8')) as Item[];
    writeFileSync(args.child.out, toJsonl(sweepItems(items)));
    return 0;
  }
  if (!args.dirs.length) {
    console.log(USAGE);
    return 0;
  }
  const missing = args.dirs.filter((d) => !existsSync(d) || !statSync(d).isDirectory());
  if (missing.length) {
    console.error(`폴더가 아닙니다: ${missing.length}개`);
    return 2;
  }
  const out = resolve(args.out);
  if (existsSync(join(out, 'records.jsonl')) && !args.force) {
    console.error(`${args.out}에 이미 결과가 있습니다(기준 결과를 지키려고 덮어쓰지 않음). 다른 --out을 주거나 --force`);
    return 2;
  }
  mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  const files = listFiles(args.dirs);
  const u = uniqueFiles(files, args.limit);
  const jobs = Math.max(1, Math.min(args.jobs, u.items.length));
  let records = jobs > 1 ? await runJobs(u.items, jobs, out) : sweepItems(u.items);
  records = records.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const summary = summarize(records, { dirs: args.dirs.length, found: u.found, duplicates: u.duplicates, skipped: u.skipped });
  writeFileSync(join(out, 'records.jsonl'), toJsonl(records));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ ...summary, jobs, limit: args.limit, wallMs: Math.round(performance.now() - t0) }, null, 1) + '\n');
  const size = statSync(join(out, 'records.jsonl')).size;
  console.log(`찾음 ${summary.found} · 같은 내용 ${summary.duplicates} · 훑음 ${summary.unique} · 뺌 ${JSON.stringify(summary.skipped)}`);
  console.log(`분류 ${JSON.stringify(summary.classes)}`);
  console.log(`형식 ${JSON.stringify(summary.kinds)}`);
  console.log(`예외 ${JSON.stringify(summary.errors)}`);
  console.log(`경고 코드 ${Object.keys(summary.warnings).length}개(파일 수 많은 차례):`);
  for (const [c, w] of Object.entries(summary.warnings).slice(0, 12)) console.log(`  ${w.files}개 파일 · ${w.count}번  ${c}`);
  console.log(`해석 시간 ms ${JSON.stringify(summary.timeMs)}`);
  console.log(`결과: ${join(args.out, 'records.jsonl')}(${(size / 1024).toFixed(1)} KiB), ${join(args.out, 'summary.json')}`);
  // 8 MiB가 넘으면 일회성 결과로 지워질 수 있다 — 비교 기준으로 남길 결과는 .keep 표시
  if (size >= 8 * 1024 * 1024) console.log('records.jsonl이 8 MiB 이상입니다. 비교 기준으로 남기려면 records.jsonl.keep 파일을 함께 두십시오.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
