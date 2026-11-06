/**
 * 퍼징용 NC 프로그램 바꾸기(씨앗 고정 — 같은 입력·종류·씨앗이면 같은 바이트). 저장소 시험(tests/fuzz.test.ts)과 로컬 대량 퍼징이 함께 쓴다.
 *
 * 종류: 자르기 · 바이트 바꾸기 · 문법 글자 넣기 · 숫자 극값(1e300·1e999·NaN 글·아주 긴 숫자) · 아주 긴 블록 · 깊은 괄호 ·
 * 부프로그램 자기 부름(M98·G65·o-code·CALL·CALL LBL) · 매크로 변수 극값(#1=1e300·0으로 나누기·Q·R 변수) · 끝없는 고리(WHILE·GOTO·LOOP·REP) ·
 * 조각 옮기기·겹치기 · 줄 지우기·늘리기.
 * 글은 Latin-1 한 글자 = 한 바이트로 다룬다(UTF-8 바이트도 그대로 오간다). 방언별 조각은 글로 판별한 갈래(gcode·heidenhain·siemens·panel)에 맞춘다.
 */

export type NcMutationKind = 'truncate' | 'bytes' | 'syntax' | 'number' | 'longblock' | 'nest' | 'recursion' | 'macro' | 'loop' | 'splice' | 'lines';

export const NC_MUTATION_KINDS: readonly NcMutationKind[] = ['truncate', 'bytes', 'syntax', 'number', 'longblock', 'nest', 'recursion', 'macro', 'loop', 'splice', 'lines'];

export interface NcMutation {
  bytes: Uint8Array;
  kind: NcMutationKind;
  /** 무엇을 바꿨는지 짧게(보고·재현용) */
  detail: string;
}

/** 씨앗 고정 난수(mulberry32) — 0 이상 1 미만 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(r: Rand, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
const int = (r: Rand, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

export function toText(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)));
  return s;
}
export function toBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** 글의 갈래(방언별 조각을 고른다) */
export type NcFlavor = 'gcode' | 'linuxcnc' | 'siemens' | 'heidenhain' | 'mpr' | 'xml';

export function flavorOf(text: string): NcFlavor {
  const head = text.slice(0, 65536);
  if (/^\s*\[H\b/m.test(head) || /<\d+\s*\\/.test(head)) return 'mpr';
  if (/<\s*(pgi|KDTPanelFormat)\b/i.test(head)) return 'xml';
  if (/\bBEGIN\s+PGM\b/i.test(head) || /^\s*\d+\s+(?:L|CYCL|TOOL|LBL|CC|C|CR|FN|Q\d)\b/im.test(head)) return 'heidenhain';
  if (/^\s*o\s*(?:<\w+>|\d+)\s+(?:sub|call|while|if|repeat)\b/im.test(head)) return 'linuxcnc';
  if (/\b(?:CYCLE\d+|POCKET\d|SLOT\d|MSG\s*\(|DEF\s+REAL|R\d+\s*=|G64|TRANS|AROT|PROC)\b/.test(head)) return 'siemens';
  return 'gcode';
}

/** 숫자 자리 [시작, 끝)(앞 부호·소수점·지수 포함) */
function numbers(t: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    out.push([m.index, m.index + m[0].length]);
    if (out.length > 200_000) break;
  }
  return out;
}

/** 줄 시작 자리들 */
function lineStarts(t: string): number[] {
  const out = [0];
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10 && i + 1 < t.length) out.push(i + 1);
  return out;
}

/** 겹치지 않는 고치기 [시작, 끝, 바꿀 글]을 뒤에서부터 적용 */
function apply(text: string, edits: [number, number, string][]): string {
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = text;
  let limit = Infinity;
  for (const [s, e, r] of edits) {
    if (e > limit) continue;
    out = out.slice(0, s) + r + out.slice(e);
    limit = s;
  }
  return out;
}

export const EXTREME_NUMBERS = [
  '1E300',
  '-1E300',
  '1E308',
  '1E999',
  '-1E999',
  '1E-320',
  '0',
  '-0',
  '1.7976931348623157E308',
  '2147483648',
  '-2147483649',
  '4294967296',
  '9007199254740993',
  '99999999999999999999',
  '1' + '0'.repeat(400),
  '0.' + '0'.repeat(400) + '1',
  '1'.repeat(5000),
  'NaN',
  'NAN',
  'INF',
  '-INF',
  'Infinity',
  '1.#QNAN',
  '.',
  '-',
  '+',
  '1.2.3',
  '1E+',
  '--1',
  '0x10',
];

/** 갈래별 줄 끝(블록 끝) */
const EOL = '\n';

/** 갈래별 끝없는 고리 조각(줄 하나 앞에 넣는다) */
function loopSnippet(f: NcFlavor, r: Rand, n: number): string {
  switch (f) {
    case 'heidenhain':
      return pick(r, [
        `${n} LBL 77${EOL}${n + 1} L X+1 Y+1 F100${EOL}${n + 2} CALL LBL 77 REP 65535${EOL}`,
        `${n} LBL 78${EOL}${n + 1} L IX+1 F100${EOL}${n + 2} FN 9: IF +0 EQU +0 GOTO LBL 78${EOL}`,
        `${n} LBL 79${EOL}${n + 1} CALL LBL 79${EOL}${n + 2} LBL 0${EOL}`,
        `${n} FN 12: IF +1 LT +2 GOTO LBL ${int(r, 0, 99)}${EOL}`,
        `${n} LBL 80${EOL}${n + 1} CALL LBL 80 REP 65535${EOL}${n + 2} LBL 0${EOL}${n + 3} CALL LBL 80 REP 65535${EOL}`,
      ]);
    case 'siemens':
      return pick(r, [`LOOP${EOL}G1 X1 Y1 F100${EOL}ENDLOOP${EOL}`, `MARKE7:${EOL}G1 X=IC(1) F100${EOL}GOTOB MARKE7${EOL}`, `WHILE 1==1${EOL}G1 X1${EOL}ENDWHILE${EOL}`, `REPEATB MARKE8 P=999999999${EOL}MARKE8: G1 X2${EOL}`, `R9=0${EOL}MARKE9: R9=R9+1${EOL}IF R9>0 GOTOB MARKE9${EOL}`]);
    case 'linuxcnc':
      return pick(r, [`o771 while [1]${EOL}G1 X1 F100${EOL}o771 endwhile${EOL}`, `o772 repeat [1e9]${EOL}G1 X1 F100${EOL}o772 endrepeat${EOL}`, `o773 do${EOL}G1 X2${EOL}o773 while [1]${EOL}`]);
    case 'gcode':
      return pick(r, [`WHILE[1EQ1]DO1${EOL}G1X1.F100${EOL}END1${EOL}`, `N9001 G1 X1. F100${EOL}GOTO9001${EOL}`, `#100=0${EOL}WHILE[#100GE0]DO2${EOL}#100=#100+1${EOL}END2${EOL}`, `N9002 M99 P9002${EOL}`, `IF[1EQ1]GOTO${int(r, 1, 9999)}${EOL}`, `M99${EOL}`]);
    default:
      return '';
  }
}

/** 갈래별 부프로그램 자기 부름 조각 */
function recursionSnippet(f: NcFlavor, r: Rand, n: number): { before: string; after: string } {
  switch (f) {
    case 'heidenhain':
      return pick(r, [
        { before: `${n} CALL LBL 91${EOL}`, after: `${n + 10} LBL 91${EOL}${n + 11} L IX+0.1 F100${EOL}${n + 12} CALL LBL 91${EOL}${n + 13} LBL 0${EOL}` },
        { before: `${n} CALL LBL 92 REP 99${EOL}`, after: `${n + 10} LBL 92${EOL}${n + 11} CALL LBL 93 REP 99${EOL}${n + 12} LBL 0${EOL}${n + 13} LBL 93${EOL}${n + 14} CALL LBL 92 REP 99${EOL}${n + 15} LBL 0${EOL}` },
        { before: `${n} CALL PGM SELF${EOL}`, after: '' },
        { before: `${n} CALL PGM ${'A'.repeat(int(r, 1, 300))}.H${EOL}`, after: '' },
        { before: `${n} CYCL DEF 12.0 PGM CALL${EOL}${n + 1} CYCL DEF 12.1 PGM SELF${EOL}${n + 2} CYCL CALL${EOL}`, after: '' },
      ]);
    case 'siemens':
      return pick(r, [
        { before: `SELFSUB${EOL}`, after: `PROC SELFSUB${EOL}G1 X=IC(1)${EOL}SELFSUB${EOL}RET${EOL}` },
        { before: `CALL "SELFSUB2"${EOL}`, after: `PROC SELFSUB2${EOL}CALL "SELFSUB2"${EOL}M17${EOL}` },
        { before: `L9123 P999999${EOL}`, after: `L9123${EOL}L9123 P2${EOL}M17${EOL}` },
        { before: `MCALL CYCLE81(10,0,2,-5,0)${EOL}X1 Y1${EOL}`, after: '' },
      ]);
    case 'linuxcnc':
      return pick(r, [
        { before: `o881 call${EOL}`, after: `o881 sub${EOL}G1 X1${EOL}o881 call${EOL}o881 endsub${EOL}` },
        { before: `o<selfsub> call [1] [2]${EOL}`, after: `o<selfsub> sub${EOL}o<selfsub> call [#1+1] [#2]${EOL}o<selfsub> endsub${EOL}` },
      ]);
    case 'gcode':
      return pick(r, [
        { before: `M98 P9123${EOL}`, after: `O9123${EOL}G1 X1. F100${EOL}M98 P9123${EOL}M99${EOL}` },
        { before: `M98 P9124 L9999${EOL}`, after: `O9124${EOL}M98 P9125 L9999${EOL}M99${EOL}O9125${EOL}M98 P9124 L9999${EOL}M99${EOL}` },
        { before: `G65 P9126 A1. B2.${EOL}`, after: `O9126${EOL}G65 P9126 A#1 B#2${EOL}M99${EOL}` },
        { before: `M98 P${int(r, 1, 99999)} L${pick(r, ['0', '1', '99999', '-1', '1E9'])}${EOL}`, after: '' },
        { before: `G66 P9127 A1.${EOL}G1 X1.${EOL}`, after: `O9127${EOL}G1 X2.${EOL}M99${EOL}` },
      ]);
    default:
      return { before: '', after: '' };
  }
}

/** 갈래별 매크로 변수 극값 조각 */
function macroSnippet(f: NcFlavor, r: Rand, n: number): string {
  const big = pick(r, ['1E300', '1E308', '-1E300', '1E999', '1E-320']);
  switch (f) {
    case 'heidenhain':
      return pick(r, [
        `${n} Q1 = ${big}${EOL}${n + 1} Q2 = Q1 * Q1${EOL}${n + 2} L X+Q2 Y-Q2 F100${EOL}`,
        `${n} FN 4: Q3 = +1 DIV +0${EOL}${n + 1} L X+Q3 F100${EOL}`,
        `${n} FN 5: Q4 = SQRT -1${EOL}${n + 1} CC X+Q4 Y+0${EOL}${n + 2} C X+1 Y+0 DR+${EOL}`,
        `${n} Q5 = ${big}${EOL}${n + 1} TOOL DEF 9 L+0 R+Q5${EOL}${n + 2} TOOL CALL 9 Z S1000${EOL}${n + 3} L X+1 Y+1 F100${EOL}`,
        `${n} Q6 = 1 / 0${EOL}${n + 1} CYCL DEF 200 DRILLING ~${EOL}  Q200=+2 ~${EOL}  Q201=+Q6 ~${EOL}  Q206=+150 ~${EOL}  Q202=+0.0001 ~${EOL}  Q210=+0 ~${EOL}  Q203=+0 ~${EOL}  Q204=+50 ~${EOL}  Q211=+0${EOL}${n + 2} CYCL CALL${EOL}`,
      ]);
    case 'siemens':
      return pick(r, [`R1=${big}${EOL}R2=R1*R1${EOL}G1 X=R2 Y=-R2 F100${EOL}`, `R3=1/0${EOL}G1 X=R3${EOL}`, `R4=SQRT(-1)${EOL}G2 X1 Y1 CR=R4${EOL}`, `DEF REAL BIG=${big}${EOL}G1 X=BIG*BIG${EOL}`, `R5=${big}${EOL}CYCLE81(10,0,2,-R5,0)${EOL}`]);
    case 'linuxcnc':
      return pick(r, [`#<big>=${big}${EOL}G1 X[#<big>*#<big>] F100${EOL}`, `#1=[1/0]${EOL}G1 X#1${EOL}`, `#2=SQRT[-1]${EOL}G2 X1 Y1 R#2${EOL}`]);
    case 'gcode':
      return pick(r, [
        `#1=${big}${EOL}#2=#1*#1${EOL}G1X#2Y-#2F100${EOL}`,
        `#3=1/0${EOL}G1X#3${EOL}`,
        `#4=SQRT[-1]${EOL}G2X1.Y1.R#4${EOL}`,
        `#5=${big}${EOL}G83X0Y0Z-#5R2.Q#5F100${EOL}`,
        `#6=${big}${EOL}G76X#6Z-#6P#6Q#6R#6F#6${EOL}`,
        `#7=${big}${EOL}G1X1F#7${EOL}G2X2I#7${EOL}`,
        `#${pick(r, ['99999999', '-1', '0', '1E9', '[#1]'])}=1${EOL}`,
      ]);
    default:
      return '';
  }
}

/** 갈래별 깊은 괄호 */
function nestSnippet(f: NcFlavor, r: Rand, n: number, depth: number): string {
  const open = (c: string) => c.repeat(depth);
  switch (f) {
    case 'heidenhain':
      return pick(r, [`${n} Q1 = ${open('(')}1${open(')')}${EOL}${n + 1} L X+Q1 F100${EOL}`, `${n} Q2 = ${open('(')}1${EOL}`, `${n} ; ${open('(')}${EOL}`]);
    case 'siemens':
      return pick(r, [`R1=${open('(')}1${open(')')}${EOL}G1 X=R1${EOL}`, `R2=${open('(')}${EOL}`, `MSG(${open('(')})${EOL}`]);
    case 'linuxcnc':
      return pick(r, [`#1=${open('[')}1${open(']')}${EOL}G1 X#1${EOL}`, `G1 X${open('[')}${EOL}`]);
    case 'gcode':
      return pick(r, [`#1=${open('[')}1${open(']')}${EOL}G1X#1${EOL}`, `G1X${open('[')}1${EOL}`, `${open('(')}${EOL}`, `G1X[${'#'.repeat(depth)}1]${EOL}`]);
    case 'mpr':
      return pick(r, [`L=${open('(')}1${open(')')}${EOL}`, `<${open('<')}${EOL}`]);
    case 'xml':
      return pick(r, [`${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`, `${'<a>'.repeat(depth)}`, `<!--${open('<!--')}-->`, `${'<b x="&amp;'.repeat(Math.min(depth, 2000))}`]);
  }
}

/** 글 바꾸기 하나 */
function mutateText(t: string, kind: NcMutationKind, r: Rand): { text: string; detail: string } {
  const n = t.length;
  const f = flavorOf(t);
  const starts = lineStarts(t);
  const at = () => int(r, 0, Math.max(0, n - 1));
  const lineAt = () => pick(r, starts);
  // 헤이덴하인 블록 번호(넣는 줄 앞 번호)
  const num = int(r, 1, 99999);
  switch (kind) {
    case 'truncate': {
      const how = pick(r, ['uniform', 'line', 'last', 'number']);
      let cut: number;
      const nums = how === 'number' ? numbers(t) : [];
      if (how === 'line') cut = Math.max(0, lineAt() - 1);
      else if (how === 'last') cut = Math.max(0, n - int(r, 1, 40));
      else if (how === 'number' && nums.length) {
        const [s, e] = pick(r, nums);
        cut = int(r, s, Math.max(s, e - 1));
      } else cut = at();
      return { text: t.slice(0, cut), detail: `truncate:${how}@${n ? (cut / n).toFixed(4) : 0}` };
    }
    case 'bytes': {
      const k = int(r, 1, 8);
      const edits: [number, number, string][] = [];
      for (let q = 0; q < k; q++) {
        const p = at();
        edits.push([p, p + 1, String.fromCharCode(pick(r, [0, 0xff, 0xfe, 0xef, int(r, 0, 255), int(r, 0, 255), int(r, 0x80, 0xff)]))]);
      }
      return { text: apply(t, dedupe(edits)), detail: `bytes:${k}` };
    }
    case 'syntax': {
      const k = int(r, 1, 4);
      const edits: [number, number, string][] = [];
      const ops: string[] = [];
      for (let q = 0; q < k; q++) {
        const p = at();
        const ch = pick(r, ['(', ')', '[', ']', ';', '%', '#', '=', '/', '*', 'N', 'G', 'M', 'O', ':', '"', "'", '\n', '\r', '~', '{', '}', '<', '>', '&', ',', ' ', '.', '-', '+', 'E', '\\', '$']);
        const op = pick(r, ['over', 'insert', 'delete']);
        ops.push(`${op}${JSON.stringify(ch)}`);
        if (op === 'over') edits.push([p, p + 1, ch]);
        else if (op === 'insert') edits.push([p, p, ch]);
        else edits.push([p, p + 1, '']);
      }
      return { text: apply(t, dedupe(edits)), detail: `syntax:${ops.join('+')}` };
    }
    case 'number': {
      const nums = numbers(t);
      if (!nums.length) return mutateText(t, 'syntax', r);
      const edits: [number, number, string][] = [];
      let detail: string;
      if (r() < 0.3) {
        // 한 줄의 숫자를 모두 같은 극값으로
        const ls = lineAt();
        const le = t.indexOf('\n', ls);
        const v = pick(r, EXTREME_NUMBERS);
        for (const [s, e] of nums) if (s >= ls && (le < 0 || e <= le)) edits.push([s, e, v]);
        detail = `number:line:${v.slice(0, 12)}`;
      } else {
        const k = int(r, 1, 5);
        const vs: string[] = [];
        for (let q = 0; q < k; q++) {
          const [s, e] = pick(r, nums);
          const v = pick(r, EXTREME_NUMBERS);
          vs.push(v.slice(0, 12));
          edits.push([s, e, v]);
        }
        detail = `number:${vs.join('+')}`;
      }
      return { text: apply(t, dedupe(edits)), detail };
    }
    case 'longblock': {
      const ls = lineAt();
      const le = t.indexOf('\n', ls);
      const line = t.slice(ls, le < 0 ? n : le);
      const how = pick(r, ['repeat', 'words', 'comment', 'digits', 'lines']);
      const rep = pick(r, [1000, 10000, 100000]);
      let ins: string;
      if (how === 'repeat') ins = line.replace(/^\s*N?\d+\s*/, '').repeat(Math.max(1, Math.floor(rep / Math.max(1, line.length))));
      else if (how === 'words') ins = (f === 'heidenhain' ? 'L X+1 Y+2 ' : 'X1Y2Z3F100').repeat(Math.floor(rep / 10));
      else if (how === 'comment') ins = f === 'heidenhain' ? `; ${'C'.repeat(rep)}` : `(${'C'.repeat(rep)})`;
      else if (how === 'digits') ins = `${f === 'heidenhain' ? 'L X+' : 'G1X'}${'9'.repeat(rep)}`;
      else ins = `${line}\n`.repeat(Math.max(1, Math.floor(rep / 10)));
      return { text: t.slice(0, ls) + ins + EOL + t.slice(ls), detail: `longblock:${how}:${rep}` };
    }
    case 'nest': {
      const depth = pick(r, [64, 1000, 10000, 100000]);
      return { text: insertBeforeEnd(t, nestSnippet(f, r, num, depth), r), detail: `nest:${f}:${depth}` };
    }
    case 'recursion': {
      if (f === 'mpr' || f === 'xml') return mutateText(t, 'splice', r);
      const s = recursionSnippet(f, r, num);
      return { text: appendAfterEnd(insertBeforeEnd(t, s.before, r), s.after), detail: `recursion:${f}:${s.before.replace(/\s+/g, ' ').trim().slice(0, 40)}` };
    }
    case 'macro': {
      if (f === 'mpr' || f === 'xml') return mutateText(t, 'number', r);
      const s = macroSnippet(f, r, num);
      return { text: insertBeforeEnd(t, s, r), detail: `macro:${f}:${s.replace(/\s+/g, ' ').trim().slice(0, 40)}` };
    }
    case 'loop': {
      if (f === 'mpr' || f === 'xml') return mutateText(t, 'longblock', r);
      const s = loopSnippet(f, r, num);
      return { text: insertBeforeEnd(t, s, r), detail: `loop:${f}:${s.replace(/\s+/g, ' ').trim().slice(0, 40)}` };
    }
    case 'splice': {
      if (starts.length < 2) return mutateText(t, 'bytes', r);
      const a = int(r, 0, starts.length - 1);
      const b = Math.min(starts.length, a + int(r, 1, 40));
      const s0 = starts[a]!;
      const s1 = b < starts.length ? starts[b]! : n;
      const chunk = t.slice(s0, s1);
      const how = pick(r, ['move', 'copy', 'many', 'delete']);
      const to = lineAt();
      if (how === 'delete') return { text: t.slice(0, s0) + t.slice(s1), detail: `splice:delete:${b - a}` };
      if (how === 'many') return { text: t.slice(0, to) + chunk.repeat(int(r, 10, 300)) + t.slice(to), detail: `splice:many:${b - a}` };
      const base = how === 'move' ? t.slice(0, s0) + t.slice(s1) : t;
      const p = Math.min(to, base.length);
      return { text: base.slice(0, p) + chunk + base.slice(p), detail: `splice:${how}:${b - a}` };
    }
    case 'lines': {
      const k = int(r, 1, Math.min(50, starts.length));
      const drop = new Set<number>();
      for (let q = 0; q < k; q++) drop.add(int(r, 0, starts.length - 1));
      const parts: string[] = [];
      starts.forEach((s, i) => {
        if (!drop.has(i)) parts.push(t.slice(s, i + 1 < starts.length ? starts[i + 1]! : n));
      });
      return { text: parts.join(''), detail: `lines:drop:${drop.size}` };
    }
  }
}

/** 프로그램 끝(M30·M2·END PGM·M17·! 등) 앞의 아무 줄에 넣는다(끝 표지가 없으면 아무 줄) */
function insertBeforeEnd(t: string, s: string, r: Rand): string {
  if (!s) return t;
  const end = /^.*(?:\bM0?2\b|\bM30\b|\bEND\s+PGM\b|<\/KDTPanelFormat>|<\/pgi>|^!).*$/im.exec(t);
  const limit = end ? end.index : t.length;
  const starts = lineStarts(t).filter((p) => p <= limit);
  const p = starts.length ? pick(r, starts) : 0;
  return t.slice(0, p) + s + t.slice(p);
}

/** 프로그램 끝 뒤에 붙인다(부프로그램 몸 — 끝 다음에 두는 꼴) */
function appendAfterEnd(t: string, s: string): string {
  if (!s) return t;
  return t.endsWith('\n') ? t + s : `${t}\n${s}`;
}

/** 자리가 겹치는 고치기는 앞 것만 */
function dedupe(edits: [number, number, string][]): [number, number, string][] {
  const seen = new Set<number>();
  return edits.filter((e) => (seen.has(e[0]) ? false : (seen.add(e[0]), true)));
}

/** 바꾸기 하나(씨앗 고정) */
export function mutate(input: Uint8Array, kind: NcMutationKind, seed: number): NcMutation {
  const r = rng(seed);
  const m = mutateText(toText(input), kind, r);
  return { bytes: toBytes(m.text), kind, detail: m.detail };
}
