/**
 * 여러 파일을 한 작업으로 잇기: 주 프로그램 뒤에 나머지 파일(부프로그램·CALL PGM으로 부르는 프로그램)을
 * "함께 연 파일" 줄(JOB_FILE_MARK)로 나눠 붙인다. 해석기는 이 줄에서 주 프로그램을 끝내고(다음 파일로 넘어가지 않음),
 * 부프로그램 번호·이름을 이은 글 전체에서 찾는다(G-code M98·G65 P O번호 — O 줄이 없으면 파일 이름 O1001.nc,
 * LinuxCNC o<이름> call, Siemens 이름·L번호(파일 이름), Heidenhain CALL PGM·DIN/ISO %이름).
 *
 * 주 프로그램: 고르지 않으면 다른 파일이 부르지 않는 파일 가운데 부르기가 가장 많은 것(Siemens .MPF, M30·M2로 끝나는 파일 우선),
 * 없으면 첫 파일. 이은 글은 splitNcJob으로 다시 나눌 수 있다(주 프로그램 바꾸기·파일 더하기).
 * 형식이 다른 파일(MPR, G-code 작업의 Heidenhain 파일 등)은 잇지 않고 skipped로 돌려준다.
 */
import { detectGcodeDialect } from './gcode';
import { JOB_FILE_MARK } from './model';

export type JobKind = 'gcode' | 'heidenhain' | 'mpr';

export interface NcJobFile {
  name: string;
  bytes: Uint8Array;
}

export interface NcJob {
  /** 주 프로그램 파일 이름(이은 글의 이름) */
  main: string;
  /** 이은 차례의 파일 이름(주 프로그램 먼저) */
  files: string[];
  /** 형식이 달라 잇지 않은 파일 */
  skipped: string[];
  /** 이은 글(UTF-8 BOM은 떼고 바이트 그대로 잇는다) */
  bytes: Uint8Array;
}

const latin1 = (b: Uint8Array, n = 65536): string => new TextDecoder('latin1').decode(b.subarray(0, n));
const baseName = (name: string): string => name.replace(/^.*[\\/:]/, '');
const stem = (name: string): string => baseName(name).replace(/\.[^.]*$/, '').toUpperCase();
const ext = (name: string): string => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** 파일이 정의하는 프로그램 이름·번호(대문자 글) */
function defines(name: string, text: string): Set<string> {
  const out = new Set<string>([stem(name)]);
  const fileNum = /^O?(\d+)$/i.exec(stem(name));
  if (fileNum) out.add(`O${+fileNum[1]!}`);
  for (const m of text.matchAll(/^\s*[O:](\d+)\b/gim)) out.add(`O${+m[1]!}`);
  for (const m of text.matchAll(/^\s*(?:\d+\s+)?BEGIN\s+PGM\s+"?([^\s"]+)/gim)) out.add(stem(m[1]!));
  for (const m of text.matchAll(/^\s*%([^\s*;(]+)\s+G7[01]\b/gim)) out.add(stem(m[1]!));
  for (const m of text.matchAll(/^\s*%_N_([A-Z0-9_]+?)_(?:MPF|SPF)\b/gim)) out.add(m[1]!.toUpperCase());
  for (const m of text.matchAll(/^\s*o<([^>]+)>\s*sub\b/gim)) out.add(`<${m[1]!.toUpperCase()}>`);
  for (const m of text.matchAll(/^\s*(?:N\d+\s+)?PROC\s+([A-Z_][A-Z0-9_]*)/gim)) out.add(m[1]!.toUpperCase());
  return out;
}

/** 파일이 부르는 프로그램 이름·번호 */
function calls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:M98|G65)\s*P\s*(\d+)/gi)) {
    out.push(`O${+m[1]!}`);
    // M98 P30010 = 3번 O0010(Fanuc 꼴)
    if (m[1]!.length > 4) out.push(`O${+m[1]!.slice(-4)}`);
  }
  for (const m of text.matchAll(/\bCALL\s+PGM\s+"?([^\s"]+)/gi)) out.push(stem(m[1]!));
  for (const m of text.matchAll(/\bo<([^>]+)>\s*call\b/gi)) out.push(`<${m[1]!.toUpperCase()}>`);
  // Siemens: L123(부프로그램 번호), CALL "이름", 줄 첫머리의 이름(인수) 부르기
  for (const m of text.matchAll(/(?:^|\s)L(\d+)\b/gm)) out.push(`L${m[1]!}`, m[1]!);
  for (const m of text.matchAll(/\b(?:M?CALL)\s+"([^"]+)"/gi)) out.push(stem(m[1]!));
  for (const m of text.matchAll(/^\s*(?:N\d+\s+)?([A-Z_][A-Z0-9_]{2,})\s*(?:\(|$)/gim)) out.push(m[1]!.toUpperCase());
  return out;
}

/** 주석 구분 줄(G-code는 괄호, Siemens·Heidenhain은 ;) */
function markLine(name: string, semicolon: boolean): string {
  const n = baseName(name).replace(/[()\r\n]/g, '_');
  return semicolon ? `; ${JOB_FILE_MARK} ${n}\n` : `(${JOB_FILE_MARK} ${n})\n`;
}

/**
 * 여러 파일을 한 작업으로 잇는다. kindOf = 파일 형식 판별(index.ts의 detectNcFormat). main = 주 프로그램 파일 이름(없으면 고른다)
 */
export function combineNcJob(files: NcJobFile[], kindOf: (name: string, bytes: Uint8Array) => JobKind | null, main?: string): NcJob {
  if (!files.length) throw new Error('파일이 없습니다.');
  const info = files.map((f) => {
    const text = latin1(f.bytes, 4 << 20);
    return { f, text, kind: kindOf(f.name, f.bytes) ?? 'gcode', defs: defines(f.name, text), calls: calls(text) };
  });
  let mi = main !== undefined ? info.findIndex((x) => x.f.name === main) : -1;
  if (mi < 0) {
    // 다른 파일이 부르지 않는 파일 가운데 부르기가 가장 많은 것(MPR은 주 프로그램으로 고르지 않는다)
    let best = -1;
    let bestScore = -Infinity;
    info.forEach((x, i) => {
      if (x.kind === 'mpr') return;
      const called = info.some((y, j) => j !== i && y.calls.some((c) => x.defs.has(c)));
      const own = x.calls.filter((c) => info.some((y, j) => j !== i && y.defs.has(c))).length;
      const e = ext(x.f.name);
      // 프로그램 끝(M30·M2)은 주 프로그램, 부르는 곳으로 돌아가기(M99·M17·RET)는 부프로그램 쪽
      const ends = (/\bM0?(?:30|2)\b/i.test(x.text) ? 3 : 0) - (/\b(?:M99|M17|RET)\b/i.test(x.text) ? 3 : 0);
      const score = (called ? -1000 : 0) + own * 10 + (e === 'mpf' ? 5 : e === 'spf' ? -5 : 0) + ends - i * 0.001;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    mi = best < 0 ? 0 : best;
  }
  const m = info[mi]!;
  const semicolon = m.kind === 'heidenhain' || detectGcodeDialect(m.text.slice(0, 65536)) === 'siemens';
  const parts: Uint8Array[] = [];
  const order: string[] = [m.f.name];
  const skipped: string[] = [];
  const enc = new TextEncoder();
  const body = (b: Uint8Array): Uint8Array => (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b);
  const push = (b: Uint8Array): void => {
    parts.push(b);
    if (b.length && b[b.length - 1] !== 10) parts.push(enc.encode('\n'));
  };
  push(m.f.bytes);
  info.forEach((x, i) => {
    if (i === mi) return;
    if (x.kind !== m.kind || m.kind === 'mpr') {
      skipped.push(x.f.name);
      return;
    }
    parts.push(enc.encode(markLine(x.f.name, semicolon)));
    push(body(x.f.bytes));
    order.push(x.f.name);
  });
  const total = parts.reduce((s, p) => s + p.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { main: m.f.name, files: order, skipped, bytes };
}

/** 표지 줄이면 그 파일 이름(아니면 null): 앞 공백, "(" 또는 ";", 공백, JOB_FILE_MARK, 이름[")"] */
function markName(b: Uint8Array, s: number, e: number): string | null {
  let k = s;
  while (k < e && (b[k] === 32 || b[k] === 9)) k++;
  if (b[k] !== 40 && b[k] !== 59) return null;
  k++;
  while (k < e && b[k] === 32) k++;
  if (e - k < JOB_FILE_MARK.length) return null;
  for (let j = 0; j < JOB_FILE_MARK.length; j++) if (b[k + j] !== JOB_FILE_MARK.charCodeAt(j)) return null;
  return new TextDecoder()
    .decode(b.subarray(k + JOB_FILE_MARK.length, e))
    .replace(/\r$/, '')
    .replace(/\)\s*$/, '')
    .trim();
}

/**
 * 이은 글을 다시 파일로 나눈다(주 프로그램을 바꿔 다시 잇거나 파일을 더할 때). 첫 파일 이름 = name.
 * 표지 줄이 없으면 null
 */
export function splitNcJob(name: string, bytes: Uint8Array): NcJobFile[] | null {
  const out: NcJobFile[] = [];
  let cur = name;
  let start = 0;
  for (let i = 0; i < bytes.length; ) {
    let e = bytes.indexOf(10, i);
    if (e < 0) e = bytes.length;
    const nm = markName(bytes, i, e);
    if (nm !== null) {
      out.push({ name: cur, bytes: bytes.subarray(start, i) });
      cur = nm;
      start = e + 1;
    }
    i = e + 1;
  }
  if (!out.length) return null;
  out.push({ name: cur, bytes: bytes.subarray(Math.min(start, bytes.length)) });
  return out;
}
