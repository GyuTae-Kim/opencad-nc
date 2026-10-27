/**
 * Heidenhain 평문(Klartext, .h) 해석기 — 자주 쓰는 것만.
 *
 * 지원: BEGIN/END PGM(단위), BLK FORM 0.1/0.2(공작물 상자), TOOL DEF(반지름 → 지름), TOOL CALL(번호·이름, 축, S, F),
 * L(FMAX·F·R0/RL/RR·M), CC(극), C(DR±), CR(R±), CT(접선 호), LP·CP(극좌표, IPA 나선), Q 변수(Qn = 식, FN 0~8),
 * CYCL DEF 200·201·202·203·205·240·206·207·209·1(드릴 계열)과 CYCL CALL·M99·M89, CYCL DEF 7(원점 이동),
 * 밀링 사이클 208(보어 밀링 나선)·251(사각 포켓)·252(원 포켓)·253(홈)·256(사각 보스)·257(원 보스)·232(정면 밀링),
 * FK 자유 윤곽(FPOL·FL·FLT·FC·FCT — 한 블록 안 자료로 정해지는 경우), RL/RR 반경 보정 구간 기록,
 * LBL·CALL LBL REP(구간 반복·부프로그램, 앞쪽 표지 + LBL 0이면 부프로그램), FN 9~12 조건 점프.
 * 근사: RND는 작업 평면 안의 직선·원호 모서리를 접하는 호로, CHF는 두 직선 사이 모서리만 다듬고(원호와 만나면 모서리 그대로, 경고), APPR·DEP는 끝점까지 직선(경고), 포켓 사이클은 동심 윤곽으로 깎는 길(공구 반지름은 TOOL DEF).
 * 좌표 변환: 7 원점 이동·TRANS DATUM AXIS/RESET, 8 대칭, 10 회전, 11 배율, 26 축별 배율(원점 둘레, 출력 변환 — 원호·사이클도 함께).
 * 지원하지 않음: PLANE·19 기울인 평면, 윤곽(SL) 사이클, 다음 블록 자료가 필요한 FK, PATTERN DEF(경고).
 */
import { composeAffine, diagAbout, isIdentityAffine, rotAbout, translateAffine, ZERO3 } from './affine';
import { NcEmitter } from './emitter';
import { ExprError, evalMprExpr } from './expr';
import { FLAG_CYCLE, FLAG_MACHINE, MODAL_XF, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, PLANE_AXES, type NcMachineOptions, type NcPlane, type NcProgram } from './model';

const TAU = Math.PI * 2;
import type { Box3 } from 'opencad-viewer3d/types';
import { makeSource, sourceLine, type NcSource } from './text';
import { isSource, jobFileLines } from './gcode';

export interface HeidenhainOptions {
  name?: string;
  /** 급속 속도(표시 단위/분, 기본 mm 10000 · inch 400) */
  rapidFeed?: number;
  /** 시작 위치 */
  initialPosition?: [number, number, number];
  /** 실행 블록 수 한도 */
  maxBlocks?: number;
  maxMoves?: number;
  /** 반경 보정·포켓 사이클용 공구 표(표시 단위, 키 = 공구 번호). 없으면 TOOL DEF R + TOOL CALL DR */
  toolTable?: Record<number, { diameter?: number; radius?: number }>;
  /** 공작물 원점의 기계 좌표(표시 단위). 주면 M91 값을 실제 위치로 그린다. 없으면 공구 축을 안전 높이(추정)로 */
  machineOffset?: [number, number, number];
  /** 기계·읽기 설정(mm 기준, 앱 설정 — GcodeOptions.machine과 같음) */
  machine?: NcMachineOptions;
}

/** 프로그램 이름 → 비교용(따옴표·경로·확장자를 떼고 대문자): "TNC:\\DIR\\SUB1.H" → SUB1 */
function pgmBase(s: string): string {
  return s
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^.*[\\/:]/, '')
    .replace(/\.[^.]*$/, '')
    .toUpperCase();
}

const AXES = 'XYZ';
/** CYCL CALL에서 밀링 길을 만드는 사이클 */
const MILL_CYCLES = new Set([208, 251, 252, 253, 256, 257, 232]);

/** 한 블록: 원본 첫 줄 번호와 낱말들 */
interface HBlock {
  line: number;
  /** 다음 블록이 시작하는 줄 */
  next: number;
  toks: string[];
  text: string;
}

class HRunner extends NcEmitter {
  private o: HeidenhainOptions;
  private plane: NcPlane = 0;
  // 좌표 변환 사이클: 8 대칭(축별 ±1)·10 회전(도, 작업 평면)·11 배율·26 축별 배율(중심) — 원점(cycle 7) 둘레
  private mirror = [1, 1, 1];
  private rotDeg = 0;
  private scaleF = 1;
  private scale26 = [1, 1, 1];
  private center26 = [0, 0, 0];
  private cc: [number, number] | null = null;
  private lastDir: [number, number] | null = null;
  private dr = 1;
  private q = new Map<string, number>();
  private shift = [0, 0, 0];
  private blkMin: number[] | null = null;
  private blkMax: number[] | null = null;
  private stock: Box3 | undefined;
  private autoFeed = 0;
  private cycle: { n: number; ok: boolean } | null = null;
  private modalCall = false;
  private labels: Map<string, number> | null = null;
  /** 부르기 쌓기: LBL 부프로그램과 CALL PGM(pgmEnd = 그 프로그램 구획 끝 줄) */
  private stack: { ret: number; reps: number; start: number; pgmEnd?: number }[] = [];
  /** 프로그램 구획(BEGIN PGM·%이름 G7x·함께 연 파일 줄마다): 이름들·머리 줄·본문 첫 줄·끝(다음 구획 머리) */
  private pgms: { names: string[]; head: number; body: number; end: number; job: boolean }[] | null = null;
  /** 여러 파일을 한 작업으로 열었는지(함께 연 파일 줄이 있음) — 주 프로그램은 자기 구획 끝에서 멈춘다 */
  private multi = false;
  /** SEL PGM으로 고른 프로그램(CALL SELECTED PGM) */
  private selPgm: string | null = null;
  private sectionReps = new Map<number, number>();
  private pc = 0;
  private ended = false;
  private blocks = 0;
  private toolNames = new Map<string, number>();
  /** FK 극(FPOL) */
  private fkPole: [number, number] | null = null;
  /** TOOL DEF 반지름 */
  private toolR = new Map<number, number>();
  /** TOOL CALL DR(반지름 덧값) */
  private toolDR = 0;
  private maxBlocks: number;
  private maxMoves: number;
  // ── DIN/ISO(%이름 G71 * 꼴) ──
  private iso = false;
  private isoAbs = true;
  /** 이동 모드: 0 급속, 1 직선, 2 시계, 3 반시계, 5 방향 없는 원호, 6 접선 원호, 10/11 극 직선, 12/13/15 극 원호 */
  private isoMot = 1;
  private isoComp = 0;
  private isoSeenStart = false;

  constructor(src: NcSource, opts: HeidenhainOptions) {
    super(src, opts.initialPosition);
    this.o = opts;
    this.maxBlocks = opts.maxBlocks ?? Math.max(src.lineCount * 20, 2_000_000);
    this.maxMoves = opts.maxMoves ?? 8_000_000;
    this.multi = jobFileLines(src) !== null;
    // 단위: BEGIN PGM … MM|INCH, DIN/ISO는 %이름 G71(mm)·G70(inch)
    for (let i = 0; i < Math.min(src.lineCount, 50); i++) {
      const t = sourceLine(src, i);
      const m = /BEGIN\s+PGM\s+(\S+)\s+(MM|INCH)/i.exec(t);
      if (m) {
        this.name = m[1]!;
        this.displayInch = m[2]!.toUpperCase() === 'INCH';
        break;
      }
      const iso = /^\s*%([^\s*;]+)\s+G7([01])\b/i.exec(t);
      if (iso) {
        this.iso = true;
        this.name = iso[1]!;
        this.displayInch = iso[2] === '0';
        this.notices.push({ kind: 'dialect', dialect: 'heidenhain-iso' });
        break;
      }
    }
    this.tol = this.displayInch ? 0.0001 : 0.002;
    this.rapidFeed = this.displayInch ? 400 : 10000;
    if (opts.machine) {
      const mc = this.applyMachine(opts.machine);
      if (!opts.machineOffset && mc.offset) this.o = { ...opts, machineOffset: mc.offset };
    }
    if (opts.rapidFeed) this.rapidFeed = opts.rapidFeed;
    this.feedMode = 94;
  }

  /** 이동마다 남기는 모달 상태: 작업 평면·좌표 변환(사이클 번호는 200번대라 남기지 않는다) */
  protected override modalState(): number {
    return this.plane | (this.outXf ? MODAL_XF : 0);
  }

  /** 줄 i부터 블록 하나(~ 이어 쓰기 포함) */
  private readBlock(i: number): HBlock {
    let text = '';
    let j = i;
    for (;;) {
      // 이어 쓰기 표시 ~는 주석(;) 뒤 줄 끝에 온다 — 주석을 떼기 전에 본다
      let t = sourceLine(this.src, j).trimEnd();
      const cont = t.endsWith('~');
      if (cont) t = t.slice(0, -1);
      const sc = indexOutsideQuotes(t, ';');
      if (sc >= 0) t = t.slice(0, sc);
      t = t.trim();
      text += (text ? ' ' : '') + t;
      j++;
      if (!cont || j >= this.src.lineCount) break;
    }
    // 블록 번호 떼기(DIN/ISO는 블록 끝 * 도)
    text = text.replace(/^\s*N?\d+(?:\s+|$)/, '').trim();
    if (this.iso) text = text.replace(/\s*\*\s*$/, '').trim();
    return { line: i, next: j, toks: tokenize(text), text };
  }

  run(): void {
    // 여러 파일 작업이면 글 끝(마지막 파일 끝)에서도 불린 프로그램은 돌아간다(아래 구획 끝 확인)
    while (!this.ended && (this.pc < this.src.lineCount || this.multi)) {
      // 여러 파일을 함께 열었으면: 불린 프로그램은 자기 구획 끝에서 돌아가고, 주 프로그램은 다음 파일 앞에서 멈춘다
      if (this.multi) {
        const f = this.stack.findLast((x) => x.pgmEnd !== undefined);
        const end = f ? f.pgmEnd! : (this.pgmIndex()[0]?.end ?? this.src.lineCount);
        if (this.pc >= end) {
          if (this.returnPgm()) continue;
          break;
        }
      }
      if (++this.blocks > this.maxBlocks) {
        this.w.add(`실행 블록이 ${this.maxBlocks}개를 넘어 멈춤(끝없는 반복일 수 있음)`, this.pc);
        break;
      }
      const b = this.readBlock(this.pc);
      this.pc = b.next;
      if (!b.toks.length) continue;
      try {
        if (this.iso) {
          // DIN/ISO 블록을 평문 블록(하나 이상)으로 옮겨 같은 길로 실행
          for (const t of this.isoBlock(b.text, b.line)) {
            this.exec({ line: b.line, next: b.next, text: t, toks: tokenize(t) });
            if (this.ended || this.pc !== b.next) break;
          }
        } else this.exec(b);
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        this.w.add(`읽을 수 없는 블록 — ${err.message}`, b.line);
      }
      if (this.mb.count >= this.maxMoves) {
        this.w.add(`이동이 ${this.maxMoves}개를 넘어 나머지는 읽지 않음`, b.line);
        break;
      }
    }
  }

  // ── DIN/ISO → 평문 ──
  /**
   * DIN/ISO 블록 하나를 평문 블록 글(하나 이상)로 옮긴다:
   * G00/G01 → L(FMAX), G02/G03 → C·CR(R), G05 → C(방향 그대로), G06 → CT, G10/G11 R H → LP, G12/G13/G15 H → CP, I·J·K → CC(절대 원 중심),
   * G29 → CC(마지막 자리), G40/G41/G42 → R0/RL/RR, G90/G91 → I 붙임, G30/G31 → BLK FORM, G99 T L R → TOOL DEF, T G17 S → TOOL CALL,
   * G2xx → CYCL DEF, G79 → CYCL CALL, G83 P01… → 옛 쪼기 사이클 1, G54 → 사이클 7, G28 → 8, G73 H → 10, G72 F → 11,
   * G98 L n → LBL n, L n,m → CALL LBL n REP m, D00~D13 → FN, G04 F → 휴지, G38 → STOP, %이름 → 시작·끝(다른 이름이면 CALL PGM)
   */
  private isoBlock(text: string, line: number): string[] {
    const t = text.trim();
    if (!t) return [];
    // %이름 G71: 처음이면 시작, 그다음(N99999999 %이름 …)은 끝, 다른 이름이면 프로그램 부르기
    let m = /^%([^\s*;]+)/.exec(t);
    if (m) {
      if (!this.isoSeenStart) {
        this.isoSeenStart = true;
        return [];
      }
      // 지금 프로그램 구획의 이름이면 끝(불린 프로그램이면 돌아간다)
      const nm = pgmBase(m[1]!);
      const here = this.pgmIndex()[this.sectionAt(line)];
      return (here ? here.names.includes(nm) : nm === pgmBase(this.name)) ? ['END PGM'] : [`CALL PGM ${m[1]}`];
    }
    // Q 공식(Q1 = …)은 그대로
    if (/^Q[LRS]?\d+\s*=/.test(t)) return [t];
    // D 함수: D00 Q1 P01 +5 / D01 Q1 P01 Q2 P02 +3 / D09 P01 +Q1 P02 +10 P03 5
    if ((m = /^D(\d+)\s+(.*)$/i.exec(t))) return [this.isoFn(+m[1]!, m[2]!, line)];
    // 낱말: 글자 + 값(+5·-2.5·Q3·+Q3), L n,m(부르기)
    const W: { k: string; v: string }[] = [];
    const re = /([A-Z]+)\s*((?:[-+]?(?:\d+\.?\d*|\.\d+)(?:,\d+)?)|[-+]?Q[LRS]?\d+)?/gi;
    let mm: RegExpExecArray | null;
    let rest = '';
    while ((mm = re.exec(t))) {
      const k = mm[1]!.toUpperCase();
      // 사이클 이름(BOHREN 등)·이름 뒤 Q 대입은 그대로 넘긴다
      if (/^Q[LRS]?$/.test(k) && t[re.lastIndex] === '=') {
        rest = t.slice(mm.index);
        break;
      }
      W.push({ k, v: mm[2] ?? '' });
    }
    const gs = W.filter((w) => w.k === 'G').map((w) => Math.round(parseFloat(w.v)));
    const word = (k: string): string | undefined => W.find((w) => w.k === k)?.v;
    const has = (k: string): boolean => W.some((w) => w.k === k);
    const out: string[] = [];
    // 모드
    for (const g of gs) {
      if (g === 90) this.isoAbs = true;
      else if (g === 91) this.isoAbs = false;
      else if (g === 40) this.isoComp = 0;
      else if (g === 41) this.isoComp = 1;
      else if (g === 42) this.isoComp = 2;
      else if ([0, 1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 15, 16].includes(g)) this.isoMot = g;
    }
    const inc = this.isoAbs ? '' : 'I';
    const sgn = (v: string): string => (/^[-+]/.test(v) ? v : `+${v}`);
    const axes = (letters: string[]): string =>
      letters
        .filter((a) => has(a))
        .map((a) => `${inc}${a}${sgn(word(a)!)}`)
        .join(' ');
    const ms = W.filter((w) => w.k === 'M').map((w) => `M${w.v}`);
    const feed = has('F') ? ` F${word('F')}` : '';
    const g = (n: number): boolean => gs.includes(n);
    // 블록 꼴
    if (g(30) || g(31)) {
      const ax = g(18) ? 'Y' : g(19) ? 'X' : 'Z';
      return [g(30) ? `BLK FORM 0.1 ${ax} ${axes(['X', 'Y', 'Z'])}` : `BLK FORM 0.2 ${axes(['X', 'Y', 'Z'])}`];
    }
    if (g(99) && has('T')) return [`TOOL DEF ${word('T')} L${sgn(word('L') ?? '0')} R${sgn(word('R') ?? '0')}`];
    if (has('T')) {
      const ax = g(18) ? 'Y' : g(19) ? 'X' : 'Z';
      const extra = ['S', 'F', 'DL', 'DR'].filter(has).map((k) => ` ${k}${word(k)}`).join('');
      out.push(`TOOL CALL ${word('T')} ${ax}${extra}`);
      if (ms.length) out.push(ms.join(' '));
      return out;
    }
    if (g(98) && has('L')) return [`LBL ${word('L')}`];
    if (has('L') && /,/.test(word('L') ?? '')) {
      const [n, rep] = word('L')!.split(',');
      return [rep && +rep > 0 ? `CALL LBL ${n} REP ${rep}` : `CALL LBL ${n}`];
    }
    if (g(38)) return ['STOP'];
    if (g(4)) return [`DWELL ${word('F') ?? '0'}`];
    const big = gs.find((n) => n >= 200 && n <= 299);
    if (big !== undefined) return [`CYCL DEF ${big} ${rest || W.filter((w) => w.k !== 'G').map((w) => w.k + w.v).join(' ')}`.trim()];
    if (g(79)) return [`CYCL CALL${feed}${ms.length ? ' ' + ms.join(' ') : ''}`];
    if (g(83) || g(84)) {
      // 옛 사이클 1(쪼기)·2(탭): P01 안전 거리 P02 깊이 P03 절입(탭은 휴지) P04 휴지(탭은 이송) P05 이송
      const pv = (k: string): string => {
        const r = new RegExp(`P0?${k}\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+|Q\\d+))`, 'i').exec(t);
        return r ? r[1]! : '0';
      };
      if (g(83)) return ['CYCL DEF 1.0', `CYCL DEF 1.1 SET UP ${pv('1')}`, `CYCL DEF 1.2 DEPTH ${pv('2')}`, `CYCL DEF 1.3 PECKG ${pv('3')}`, `CYCL DEF 1.4 DWELL ${pv('4')}`, `CYCL DEF 1.5 F${pv('5')}`];
      return ['CYCL DEF 2.0', `CYCL DEF 2.1 SET UP ${pv('1')}`, `CYCL DEF 2.2 DEPTH ${pv('2')}`, `CYCL DEF 2.3 DWELL ${pv('3')}`, `CYCL DEF 2.4 F${pv('4')}`];
    }
    if (g(54)) return ['CYCL DEF 7.0', ...['X', 'Y', 'Z'].filter(has).map((a, k) => `CYCL DEF 7.${k + 1} ${inc}${a}${sgn(word(a)!)}`)];
    if (g(28)) return ['CYCL DEF 8.0', `CYCL DEF 8.1 ${['X', 'Y', 'Z'].filter(has).join(' ')}`.trim()];
    if (g(73)) return ['CYCL DEF 10.0', `CYCL DEF 10.1 ${inc}ROT${sgn(word('H') ?? '0')}`];
    if (g(72)) return ['CYCL DEF 11.0', `CYCL DEF 11.1 SCL${word('F') ?? '1'}`];
    if (g(80)) {
      this.w.add('DIN/ISO G80(기울인 작업 평면)은 지원하지 않음(변환 없이 그림)', line);
      return [];
    }
    if (g(53)) {
      this.w.add('DIN/ISO G53(원점 표)는 읽지 않음', line);
      return [];
    }
    // G24 R = 모따기 길이, G25 R = 둥글리기 반지름(F = 이송) → 평문 CHF·RND
    if (g(24) || g(25)) {
      const r = word('R');
      const f = word('F');
      if (r === undefined) {
        this.w.add(`${g(24) ? 'G24(모따기)' : 'G25(둥글리기)'}에 R이 없어 모서리 그대로 그림`, line);
        return [];
      }
      return [`${g(24) ? `CHF ${r}` : `RND R${r}`}${f !== undefined ? ` F${f}` : ''}`];
    }
    if (g(26) || g(27)) this.w.add('APPR·DEP(접근·이탈)는 끝점까지 직선으로 그림', line);
    // 원 중심(극) I·J·K, G29 = 마지막 자리
    const ijk = ['I', 'J', 'K'].filter(has);
    if (ijk.length) out.push(`CC ${ijk.map((k) => `${inc}${'XYZ'['IJK'.indexOf(k)]}${sgn(word(k)!)}`).join(' ')}`);
    if (g(29)) out.push('CC');
    // 이동
    const xyz = axes(['X', 'Y', 'Z']);
    const comp = this.isoComp === 1 ? 'RL' : this.isoComp === 2 ? 'RR' : 'R0';
    const tail = `${feed}${ms.length ? ' ' + ms.join(' ') : ''}`;
    const mot = this.isoMot;
    const hasPolar = has('H') || (has('R') && (mot === 10 || mot === 11));
    if (mot === 10 || mot === 11 ? hasPolar : mot >= 12 && mot <= 16 ? has('H') : !!xyz) {
      if (mot === 0 || mot === 1 || mot === 7) out.push(`L ${xyz} ${comp}${mot === 0 ? ' FMAX' : ''}${tail}`);
      else if (mot === 2 || mot === 3) out.push(has('R') ? `CR ${xyz} R${sgn(word('R')!)} DR${mot === 2 ? '-' : '+'}${tail}` : `C ${xyz} DR${mot === 2 ? '-' : '+'}${tail}`);
      else if (mot === 5) out.push(`C ${xyz}${tail}`);
      else if (mot === 6) out.push(`CT ${xyz}${tail}`);
      else if (mot === 10 || mot === 11) {
        const pr = has('R') ? ` ${this.isoAbs ? '' : 'I'}PR${sgn(word('R')!)}` : '';
        const pa = has('H') ? ` ${this.isoAbs ? '' : 'I'}PA${sgn(word('H')!)}` : '';
        out.push(`LP${pr}${pa} ${comp}${mot === 10 ? ' FMAX' : ''}${tail}`);
      } else {
        const pa = ` ${this.isoAbs ? '' : 'I'}PA${sgn(word('H')!)}`;
        const z = has('Z') ? ` ${inc}Z${sgn(word('Z')!)}` : '';
        out.push(`CP${pa}${z}${mot === 12 ? ' DR-' : mot === 13 ? ' DR+' : ''}${tail}`);
      }
    } else if (feed || ms.length || gs.some((n) => n >= 40 && n <= 42)) out.push(`L ${comp}${tail}`.trim());
    return out;
  }

  /** D 함수 → FN 글 */
  private isoFn(k: number, body: string, line: number): string {
    const toks = body.trim().split(/\s+/);
    const target = /^Q[LRS]?\d+$/i.test(toks[0] ?? '') ? toks.shift()! : '';
    // P01 값 P02 값 P03 값
    const p: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const m = /^P0?(\d)$/i.exec(toks[i]!);
      if (m) p[+m[1]! - 1] = toks[++i] ?? '0';
    }
    const v = (i: number): string => p[i] ?? '0';
    switch (k) {
      case 0:
        return `FN 0: ${target} = ${v(0)}`;
      case 1:
        return `FN 1: ${target} = ${v(0)} + ${v(1)}`;
      case 2:
        return `FN 2: ${target} = ${v(0)} - ${v(1)}`;
      case 3:
        return `FN 3: ${target} = ${v(0)} * ${v(1)}`;
      case 4:
        return `FN 4: ${target} = ${v(0)} DIV ${v(1)}`;
      case 5:
        return `FN 5: ${target} = SQRT ${v(0)}`;
      case 6:
        return `FN 6: ${target} = SIN ${v(0)}`;
      case 7:
        return `FN 7: ${target} = COS ${v(0)}`;
      case 8:
        return `FN 8: ${target} = ${v(0)} LEN ${v(1)}`;
      case 9:
      case 10:
      case 11:
      case 12:
        return `FN ${k}: IF ${v(0)} ${['EQU', 'NE', 'GT', 'LT'][k - 9]} ${v(1)} GOTO LBL ${v(2)}`;
      case 13:
        return `FN 13: ${target} = ${v(0)} ANG ${v(1)}`;
      case 14:
        return 'FN 14: ERROR';
    }
    this.w.add(`D${String(k).padStart(2, '0')} 함수는 지원하지 않음`, line);
    return '';
  }

  // ── 값 ──
  private value(s: string): number {
    const t = s.trim();
    if (t === '') throw new ExprError('값 없음');
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    return this.expr(t);
  }
  private expr(e: string): number {
    const v = evalMprExpr(e.replace(/\bDIV\b/gi, '/'), {
      get: (name) => {
        const k = name.toUpperCase();
        if (/^Q[LRS]?\d+$/.test(k)) return this.q.get(k) ?? 0;
        return undefined;
      },
    });
    return v;
  }

  // ── 실행 ──
  private exec(b: HBlock): void {
    const T = b.toks;
    const t0 = T[0]!.toUpperCase();
    const t1 = (T[1] ?? '').toUpperCase();
    const line = b.line;
    if (t0 === '*' || t0.startsWith('*')) return; // 구조 주석
    if (t0 === 'BEGIN') return;
    if (t0 === 'END' && t1 === 'PGM') {
      if (!this.returnPgm()) this.ended = true;
      return;
    }
    if (t0 === 'DWELL') {
      // DIN/ISO G04 F(초)
      this.dwell(this.value(t1 || '0'));
      return;
    }
    if (t0 === 'BLK' && t1 === 'FORM') return this.blkForm(T, line);
    if (t0 === 'TOOL' && t1 === 'DEF') {
      const n = parseInt(T[2] ?? '', 10);
      const r = findWord(T, 'R');
      if (Number.isFinite(n) && r !== undefined) {
        const rv = this.value(r);
        this.toolR.set(n, rv);
        this.setToolInfo(n, { diameter: 2 * rv });
      }
      return;
    }
    if (t0 === 'TOOL' && t1 === 'CALL') return this.toolCall(T, line);
    if (t0 === 'CYCL' && t1 === 'DEF') return this.cyclDef(T, line);
    if (t0 === 'CYCL' && t1 === 'CALL') {
      if ((T[2] ?? '').toUpperCase() === 'PAT') {
        this.w.add('CYCL CALL PAT(점 패턴)은 지원하지 않음', line);
        return;
      }
      const f = findWord(T, 'F');
      if (f !== undefined) this.feed = this.value(f);
      this.mWords(T, line, true);
      return this.cycleCall(line);
    }
    if (t0 === 'LBL') {
      // LBL 0 = 부프로그램 끝(부른 곳으로 돌아간다). 다른 LBL은 표지일 뿐
      const f = this.stack[this.stack.length - 1];
      if ((T[1] === '0' || T[1] === '"0"') && f && f.pgmEnd === undefined) {
        if (f.reps > 1) {
          f.reps--;
          this.pc = f.start;
        } else {
          this.stack.pop();
          this.pc = f.ret;
        }
      }
      return;
    }
    if (t0 === 'CALL' && t1 === 'LBL') return this.callLbl(T, line);
    if (t0 === 'CALL' && t1 === 'PGM') return this.callPgm(/^CALL\s+PGM\s+("[^"]*"|\S+)/i.exec(b.text)?.[1] ?? '', line);
    // SEL PGM 이름 … CALL SELECTED PGM: 고른 프로그램 부르기
    if (t0 === 'SEL' && t1 === 'PGM') {
      this.selPgm = /^SEL\s+PGM\s+("[^"]*"|\S+)/i.exec(b.text)?.[1] ?? null;
      return;
    }
    if (t0 === 'CALL' && t1 === 'SELECTED') {
      if (this.selPgm) return this.callPgm(this.selPgm, line);
      this.w.add('CALL SELECTED PGM: 앞에 SEL PGM이 없음', line);
      return;
    }
    if (t0 === 'FN') return this.fn(b, line);
    if (/^Q[LRS]?\d+$/.test(t0) || /^Q[LRS]?\d+=/.test(t0)) return this.qAssign(b.text);
    if (t0 === 'L') return this.linear(T, line);
    // 'L' 없이 좌표로 시작하는 블록(예: "8 A+180 R0 FMAX")도 직선으로
    if (/^I?[XYZABCUVW][+-]/.test(t0)) return this.linear(['L', ...T], line);
    if (t0 === 'CC') return this.pole(T);
    if (t0 === 'C') return this.circle(T, line);
    if (t0 === 'CR') return this.circleR(T, line);
    if (t0 === 'CT') return this.circleT(T, line);
    if (t0 === 'LP') return this.linearPolar(T, line);
    if (t0 === 'CP') return this.circlePolar(T, line);
    if (t0 === 'FPOL' || t0 === 'FL' || t0 === 'FLT' || t0 === 'FC' || t0 === 'FCT') return this.fk(t0, T, line);
    if (t0 === 'FSELECT') {
      this.w.add('FSELECT(FK 해 고르기)는 무시함 — 한 블록으로 정해지는 해만 그림', line);
      return;
    }
    if (t0 === 'TRANS') return this.transDatum(T, line);
    if (t0 === 'RND' || t0 === 'CHF') return this.cornerBlock(t0, T, line);
    if (t0.startsWith('APPR') || t0.startsWith('DEP')) {
      this.w.add('APPR·DEP(접근·이탈)는 끝점까지 직선으로 그림', line);
      return this.linear(T, line);
    }
    if (t0 === 'STOP' || t0 === 'FUNCTION' || t0 === 'TCH' || t0 === 'PATTERN' || t0 === 'PLANE' || t0 === 'SEL' || t0 === 'DECLARE') {
      if (t0 !== 'STOP') this.w.add(`${t0} 블록은 지원하지 않음`, line);
      this.mWords(T, line, false);
      return;
    }
    if (/^M\d+$/.test(t0)) {
      this.mWords(T, line, false);
      return;
    }
    this.w.add(`알 수 없는 블록 '${t0}'`, line);
  }

  /**
   * RND R…(모서리 둥글리기, R = 반지름)·CHF …(모따기, 값 = 모서리에서 앞뒤 요소를 따라 자르는 길이), 둘 다 F = 그 부분의 이송(선택).
   * emitter의 requestCorner로 앞 요소 끝을 줄이고 호·직선을 넣는다. RND는 작업 평면 안의 직선·원호 어느 조합이든(앞뒤 요소에 접하는 호),
   * CHF는 Heidenhain 설명서대로 두 직선 사이 모서리에만(원호와 만나면 모서리 그대로, 경고)
   */
  private cornerBlock(t0: 'RND' | 'CHF', T: string[], line: number): void {
    let size: number | undefined;
    let feed: number | undefined;
    for (const w of T.slice(1)) {
      const u = w.toUpperCase();
      if (/^F[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) feed = this.value(w.slice(1));
      else if (t0 === 'RND' && /^R[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) size = this.value(w.slice(1));
      else if (t0 === 'CHF' && /^L?[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) size = this.value(u.startsWith('L') ? w.slice(1) : w);
    }
    if (size === undefined) {
      this.w.add(t0 === 'RND' ? 'RND에 반지름 R이 없어 모서리 그대로 그림' : 'CHF에 길이가 없어 모서리 그대로 그림', line);
      return;
    }
    this.requestCorner(t0 === 'RND' ? 'round' : 'chamferLeg', Math.abs(size), line, this.plane, t0, feed, t0 === 'CHF');
  }

  private blkForm(T: string[], line: number): void {
    const kind = T[2] ?? '';
    const pt = (): number[] => {
      const p = [NaN, NaN, NaN];
      for (const w of T.slice(3)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const v = this.value(m[3]!);
        p[a] = m[1] ? (this.blkMin?.[a] ?? 0) + v : v;
      }
      return p;
    };
    if (kind === '0.1') {
      this.blkMin = pt();
      const ax = (T[3] ?? 'Z').toUpperCase();
      this.plane = ax === 'Y' ? 1 : ax === 'X' ? 2 : 0;
    } else if (kind === '0.2' && this.blkMin) {
      this.blkMax = pt();
      const a = this.blkMin;
      const b = this.blkMax;
      if ([0, 1, 2].every((k) => Number.isFinite(a[k]!) && Number.isFinite(b[k]!)))
        this.stock = {
          min: [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.min(a[2]!, b[2]!)],
          max: [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!), Math.max(a[2]!, b[2]!)],
        };
    } else if (kind.toUpperCase() === 'CYLINDER') {
      // BLK FORM CYLINDER 축 R(또는 D) L — 축 방향으로 0에서 -L까지(추정), 둘레 상자로 그린다
      const r = findWord(T, 'R');
      const d = findWord(T, 'D');
      const l = findWord(T, 'L');
      const R = r !== undefined ? this.value(r) : d !== undefined ? this.value(d) / 2 : undefined;
      if (R !== undefined && l !== undefined) {
        const L = this.value(l);
        const ax = AXES.indexOf((T[3] ?? 'Z').toUpperCase());
        const min: [number, number, number] = [-R, -R, -R];
        const max: [number, number, number] = [R, R, R];
        const a = ax < 0 ? 2 : ax;
        min[a] = -L;
        max[a] = 0;
        this.stock = { min, max };
        this.w.add('BLK FORM CYLINDER는 둘레 상자로 그림', line);
      }
    }
  }

  private toolCall(T: string[], line: number): void {
    const id = T[2] ?? '';
    let n: number;
    if (/^\d+$/.test(id)) n = +id;
    else if (/^".*"$/.test(id)) {
      const name = id.slice(1, -1);
      n = this.toolNames.get(name) ?? 100000 + this.toolNames.size;
      this.toolNames.set(name, n);
      this.setToolInfo(n, { name });
    } else n = this.tool >= 0 ? this.tool : 0;
    const ax = (T[3] ?? '').toUpperCase();
    if (ax === 'Z') this.plane = 0;
    else if (ax === 'Y') this.plane = 1;
    else if (ax === 'X') this.plane = 2;
    const s = findWord(T, 'S');
    if (s !== undefined) this.speed = Math.abs(this.value(s));
    const f = findWord(T, 'F');
    if (f !== undefined && /^[+-]?[\d.Q]/i.test(f)) this.autoFeed = this.value(f);
    const dr = findWord(T, 'DR');
    this.toolDR = dr !== undefined ? this.value(dr) : 0;
    this.changeTool(n, line);
    if (this.comp) this.compNote(line);
  }

  /** 지금 공구의 반지름(공구 표 → TOOL DEF R, + TOOL CALL DR). 모르면 undefined */
  private toolRadius(): number | undefined {
    const t = this.tool;
    const tt = this.o.toolTable?.[t];
    const base = tt ? (tt.radius ?? (tt.diameter !== undefined ? tt.diameter / 2 : undefined)) : this.toolR.get(t);
    return base === undefined ? undefined : base + this.toolDR;
  }

  /** 반경 보정 구간 기록 */
  private compNote(line: number): void {
    const r = this.comp ? this.toolRadius() : undefined;
    this.noteComp(this.plane, line, r, r === undefined ? '' : `T${this.tool} R${this.toolDR ? ' + DR' : ''}`, this.tool);
  }

  private cyclDef(T: string[], line: number): void {
    const num = T[2] ?? '';
    // Q 값 대입(새 꼴: 한 블록 안에 Q200=… 가 이어짐)
    for (const w of T.slice(3)) {
      const m = /^(Q[LR]?\d+)=(.+)$/i.exec(w);
      if (m && !m[2]!.startsWith('"')) this.q.set(m[1]!.toUpperCase(), this.value(m[2]!));
    }
    const major = parseInt(num, 10);
    // 예전 꼴: CYCL DEF 1.0 PECKING / 1.1 SET UP 2 / 1.2 DEPTH -20 / 1.3 PECKG 5 / 1.4 DWELL 0 / 1.5 F100
    if (/^\d+\.\d+$/.test(num)) {
      const sub = Math.round((parseFloat(num) - major) * 10);
      const last = T[T.length - 1] ?? '';
      const val = (): number | undefined => {
        const m = /^F?([+-]?[\d.]+)$/i.exec(last);
        return m ? parseFloat(m[1]!) : undefined;
      };
      if (major === 7) {
        // 원점 이동: 7.1 X+10 / 7.2 Y+5 / 7.3 Z…
        for (const w of T.slice(3)) {
          const m = /^(I?)([XYZ])(.+)$/i.exec(w);
          if (!m) continue;
          const a = AXES.indexOf(m[2]!.toUpperCase());
          const v = this.value(m[3]!);
          this.shift[a] = m[1] ? this.shift[a]! + v : v;
        }
        this.updateXf();
        return;
      }
      if (major === 8) {
        // 대칭: 8.1 X Y(대칭할 축, 없으면 끔)
        if (sub === 1) {
          this.mirror = [1, 1, 1];
          for (const w of T.slice(3)) {
            const a = AXES.indexOf(w.toUpperCase().replace(/^I/, ''));
            if (a >= 0) this.mirror[a] = -1;
          }
          this.updateXf();
        }
        return;
      }
      if (major === 10) {
        // 회전: 10.1 ROT+45(IROT는 더하기). 지금 작업 평면에서 원점 둘레
        if (sub === 1) {
          const tok = T.slice(3).join('').toUpperCase();
          const m = /^(I?)ROT([-+]?.+)$/.exec(tok);
          if (m) {
            const v = this.value(m[2]!);
            this.rotDeg = m[1] ? this.rotDeg + v : v;
            this.updateXf();
          }
        }
        return;
      }
      if (major === 11) {
        // 배율: 11.1 SCL 0.75
        if (sub === 1) {
          const tok = T.slice(3).join('').toUpperCase();
          const m = /^SCL([-+]?.+)$/.exec(tok);
          if (m) {
            const v = this.value(m[1]!);
            if (v > 0) this.scaleF = v;
            this.updateXf();
          }
        }
        return;
      }
      if (major === 26) {
        // 축별 배율: 26.1 X1.4 Y0.6 CCX+15 CCY+20
        if (sub === 1) {
          this.scale26 = [1, 1, 1];
          this.center26 = [0, 0, 0];
          for (const w of T.slice(3)) {
            let m = /^CC([XYZ])(.+)$/i.exec(w);
            if (m) {
              this.center26[AXES.indexOf(m[1]!.toUpperCase())] = this.value(m[2]!);
              continue;
            }
            m = /^([XYZ])(.+)$/i.exec(w);
            if (m) {
              const v = this.value(m[2]!);
              if (v > 0) this.scale26[AXES.indexOf(m[1]!.toUpperCase())] = v;
            }
          }
          this.updateXf();
        }
        return;
      }
      if (major === 19) {
        if (sub === 0) this.w.add('CYCL DEF 19(기울인 작업 평면)은 지원하지 않음(변환 없이 그림)', line);
        return;
      }
      if (major === 1 || major === 2 || major === 17) {
        if (sub === 0) this.cycle = { n: major, ok: true };
        const v = val();
        if (v !== undefined) {
          const key = ['', 'O1', 'O2', 'O3', 'O4', 'O5'][sub];
          if (key) this.q.set('OLD' + key, v);
        }
        return;
      }
      if (sub === 0) this.w.add(`CYCL DEF ${major}은 지원하지 않음`, line);
      return;
    }
    if ([200, 201, 202, 203, 205, 240, 206, 207, 209, 204, 208, 251, 252, 253, 256, 257, 232].includes(major)) {
      this.cycle = { n: major, ok: true };
      if (major === 204) this.w.add(`CYCL DEF ${major}은 드릴처럼(내려가서 올라옴) 그림`, line);
      return;
    }
    // 점 패턴(정의하면 바로 앞 가공 사이클을 점마다 부른다)
    if (major === 220 || major === 221) return this.patternCycle(major, line);
    this.cycle = { n: major, ok: false };
    this.w.add(`CYCL DEF ${num}은 지원하지 않음(호출해도 그리지 않음)`, line);
  }

  /**
   * 좌표 변환(8 대칭·10 회전·11/26 배율)을 원점 이동(7·TRANS DATUM) 둘레의 출력 변환으로:
   * 화면 = 원점 + M(R(S(p - 원점))) — 원점 이동 → 대칭 → 회전 → 배율 차례(Heidenhain)
   */
  private updateXf(): void {
    const sh = this.shift;
    const s = this.scaleF;
    let L = composeAffine(diagAbout(ZERO3, this.mirror), rotAbout(ZERO3, this.rotDeg, this.plane));
    L = composeAffine(L, composeAffine(diagAbout(ZERO3, [s, s, s]), diagAbout(this.center26, this.scale26)));
    if (isIdentityAffine(L)) {
      this.setOutXf(null);
      return;
    }
    this.setOutXf(composeAffine(composeAffine(translateAffine(sh), L), translateAffine([-sh[0]!, -sh[1]!, -sh[2]!])));
  }

  /** TRANS DATUM AXIS X… Y…(원점 이동)·TRANS DATUM RESET */
  private transDatum(T: string[], line: number): void {
    const what = (T[2] ?? '').toUpperCase();
    if ((T[1] ?? '').toUpperCase() !== 'DATUM') {
      this.w.add(`${T.slice(0, 2).join(' ')} 블록은 지원하지 않음`, line);
      return;
    }
    if (what === 'RESET') this.shift = [0, 0, 0];
    else if (what === 'AXIS') {
      for (const w of T.slice(3)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const v = this.value(m[3]!);
        this.shift[a] = m[1] ? this.shift[a]! + v : v;
      }
    } else {
      this.w.add(`TRANS DATUM ${what}(원점 표)는 읽지 않음`, line);
      return;
    }
    this.updateXf();
  }

  /** 지금 위치에서 드릴 사이클 실행 */
  private cycleCall(line: number): void {
    const c = this.cycle;
    if (!c) {
      this.w.add('정의된 드릴 사이클 없이 CYCL CALL', line);
      return;
    }
    if (!c.ok) return;
    if (MILL_CYCLES.has(c.n)) return this.millCycle(c.n, line);
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const Q = (k: string, d: number): number => this.q.get(k) ?? d;
    let setup: number;
    let depth: number;
    let peck: number;
    let surface: number;
    let second: number;
    let feed: number;
    let dwellBottom = 0;
    if (c.n === 1 || c.n === 2 || c.n === 17) {
      // 예전 꼴: 지금 위치가 안전 거리 위
      setup = Math.abs(Q('OLDO1', 2));
      depth = Q('OLDO2', 0);
      peck = c.n === 1 ? Math.abs(Q('OLDO3', 0)) : 0;
      dwellBottom = Q('OLDO4', 0);
      feed = Q('OLDO5', this.feed);
      surface = this.pos[da]! - setup;
      second = setup;
    } else {
      setup = Math.abs(Q('Q200', 2));
      depth = Q('Q201', 0);
      peck = c.n === 200 || c.n === 203 || c.n === 205 ? Math.abs(Q('Q202', 0)) : 0;
      surface = Q('Q203', 0) + this.shift[da]!;
      second = Math.abs(Q('Q204', 0));
      feed = Q('Q206', this.feed || this.autoFeed);
      dwellBottom = Q('Q211', 0);
      if (c.n === 240) depth = Q('Q201', depth);
    }
    if (depth === 0) {
      this.w.add('드릴 사이클 깊이(Q201)가 0', line);
      return;
    }
    const up = depth < 0 ? 1 : -1;
    const rD = surface + up * setup;
    const zD = surface + depth;
    const clear = surface + up * Math.max(setup, second);
    const saveFeed = this.feed;
    const pt = [0, 0, 0];
    const go = (kind: number, d: number): void => {
      pt[p0] = this.pos[p0]!;
      pt[p1] = this.pos[p1]!;
      pt[da] = d;
      this.emit(kind, pt[0]!, pt[1]!, pt[2]!, line, FLAG_CYCLE);
    };
    go(MOVE_RAPID, rD);
    this.feed = feed;
    const first = this.mb.count;
    if (peck > 0) {
      // 절입 깊이는 공작물 윗면(Q203)부터 잰다
      let d = surface;
      let first = true;
      let guard = 0;
      while (up * (d - zD) > 1e-9 && guard++ < 10000) {
        const next = up > 0 ? Math.max(zD, d - peck) : Math.min(zD, d + peck);
        if (!first) go(MOVE_RAPID, d + up * Math.min(setup, 0.5));
        go(MOVE_DRILL, next);
        if (next !== zD) go(MOVE_RAPID, rD);
        d = next;
        first = false;
      }
    } else go(MOVE_DRILL, zD);
    this.dwell(dwellBottom);
    if (c.n === 201 || c.n === 206 || c.n === 207 || c.n === 209 || c.n === 2 || c.n === 17) go(MOVE_FEED, rD);
    go(MOVE_RAPID, clear);
    if (this.mb.count > first) {
      const top = [0, 0, 0];
      top[p0] = this.pos[p0]!;
      top[p1] = this.pos[p1]!;
      top[da] = rD;
      const bottom = [top[0]!, top[1]!, top[2]!];
      bottom[da] = zD;
      this.pushHoleOut(top, bottom, line, c.n, first);
    }
    this.feed = saveFeed;
  }

  /** CYCL DEF 220(원 패턴)·221(격자 패턴): 점마다 두 번째 안전 높이로 옮겨 앞 사이클을 부른다 */
  private patternCycle(n: number, line: number): void {
    if (!this.cycle || !this.cycle.ok) {
      this.w.add(`CYCL DEF ${n}: 부를 드릴 사이클이 없음`, line);
      return;
    }
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    const pts: [number, number][] = [];
    if (n === 221) {
      const cols = Math.max(1, Math.round(Q('Q242', 1)));
      const rows = Math.max(1, Math.round(Q('Q243', 1)));
      const rot = (Q('Q224') * Math.PI) / 180;
      const x0 = Q('Q225');
      const y0 = Q('Q226');
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const dx = i * Q('Q237');
          const dy = j * Q('Q238');
          pts.push([x0 + dx * Math.cos(rot) - dy * Math.sin(rot), y0 + dx * Math.sin(rot) + dy * Math.cos(rot)]);
        }
    } else {
      const cx = Q('Q216');
      const cy = Q('Q217');
      const r = Q('Q244') / 2;
      const a0 = Q('Q245');
      const a1 = Q('Q246', 360);
      const cnt = Math.max(1, Math.round(Q('Q241', 1)));
      let step = Q('Q247');
      const full = Math.abs(Math.abs(a1 - a0) - 360) < 1e-9;
      if (!step) step = cnt > 1 ? (a1 - a0) / (full ? cnt : cnt - 1) : 0;
      for (let k = 0; k < cnt; k++) {
        const a = ((a0 + k * step) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const clear = Q('Q203') + this.shift[da]! + Math.max(Math.abs(Q('Q200', 2)), Math.abs(Q('Q204')));
    const t = [0, 0, 0];
    for (const [u, v] of pts) {
      t[p0] = this.pos[p0]!;
      t[p1] = this.pos[p1]!;
      t[da] = Math.max(this.pos[da]!, clear);
      this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line, FLAG_CYCLE);
      t[p0] = u + this.shift[p0]!;
      t[p1] = v + this.shift[p1]!;
      this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line, FLAG_CYCLE);
      this.known = 7;
      this.cycleCall(line);
    }
  }

  /** 표지 줄(여러 파일을 함께 열었으면 지금 줄이 든 프로그램 구획 안에서만 — 표지는 프로그램마다 따로) */
  private findLabel(name: string, at: number): number {
    if (!this.labels) {
      this.labels = new Map();
      // 평문 LBL 이름, DIN/ISO G98 L 번호
      const re = this.iso ? /^\s*(?:N?\d+\s+)?G98\s+L\s*(\d+)\b/i : /^\s*(?:N?\d+\s+)?LBL\s+("[^"]*"|[^"\s;]+)/i;
      for (let i = 0; i < this.src.lineCount; i++) {
        const m = re.exec(sourceLine(this.src, i));
        if (!m) continue;
        const key = `${this.multi ? this.sectionAt(i) : 0}:${m[1]!.toUpperCase()}`;
        if (!this.labels.has(key)) this.labels.set(key, i);
      }
    }
    return this.labels.get(`${this.multi ? this.sectionAt(at) : 0}:${name.toUpperCase()}`) ?? -1;
  }

  // ── 다른 프로그램 부르기(CALL PGM, DIN/ISO %이름) — 함께 연 파일·같은 글의 BEGIN PGM 구획 ──
  private pgmIndex(): { names: string[]; head: number; body: number; end: number; job: boolean }[] {
    if (this.pgms) return this.pgms;
    const out: { names: string[]; head: number; body: number; end: number; job: boolean }[] = [];
    const reBegin = /^\s*(?:N?\d+\s+)?BEGIN\s+PGM\s+("[^"]*"|\S+)/i;
    const reIso = /^\s*%([^\s*;]+)\s+G7[01]\b/i;
    const jobs = jobFileLines(this.src);
    let last: (typeof out)[number] | null = null;
    for (let i = 0; i < this.src.lineCount; i++) {
      const job = jobs?.get(i);
      if (job !== undefined) {
        last = { names: [pgmBase(job)], head: i, body: i + 1, end: this.src.lineCount, job: true };
        out.push(last);
        continue;
      }
      const t = sourceLine(this.src, i);
      const m = reBegin.exec(t) ?? reIso.exec(t);
      if (!m) continue;
      if (last?.job && last.names.length === 1) {
        // 함께 연 파일의 머리: 파일 이름과 프로그램 이름 모두로 부를 수 있다
        last.names.push(pgmBase(m[1]!));
        last.body = i + 1;
      } else {
        last = { names: [pgmBase(m[1]!)], head: i, body: i + 1, end: this.src.lineCount, job: false };
        out.push(last);
      }
    }
    // 주 프로그램에 머리가 없으면(조각) 맨 앞을 주 프로그램 구획으로
    if (!out.length || out[0]!.job) out.unshift({ names: [pgmBase(this.name)], head: 0, body: 0, end: this.src.lineCount, job: false });
    for (let k = 0; k < out.length - 1; k++) out[k]!.end = out[k + 1]!.head;
    return (this.pgms = out);
  }

  /** 줄 i가 든 프로그램 구획 번호(첫 머리 앞이면 0) */
  private sectionAt(i: number): number {
    const p = this.pgmIndex();
    let k = 0;
    while (k + 1 < p.length && p[k + 1]!.head <= i) k++;
    return k;
  }

  private callPgm(arg: string, line: number): void {
    const want = pgmBase(arg);
    const p = this.pgmIndex();
    const cur = this.sectionAt(line);
    const target = p.findIndex((s, k) => k !== cur && s.names.includes(want));
    if (target < 0) {
      this.missingProgram(want, `CALL PGM ${want}: 프로그램을 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
      return;
    }
    if (this.stack.length > 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    const s = p[target]!;
    this.stack.push({ ret: this.pc, reps: 1, start: s.body, pgmEnd: s.end });
    this.pc = s.body;
  }

  /** 불린 프로그램의 끝(END PGM·구획 끝): 부른 곳으로 돌아간다. 불린 프로그램 안이 아니면 false */
  private returnPgm(): boolean {
    let k = this.stack.length - 1;
    while (k >= 0 && this.stack[k]!.pgmEnd === undefined) k--;
    if (k < 0) return false;
    this.pc = this.stack[k]!.ret;
    this.stack.length = k;
    return true;
  }

  private callLbl(T: string[], line: number): void {
    const name = T[2] ?? '';
    const target = this.findLabel(name, line);
    if (target < 0) {
      this.w.add(`CALL LBL ${name}: 표지가 없음`, line);
      return;
    }
    const repTok = T.findIndex((x) => /^REP/i.test(x));
    let rep = 0;
    if (repTok >= 0) {
      const v = /^REP(\d+)?/i.exec(T[repTok]!)![1] ?? T[repTok + 1];
      rep = parseInt(v ?? '0', 10) || 0;
    }
    if (target < line && repTok < 0 && this.lbl0Between(target, line)) {
      // REP 없이 앞쪽 표지를 부르고 그 사이에 LBL 0이 있으면 부프로그램 호출
      if (this.stack.length > 64) {
        this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
        this.ended = true;
        return;
      }
      this.stack.push({ ret: this.pc, reps: 1, start: target + 1 });
      this.pc = target + 1;
      return;
    }
    if (target < line) {
      // 구간 반복: LBL과 CALL 사이를 rep번 더
      if (repTok < 0) this.w.add(`CALL LBL ${name}: REP 없는 앞쪽 표지(구간 반복 0번) — 아무것도 하지 않음`, line);
      const left = this.sectionReps.get(line) ?? rep;
      if (left > 0) {
        this.sectionReps.set(line, left - 1);
        this.pc = target + 1;
      } else this.sectionReps.delete(line);
      return;
    }
    if (this.stack.length > 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.stack.push({ ret: this.pc, reps: Math.max(1, rep + (rep > 0 ? 1 : 0)), start: target + 1 });
    this.pc = target + 1;
  }

  /** 줄 a와 b 사이에 LBL 0이 있는지 */
  private lbl0Between(a: number, b: number): boolean {
    const re = this.iso ? /^\s*(?:N?\d+\s+)?G98\s+L\s*0\b/i : /^\s*(?:N?\d+\s+)?LBL\s+"?0"?\s*(?:;|$)/i;
    for (let i = a + 1; i < b; i++) if (re.test(sourceLine(this.src, i))) return true;
    return false;
  }

  private fn(b: HBlock, line: number): void {
    const m = /^FN\s*(\d+)\s*:\s*(.*)$/i.exec(b.text);
    if (!m) return;
    const k = +m[1]!;
    const body = m[2]!.trim();
    if (k <= 8 || k === 13) {
      const a = /^(Q[LRS]?\d+)\s*=\s*(.+)$/i.exec(body);
      if (!a) return;
      let e = a[2]!;
      if (k === 4) e = e.replace(/\bDIV\b/gi, '/');
      if (k === 5) e = `SQRT(${e.replace(/^SQRT\s*/i, '')})`;
      if (k === 6) e = `SIN(${e.replace(/^SIN\s*/i, '')})`;
      if (k === 7) e = `COS(${e.replace(/^COS\s*/i, '')})`;
      if (k === 8) {
        const [x, y] = e.split(/\bLEN\b/i);
        e = `SQRT((${x})^2+(${y ?? 0})^2)`;
      }
      if (k === 13) {
        const [x, y] = e.split(/\bANG\b/i);
        e = `ATAN2(${y ?? 0},${x})`;
      }
      this.q.set(a[1]!.toUpperCase(), this.expr(e));
      return;
    }
    if (k >= 9 && k <= 12) {
      const c = /^IF\s+(.+?)\s+(EQU|NE|GT|LT)\s+(.+?)\s+GOTO\s+LBL\s+(\S+)/i.exec(body);
      if (!c) return;
      const x = this.value(c[1]!);
      const y = this.value(c[3]!);
      const op = c[2]!.toUpperCase();
      const ok = op === 'EQU' ? Math.abs(x - y) < 1e-9 : op === 'NE' ? Math.abs(x - y) >= 1e-9 : op === 'GT' ? x > y : x < y;
      if (ok) {
        const t = this.findLabel(c[4]!, line);
        if (t >= 0) this.pc = t + 1;
        else this.w.add(`FN ${k}: LBL ${c[4]}이 없음`, line);
      }
      return;
    }
    if (k === 14) {
      this.w.add('FN 14 오류 신호 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.w.add(`FN ${k}은 지원하지 않음`, line);
  }

  private qAssign(text: string): void {
    const a = /^(Q[LRS]?\d+)\s*=\s*(.+)$/i.exec(text);
    // QS(글 변수)는 좌표에 쓰이지 않는다
    if (!a || /^QS/i.test(a[1]!) || a[2]!.trim().startsWith('"')) return;
    this.q.set(a[1]!.toUpperCase(), this.value(a[2]!));
  }

  /** M 낱말 처리. 블록 끝에서 할 일(M99 사이클 호출)은 afterMove로 */
  private mWords(T: string[], line: number, inCycleCall: boolean): { m99: boolean } {
    let m99 = false;
    for (const w of T) {
      const m = /^M(\d+)$/i.exec(w);
      if (!m) continue;
      const n = +m[1]!;
      if (n === 3 || n === 13) this.spindleDir = 3;
      else if (n === 4 || n === 14) this.spindleDir = 4;
      else if (n === 5 || n === 0) this.spindleDir = 0;
      if (n === 7 || n === 8 || n === 13 || n === 14) this.coolant = true;
      else if (n === 9) this.coolant = false;
      else if (n === 99) m99 = !inCycleCall;
      else if (n === 89) this.modalCall = true;
      else if (n === 2 || n === 30) {
        // 부프로그램(LBL)이 M30 뒤에 오는 것이 흔하다 — 끝
        this.ended = true;
      } else if (n === 140) this.w.add('M140(공구 축 방향 물러나기)은 그리지 않음', line);
    }
    return { m99 };
  }

  /** 낱말에서 좌표 읽기(I 증분, Q 변수, 원점 이동 반영). 주어지지 않은 축은 undefined */
  private coords(T: string[]): (number | undefined)[] {
    const out: (number | undefined)[] = [undefined, undefined, undefined];
    for (const w of T.slice(1)) {
      const m = /^(I?)([XYZ])([+-]?[\d.]*Q?[LRS]?\d*[\d.]*)$/i.exec(w);
      if (!m || m[3] === '') continue;
      const a = AXES.indexOf(m[2]!.toUpperCase());
      const v = this.value(m[3]!);
      out[a] = m[1] ? this.pos[a]! + v : v + this.shift[a]!;
    }
    return out;
  }

  /** 반경 보정·이송·M 낱말 */
  private modal(T: string[], line: number): { rapid: boolean; m99: boolean; machine: number } {
    let rapid = false;
    /** 0 = 아님, 91 = M91(기계 원점 기준), 92 = M92(기계 고정점 기준) */
    let machine = 0;
    const compBefore = this.comp;
    for (let i = 1; i < T.length; i++) {
      const w = T[i]!.toUpperCase();
      if (w === 'R0') this.comp = 0;
      else if (w === 'RL') this.comp = 1;
      else if (w === 'RR') this.comp = 2;
      else if (w === 'FMAX') rapid = true;
      else if (w === 'FAUTO' || (w === 'F' && (T[i + 1] ?? '').toUpperCase() === 'AUTO')) this.feed = this.autoFeed;
      else if (/^F[+-]?[\d.]+$/.test(w) || /^F[+-]?Q/.test(w)) this.feed = this.value(w.slice(1));
      else if (w === 'M91') machine = 91;
      else if (w === 'M92') machine = 92;
    }
    if (this.comp !== compBefore) this.compNote(line);
    const { m99 } = this.mWords(T, line, false);
    return { rapid, m99, machine };
  }

  private afterMove(m99: boolean, line: number): void {
    if (m99 || this.modalCall) this.cycleCall(line);
  }

  private setDir(x0: number, y0: number, x1: number, y1: number): void {
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 1e-12) this.lastDir = [(x1 - x0) / l, (y1 - y0) / l];
  }

  private linear(T: string[], line: number): void {
    const c = this.coords(T);
    const { rapid, m99, machine } = this.modal(T, line);
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const s0 = this.pos[a0]!;
    const s1 = this.pos[a1]!;
    if (machine && c.some((v) => v !== undefined)) {
      const mo = this.o.machineOffset;
      if (machine === 91 && mo) {
        // M91 값은 기계 원점 기준: 공작물 원점의 기계 좌표를 알면 실제 위치로
        for (let a = 0; a < 3; a++) if (c[a] !== undefined) c[a] = c[a]! - this.shift[a]! - mo[a]!;
      } else {
        const mask = (c[0] !== undefined ? 1 : 0) | (c[1] !== undefined ? 2 : 0) | (c[2] !== undefined ? 4 : 0);
        this.machSafeAxes = 1 << PLANE_AXES[this.plane]![2];
        this.w.add(`M${machine} 기계 좌표 쪽 이동 — 작업 원점의 기계 위치를 몰라 공구 축을 안전 높이(경로 맨 위 + 여유)로 그림`, line);
        if (this.machineRetract(mask, line, rapid ? MOVE_RAPID : MOVE_FEED)) this.w.add(`M${machine} X·Y 기계 위치를 몰라 그 축은 제자리에 둠`, line);
        return this.afterMove(m99, line);
      }
    }
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    if (c.some((v) => v !== undefined)) {
      this.emit(rapid ? MOVE_RAPID : MOVE_FEED, x, y, z, line, machine ? FLAG_MACHINE : 0);
      this.known |= (c[0] !== undefined ? 1 : 0) | (c[1] !== undefined ? 2 : 0) | (c[2] !== undefined ? 4 : 0);
      this.setDir(s0, s1, this.pos[a0]!, this.pos[a1]!);
    }
    this.afterMove(m99, line);
  }

  private pole(T: string[]): void {
    const [a0, a1] = PLANE_AXES[this.plane]!;
    let u = this.pos[a0]!;
    let v = this.pos[a1]!;
    for (const w of T.slice(1)) {
      const m = /^(I?)([XYZ])(.+)$/i.exec(w);
      if (!m) continue;
      const a = AXES.indexOf(m[2]!.toUpperCase());
      const val = this.value(m[3]!);
      const abs = m[1] ? this.pos[a]! + val : val + this.shift[a]!;
      if (a === a0) u = abs;
      else if (a === a1) v = abs;
    }
    this.cc = [u, v];
  }

  private drWord(T: string[]): number {
    for (const w of T) {
      const u = w.toUpperCase();
      if (u === 'DR+') return 1;
      if (u === 'DR-') return -1;
    }
    return this.dr;
  }

  private arcTo(cu: number, cv: number, ccw: boolean, x: number, y: number, z: number, line: number, extraTurns = 0): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const s = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const e = [x, y, z];
    const u0 = s[a0]! - cu;
    const v0 = s[a1]! - cv;
    const u1 = e[a0]! - cu;
    const v1 = e[a1]! - cv;
    const r0 = Math.hypot(u0, v0);
    if (r0 < 1e-9) {
      this.w.add('원호 반지름이 0 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return;
    }
    if (Math.abs(r0 - Math.hypot(u1, v1)) > Math.max(this.tol, r0 * 1e-3)) this.w.add('원호 시작·끝 반지름이 다름(나선형으로 이어 그림)', line);
    const TAU = Math.PI * 2;
    const same = Math.hypot(u1 - u0, v1 - v0) <= Math.max(1e-7, r0 * 1e-9);
    let sweep = Math.atan2(v1, u1) - Math.atan2(v0, u0);
    if (ccw) {
      if (same) sweep = TAU;
      else while (sweep <= 0) sweep += TAU;
    } else if (same) sweep = -TAU;
    else while (sweep >= 0) sweep -= TAU;
    sweep += (ccw ? 1 : -1) * TAU * extraTurns;
    const c = [0, 0, 0];
    c[a0] = cu;
    c[a1] = cv;
    c[a2] = s[a2]!;
    this.emitArc(this.plane, c, sweep, x, y, z, line);
    // 끝 접선
    const t = Math.atan2(v1, u1) + (ccw ? Math.PI / 2 : -Math.PI / 2);
    this.lastDir = [Math.cos(t), Math.sin(t)];
  }

  private circle(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    if (!this.cc) {
      this.w.add('C(원호)에 극(CC)이 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, c[0] ?? this.pos[0]!, c[1] ?? this.pos[1]!, c[2] ?? this.pos[2]!, line);
    } else this.arcTo(this.cc[0], this.cc[1], this.dr > 0, c[0] ?? this.pos[0]!, c[1] ?? this.pos[1]!, c[2] ?? this.pos[2]!, line);
    this.afterMove(m99, line);
  }

  private circleR(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    const rTok = T.slice(1).find((w) => /^R[+-]?[\d.Q]/i.test(w) && !/^R[LR0]$/i.test(w));
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    if (!rTok) {
      this.w.add('CR에 반지름 R이 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return this.afterMove(m99, line);
    }
    const R = this.value(rTok.slice(1));
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const e = [x, y, z];
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    const du = e[a0]! - su;
    const dv = e[a1]! - sv;
    const d = Math.hypot(du, dv);
    if (d < 1e-9) {
      this.w.add('CR로는 완전한 원을 만들 수 없음', line);
      return this.afterMove(m99, line);
    }
    let r = Math.abs(R);
    if (d / 2 > r) r = d / 2;
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const ccw = this.dr > 0;
    const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
    const cu = su + du / 2 - (side * h * dv) / d;
    const cv = sv + dv / 2 + (side * h * du) / d;
    this.arcTo(cu, cv, ccw, x, y, z, line);
    this.afterMove(m99, line);
  }

  private circleT(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const t = this.lastDir;
    const e = [x, y, z];
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    const wu = su - e[a0]!;
    const wv = sv - e[a1]!;
    if (!t) {
      this.w.add('CT 앞에 방향을 정할 요소가 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return this.afterMove(m99, line);
    }
    // 중심 = 시작 + n·k (n = 접선의 왼쪽 법선), |중심 - 끝| = |k|
    const nu = -t[1];
    const nv = t[0];
    const dot = nu * wu + nv * wv;
    if (Math.abs(dot) < 1e-12) {
      this.emit(MOVE_FEED, x, y, z, line);
      this.setDir(su, sv, e[a0]!, e[a1]!);
      return this.afterMove(m99, line);
    }
    const k = -(wu * wu + wv * wv) / (2 * dot);
    this.arcTo(su + nu * k, sv + nv * k, k > 0, x, y, z, line);
    this.afterMove(m99, line);
  }

  private polarParams(T: string[]): { pr?: number; ipr?: number; pa?: number; ipa?: number } {
    const o: { pr?: number; ipr?: number; pa?: number; ipa?: number } = {};
    for (const w of T.slice(1)) {
      const m = /^(I?)(PR|PA)(.+)$/i.exec(w);
      if (!m) continue;
      const v = this.value(m[3]!);
      const key = ((m[1] ? 'i' : '') + m[2]!.toLowerCase()) as 'pr' | 'ipr' | 'pa' | 'ipa';
      o[key] = v;
    }
    return o;
  }

  private linearPolar(T: string[], line: number): void {
    const { rapid, m99 } = this.modal(T, line);
    if (!this.cc) {
      this.w.add('LP에 극(CC)이 없음', line);
      return this.afterMove(m99, line);
    }
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = this.polarParams(T);
    const cu = this.cc[0];
    const cv = this.cc[1];
    const r0 = Math.hypot(this.pos[a0]! - cu, this.pos[a1]! - cv);
    const t0 = (Math.atan2(this.pos[a1]! - cv, this.pos[a0]! - cu) * 180) / Math.PI;
    const r = p.pr ?? r0 + (p.ipr ?? 0);
    const a = ((p.pa ?? t0 + (p.ipa ?? 0)) * Math.PI) / 180;
    const c = this.coords(T);
    const e = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    e[a0] = cu + r * Math.cos(a);
    e[a1] = cv + r * Math.sin(a);
    if (c[a2] !== undefined) e[a2] = c[a2]!;
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    this.emit(rapid ? MOVE_RAPID : MOVE_FEED, e[0]!, e[1]!, e[2]!, line);
    this.known = 7;
    this.setDir(su, sv, e[a0]!, e[a1]!);
    this.afterMove(m99, line);
  }

  private circlePolar(T: string[], line: number): void {
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    if (!this.cc) {
      this.w.add('CP에 극(CC)이 없음', line);
      return this.afterMove(m99, line);
    }
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = this.polarParams(T);
    const cu = this.cc[0];
    const cv = this.cc[1];
    const r = Math.hypot(this.pos[a0]! - cu, this.pos[a1]! - cv);
    const t0 = Math.atan2(this.pos[a1]! - cv, this.pos[a0]! - cu);
    const c = this.coords(T);
    const e = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    if (c[a2] !== undefined) e[a2] = c[a2]!;
    if (p.ipa !== undefined) {
      // 증분 각: 여러 바퀴(나선) 가능
      const sweep = (p.ipa * Math.PI) / 180;
      const t1 = t0 + sweep;
      e[a0] = cu + r * Math.cos(t1);
      e[a1] = cv + r * Math.sin(t1);
      const cc = [0, 0, 0];
      cc[a0] = cu;
      cc[a1] = cv;
      cc[a2] = this.pos[a2]!;
      this.emitArc(this.plane, cc, sweep, e[0]!, e[1]!, e[2]!, line);
      const tt = t1 + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.lastDir = [Math.cos(tt), Math.sin(tt)];
    } else {
      const a = p.pa !== undefined ? (p.pa * Math.PI) / 180 : t0;
      e[a0] = cu + r * Math.cos(a);
      e[a1] = cv + r * Math.sin(a);
      this.arcTo(cu, cv, this.dr > 0, e[0]!, e[1]!, e[2]!, line);
    }
    this.afterMove(m99, line);
  }

  // ───────────────────────── FK 자유 윤곽 ─────────────────────────

  /**
   * FK(FPOL·FL·FLT·FC·FCT): 한 블록 안의 자료로 끝점이 정해지는 경우만 그린다.
   * FL: 끝점 X·Y(I 증분), PR·PA(FPOL 기준 극좌표), 방향 AN(IAN = 앞 요소 방향에 더함, FLT = 앞 요소 접선) + LEN 또는 좌표 하나.
   * FC: 방향 DR±, 중심 CCX·CCY(ICC 증분, CCPR·CCPA 극좌표), 반지름 R, 끝점(좌표 둘 또는 하나), FCT = 앞 요소에 접함.
   */
  private fk(kind: string, T: string[], line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    if (kind === 'FPOL') {
      let u = this.fkPole?.[0] ?? this.pos[a0]!;
      let v = this.fkPole?.[1] ?? this.pos[a1]!;
      for (const w of T.slice(1)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const val = this.value(m[3]!);
        const abs = m[1] ? this.pos[a]! + val : val + this.shift[a]!;
        if (a === a0) u = abs;
        else if (a === a1) v = abs;
      }
      this.fkPole = [u, v];
      return;
    }
    const { rapid, m99 } = this.modal(T, line);
    const c = this.coords(T);
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    let eu = c[a0];
    let ev = c[a1];
    const ew = c[a2] ?? this.pos[a2]!;
    let an: number | undefined;
    let ian: number | undefined;
    let len: number | undefined;
    let rad: number | undefined;
    let ccu: number | undefined;
    let ccv: number | undefined;
    let pr: number | undefined;
    let pa: number | undefined;
    let ccpr: number | undefined;
    let ccpa: number | undefined;
    let rel = false;
    for (let i = 1; i < T.length; i++) {
      const w = T[i]!.toUpperCase();
      let m: RegExpExecArray | null;
      if ((m = /^(I?)AN([+-]?.+)$/.exec(w))) {
        const v = this.value(m[2]!);
        if (m[1]) ian = v;
        else an = v;
      } else if (w === 'LEN') len = this.value(T[++i] ?? '');
      else if ((m = /^LEN([+-]?.+)$/.exec(w))) len = this.value(m[1]!);
      else if ((m = /^(I?)CCP([RA])([+-]?.+)$/.exec(w))) {
        if (m[2] === 'R') ccpr = this.value(m[3]!);
        else ccpa = this.value(m[3]!);
      } else if ((m = /^(I?)CC([XYZ])([+-]?.+)$/.exec(w))) {
        const a = AXES.indexOf(m[2]!);
        const v = this.value(m[3]!);
        const abs = m[1] ? this.pos[a]! + v : v + this.shift[a]!;
        if (a === a0) ccu = abs;
        else if (a === a1) ccv = abs;
      } else if ((m = /^(I?)P([RA])([+-]?.+)$/.exec(w))) {
        if (m[2] === 'R') pr = this.value(m[3]!);
        else pa = this.value(m[3]!);
      } else if ((m = /^R([+-]?(?:[\d.]+|Q[LRS]?\d+))$/.exec(w))) rad = Math.abs(this.value(m[1]!));
      else if (/^(?:RX|RY|RZ|PDX|PDY|PDZ|RAN|RLEN|RCCX|RCCY|RPR|RPA|PAR|PDX\d|RX\d)/.test(w)) rel = true;
    }
    if (rel) this.w.add('FK 상대 자료(RX·PDX·PAR 등, 다른 블록 참조)는 지원하지 않음', line);
    const pole = this.fkPole ?? this.cc;
    if (pr !== undefined && pa !== undefined && pole && (eu === undefined || ev === undefined)) {
      const t = (pa * Math.PI) / 180;
      eu = pole[0] + pr * Math.cos(t);
      ev = pole[1] + pr * Math.sin(t);
    }
    const tangent = kind === 'FLT' || kind === 'FCT' ? this.lastDir : null;
    if ((kind === 'FLT' || kind === 'FCT') && !tangent) this.w.add(`${kind}: 앞에 접선을 정할 요소가 없음`, line);
    const put = (u: number, v: number): number[] => {
      const p = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
      p[a0] = u;
      p[a1] = v;
      p[a2] = ew;
      return p;
    };
    const fail = (why: string): void => {
      this.w.add(`${kind}: ${why} — 다음 블록 자료가 필요한 FK는 그리지 않음`, line);
      if (c[a2] !== undefined) {
        const p = put(su, sv);
        this.emit(MOVE_FEED, p[0]!, p[1]!, p[2]!, line);
      }
      this.afterMove(m99, line);
    };
    if (kind === 'FL' || kind === 'FLT') {
      // 방향
      let dir: [number, number] | null = null;
      if (an !== undefined) dir = [Math.cos((an * Math.PI) / 180), Math.sin((an * Math.PI) / 180)];
      else if (ian !== undefined && this.lastDir) {
        const t = Math.atan2(this.lastDir[1], this.lastDir[0]) + (ian * Math.PI) / 180;
        dir = [Math.cos(t), Math.sin(t)];
      } else if (tangent) dir = [tangent[0], tangent[1]];
      if (eu === undefined || ev === undefined) {
        if (dir && len !== undefined) {
          eu = su + dir[0] * len;
          ev = sv + dir[1] * len;
        } else if (dir && eu !== undefined && Math.abs(dir[0]) > 1e-12) {
          ev = sv + ((eu - su) / dir[0]) * dir[1];
        } else if (dir && ev !== undefined && Math.abs(dir[1]) > 1e-12) {
          eu = su + ((ev - sv) / dir[1]) * dir[0];
        } else if (eu === undefined && ev === undefined && len === undefined && dir === null && c[a2] !== undefined) {
          eu = su;
          ev = sv;
        }
      }
      if (eu === undefined || ev === undefined) return fail('끝점을 정할 자료가 모자람');
      const p = put(eu, ev);
      this.emit(rapid ? MOVE_RAPID : MOVE_FEED, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      this.setDir(su, sv, eu, ev);
      return this.afterMove(m99, line);
    }
    // FC·FCT
    const ccw = this.drWord(T) > 0;
    this.dr = ccw ? 1 : -1;
    if (ccpr !== undefined && ccpa !== undefined && pole && (ccu === undefined || ccv === undefined)) {
      const t = (ccpa * Math.PI) / 180;
      ccu = pole[0] + ccpr * Math.cos(t);
      ccv = pole[1] + ccpr * Math.sin(t);
    }
    if ((ccu === undefined || ccv === undefined) && tangent && rad !== undefined) {
      // 접선 왼쪽(DR+) 또는 오른쪽(DR-)으로 R만큼
      const k = ccw ? 1 : -1;
      ccu = su - tangent[1] * rad * k;
      ccv = sv + tangent[0] * rad * k;
    }
    if (ccu !== undefined && ccv !== undefined) {
      const R = Math.hypot(su - ccu, sv - ccv);
      if (eu === undefined || ev === undefined) {
        // 좌표 하나: 원과 직선의 교점 중 진행 방향으로 먼저 닿는 것
        const known = eu !== undefined ? 0 : ev !== undefined ? 1 : -1;
        if (known < 0) return fail('원호 끝점이 없음');
        const kv = known === 0 ? eu! : ev!;
        const off = kv - (known === 0 ? ccu : ccv);
        if (Math.abs(off) > R + 1e-9) return fail('끝 좌표가 원 밖');
        const h = Math.sqrt(Math.max(0, R * R - off * off));
        const t0 = Math.atan2(sv - ccv, su - ccu);
        let best: [number, number] | null = null;
        let bestSweep = Infinity;
        for (const sg of [1, -1]) {
          const pu = known === 0 ? kv : ccu + sg * h;
          const pv = known === 0 ? ccv + sg * h : kv;
          let d = Math.atan2(pv - ccv, pu - ccu) - t0;
          d = ccw ? ((d % TAU) + TAU) % TAU : ((-d % TAU) + TAU) % TAU;
          if (d < 1e-9) d = TAU;
          if (d < bestSweep) {
            bestSweep = d;
            best = [pu, pv];
          }
        }
        eu = best![0];
        ev = best![1];
      } else if (Math.abs(Math.hypot(eu - ccu, ev - ccv) - R) > Math.max(this.tol, R * 1e-3)) this.w.add(`${kind}: 끝점이 원 위에 있지 않음(나선형으로 이어 그림)`, line);
      const p = put(eu, ev);
      this.arcTo(ccu, ccv, ccw, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      return this.afterMove(m99, line);
    }
    if (eu === undefined || ev === undefined) return fail('원호 중심·끝점을 정할 자료가 모자람');
    if (tangent) {
      // FCT + 끝점: 앞 요소에 접하고 끝점을 지나는 원(CT와 같음)
      this.lastDir = tangent;
      return this.circleT(['CT', ...T.slice(1)], line);
    }
    if (rad !== undefined) {
      this.w.add(`${kind}: 반지름·끝점만으로는 해가 둘 — 짧은 호로 그림`, line);
      const du = eu - su;
      const dv = ev - sv;
      const d = Math.hypot(du, dv);
      if (d < 1e-9) return fail('시작점과 끝점이 같음');
      const r = Math.max(rad, d / 2);
      const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const side = ccw ? 1 : -1;
      const p = put(eu, ev);
      this.arcTo(su + du / 2 - (side * h * dv) / d, sv + dv / 2 + (side * h * du) / d, ccw, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      return this.afterMove(m99, line);
    }
    return fail('원호 중심·반지름이 없음');
  }

  // ───────────────────────── 밀링 사이클 ─────────────────────────

  /** 평면 좌표(u, v)와 공구 축 높이 w로 이동 */
  private go3(kind: number, u: number, v: number, w: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = [0, 0, 0];
    p[a0] = u;
    p[a1] = v;
    p[a2] = w;
    this.emit(kind, p[0]!, p[1]!, p[2]!, line, FLAG_CYCLE);
  }

  /** 평면 원호(중심 cu, cv · 중심각 sweep)로 (u, v, w)까지. 높이가 바뀌면 나선 */
  private arc3(cu: number, cv: number, sweep: number, u: number, v: number, w: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const c = [0, 0, 0];
    c[a0] = cu;
    c[a1] = cv;
    c[a2] = this.pos[a2]!;
    const e = [0, 0, 0];
    e[a0] = u;
    e[a1] = v;
    e[a2] = w;
    this.emitArc(this.plane, c, sweep, e[0]!, e[1]!, e[2]!, line, FLAG_CYCLE);
  }

  /**
   * 밀링 사이클(CYCL CALL 자리에서): 208 보어 밀링, 251 사각 포켓, 252 원 포켓, 253 홈, 256 사각 보스, 257 원 보스, 232 정면 밀링.
   * 깊이는 Q203(윗면)에서 Q202씩 Q201까지, 옆 간격은 공구 지름 × Q370. 공구 반지름은 공구 표 → TOOL DEF R(+DR).
   */
  private millCycle(n: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    let r = this.toolRadius();
    if (r === undefined) {
      this.w.add(`CYCL DEF ${n}: 공구 반지름을 몰라(TOOL DEF R 없음) 반지름 0으로 그림`, line);
      r = 0;
    }
    const setup = Math.abs(Q('Q200', 2));
    const second = Math.abs(Q('Q204', 0));
    const surface = (n === 232 ? Q('Q227', 0) : Q('Q203', 0)) + this.shift[a2]!;
    const depth = n === 232 ? Q('Q386', 0) - Q('Q227', 0) : Q('Q201', 0);
    const plungeStep = Math.abs(Q('Q202', 0));
    const up = depth < 0 ? 1 : -1;
    const zEnd = surface + depth;
    const clear = surface + up * Math.max(setup, second);
    const safe = surface + up * setup;
    const overlap = Q('Q370', 1) > 0 ? Q('Q370', 1) : 1;
    const step0 = r > 0 ? 2 * r * overlap : Infinity;
    const saveFeed = this.feed;
    const fMill = Q('Q207', this.feed || this.autoFeed);
    const fPlunge = Q('Q206', fMill);
    const climb = Q('Q351', 1) >= 0;
    const cu0 = this.pos[a0]!;
    const cv0 = this.pos[a1]!;
    if (depth === 0) {
      this.w.add(`CYCL DEF ${n}: 깊이가 0`, line);
      return;
    }
    // 깊이 단계(윗면부터)
    const levels: number[] = [];
    if (plungeStep > 0) {
      for (let k = 1; k < 10000; k++) {
        const d = surface - up * k * plungeStep;
        if (up * (d - zEnd) <= 1e-9) break;
        levels.push(d);
      }
    }
    levels.push(zEnd);
    const F = MOVE_FEED;
    const Rp = MOVE_RAPID;
    let w = this.pos[a2]!;
    const go = (kind: number, u: number, v: number, ww = w): void => {
      this.go3(kind, u, v, ww, line);
      w = ww;
    };
    // 지역 좌표(중심 c, 각 ang) → 평면
    let cu = cu0;
    let cv = cv0;
    let ca = 1;
    let sa = 0;
    const P = (lu: number, lv: number): [number, number] => [cu + lu * ca - lv * sa, cv + lu * sa + lv * ca];
    const goL = (kind: number, lu: number, lv: number): void => {
      const p = P(lu, lv);
      go(kind, p[0], p[1]);
    };
    const arcL = (lcu: number, lcv: number, sweep: number, lu: number, lv: number): void => {
      const c = P(lcu, lcv);
      const p = P(lu, lv);
      this.arc3(c[0], c[1], sweep, p[0], p[1], w, line);
    };
    /** 둥근 모서리 사각 고리(반너비 hx, hy, 모서리 rc), 오른쪽 가운데에서 시작해 ccw면 반시계 */
    const rectLoop = (hx: number, hy: number, rc: number, ccw: boolean): void => {
      rc = Math.max(0, Math.min(rc, hx, hy));
      const s = ccw ? 1 : -1;
      const q = (s * Math.PI) / 2;
      goL(F, hx, 0);
      if (hx < 1e-9 || hy < 1e-9) {
        // 폭 0인 고리: 긴 쪽으로 왕복
        goL(F, -hx, -s * hy);
        goL(F, hx, s * hy);
        goL(F, hx, 0);
        return;
      }
      goL(F, hx, s * (hy - rc));
      if (rc > 0) arcL(hx - rc, s * (hy - rc), q, hx - rc, s * hy);
      goL(F, -hx + rc, s * hy);
      if (rc > 0) arcL(-hx + rc, s * (hy - rc), q, -hx, s * (hy - rc));
      goL(F, -hx, -s * (hy - rc));
      if (rc > 0) arcL(-hx + rc, -s * (hy - rc), q, -hx + rc, -s * hy);
      goL(F, hx - rc, -s * hy);
      if (rc > 0) arcL(hx - rc, -s * (hy - rc), q, hx, -s * (hy - rc));
      goL(F, hx, 0);
    };
    const circleLoop = (rr: number, ccw: boolean): void => {
      goL(F, rr, 0);
      if (rr > 1e-9) arcL(0, 0, ccw ? TAU : -TAU, rr, 0);
    };
    this.feed = fMill;
    switch (n) {
      case 251:
      case 256: {
        const Lx = Q('Q218');
        const Wy = Q('Q219');
        const rc = Q('Q220');
        const al = Q('Q368');
        const ang = (Q(n === 251 ? 'Q224' : 'Q224') * Math.PI) / 180;
        ca = Math.cos(ang);
        sa = Math.sin(ang);
        const posK = Math.round(Q('Q367'));
        const off: [number, number] = posK === 1 ? [Lx / 2, Wy / 2] : posK === 2 ? [-Lx / 2, Wy / 2] : posK === 3 ? [-Lx / 2, -Wy / 2] : posK === 4 ? [Lx / 2, -Wy / 2] : [0, 0];
        cu = cu0 + off[0] * ca - off[1] * sa;
        cv = cv0 + off[0] * sa + off[1] * ca;
        if (!(Lx > 0 && Wy > 0)) {
          this.w.add(`CYCL DEF ${n}: 크기(Q218·Q219)가 없음`, line);
          break;
        }
        if (n === 251) {
          const hx = Lx / 2 - r - al;
          const hy = Wy / 2 - r - al;
          if (hx < -1e-9 || hy < -1e-9) {
            this.w.add('CYCL DEF 251: 공구가 포켓보다 큼', line);
            break;
          }
          const m = Math.min(hx, hy);
          const loops: number[] = [];
          for (let e = 0; e < m - 1e-9; e += step0) loops.push(e);
          loops.push(m);
          go(Rp, ...P(0, 0), clear);
          go(Rp, ...P(0, 0), safe);
          for (const d of levels) {
            goL(F, 0, 0);
            this.feed = fPlunge;
            go(F, ...P(0, 0), d);
            this.feed = fMill;
            for (let k = 0; k < loops.length; k++) {
              const e = loops[k]!;
              const last = k === loops.length - 1;
              rectLoop(hx - m + e, hy - m + e, last ? rc - r - al : 0, climb);
            }
          }
          if (al > 0 && Q('Q215') !== 1) rectLoop(Lx / 2 - r, Wy / 2 - r, rc - r, climb);
          goL(F, 0, 0);
        } else {
          // 보스: 바깥에서 안쪽으로(블랭크 Q424·Q425 → 완성 크기 + 여유)
          const hx = Lx / 2 + r + al;
          const hy = Wy / 2 + r + al;
          const bx = Math.max(Q('Q424', Lx), Lx) / 2 + r;
          const by = Math.max(Q('Q425', Wy), Wy) / 2 + r;
          const span = Math.max(bx - hx, by - hy, 0);
          const loops: number[] = [];
          for (let e = span; e > 1e-9; e -= step0) loops.push(e);
          loops.push(0);
          go(Rp, ...P(bx + r + setup, 0), clear);
          go(Rp, ...P(bx + r + setup, 0), safe);
          for (const d of levels) {
            this.feed = fPlunge;
            go(F, ...P(bx + r + setup, 0), d);
            this.feed = fMill;
            for (let k = 0; k < loops.length; k++) {
              const e = loops[k]!;
              rectLoop(hx + e, hy + e, k === loops.length - 1 ? rc + r + al : 0, !climb);
            }
            goL(F, bx + r + setup, 0);
          }
        }
        break;
      }
      case 252:
      case 257:
      case 208: {
        if (n === 208) {
          // 보어 밀링: 나선으로 내려가 바닥에서 한 바퀴
          const D = Q('Q335');
          const pitch = Math.abs(Q('Q334', 0.25));
          const rp = D / 2 - r;
          if (!(rp > 1e-9)) {
            this.w.add('CYCL DEF 208: 공구가 구멍보다 큼(또는 지름 Q335 없음)', line);
            break;
          }
          go(Rp, cu, cv, clear);
          go(Rp, cu, cv, safe);
          this.feed = fMill;
          goL(F, rp, 0);
          const travel = Math.abs(safe - zEnd);
          const turns = pitch > 0 ? travel / pitch : 1;
          const s = climb ? 1 : -1;
          const sweep = s * TAU * Math.max(turns, 1e-3);
          const ea = sweep;
          this.arc3(cu, cv, sweep, cu + rp * Math.cos(ea), cv + rp * Math.sin(ea), zEnd, line);
          w = zEnd;
          const p = [this.pos[a0]!, this.pos[a1]!];
          this.arc3(cu, cv, s * TAU, p[0]!, p[1]!, zEnd, line);
          go(F, cu, cv);
          break;
        }
        const D = Q('Q223');
        const al = n === 252 ? Q('Q368') : Q('Q368');
        if (!(D > 0)) {
          this.w.add(`CYCL DEF ${n}: 지름(Q223)이 없음`, line);
          break;
        }
        if (n === 252) {
          const rr = D / 2 - r - al;
          if (rr < -1e-9) {
            this.w.add('CYCL DEF 252: 공구가 포켓보다 큼', line);
            break;
          }
          const radii: number[] = [];
          for (let e = step0; e < rr - 1e-9; e += step0) radii.push(e);
          radii.push(Math.max(0, rr));
          go(Rp, cu, cv, clear);
          go(Rp, cu, cv, safe);
          for (const d of levels) {
            goL(F, 0, 0);
            this.feed = fPlunge;
            go(F, cu, cv, d);
            this.feed = fMill;
            for (const rk of radii) circleLoop(rk, climb);
          }
          if (al > 0 && Q('Q215') !== 1) circleLoop(D / 2 - r, climb);
          goL(F, 0, 0);
        } else {
          const rf = D / 2 + r + al;
          const rb = Math.max(Q('Q222', D), D) / 2 + r;
          const radii: number[] = [];
          for (let e = rb; e > rf + 1e-9; e -= step0) radii.push(e);
          radii.push(rf);
          const start = rb + r + setup;
          go(Rp, cu + start, cv, clear);
          go(Rp, cu + start, cv, safe);
          for (const d of levels) {
            this.feed = fPlunge;
            go(F, cu + start, cv, d);
            this.feed = fMill;
            for (const rk of radii) circleLoop(rk, !climb);
            goL(F, start, 0);
          }
        }
        break;
      }
      case 253: {
        const Ls = Q('Q218');
        const Ws = Q('Q219');
        const al = Q('Q368');
        const ang = (Q('Q374') * Math.PI) / 180;
        ca = Math.cos(ang);
        sa = Math.sin(ang);
        const half = Ls / 2 - Ws / 2;
        const posK = Math.round(Q('Q367'));
        const shiftL = posK === 1 ? Ls / 2 : posK === 2 ? half : posK === 3 ? -Ls / 2 : posK === 4 ? -half : 0;
        cu = cu0 + shiftL * ca;
        cv = cv0 + shiftL * sa;
        const rr = Ws / 2 - r - al;
        if (!(Ls > 0 && Ws > 0) || rr < -1e-9 || half < -1e-9) {
          this.w.add('CYCL DEF 253: 홈 크기(Q218·Q219)가 없거나 공구가 홈보다 큼', line);
          break;
        }
        const widths: number[] = [];
        for (let e = step0 / 2; e < rr - 1e-9; e += step0) widths.push(e);
        if (rr > 1e-9) widths.push(rr);
        const s = climb ? 1 : -1;
        go(Rp, ...P(-half, 0), clear);
        go(Rp, ...P(-half, 0), safe);
        for (const d of levels) {
          goL(F, -half, 0);
          this.feed = fPlunge;
          go(F, ...P(-half, 0), d);
          this.feed = fMill;
          goL(F, half, 0);
          for (const e of widths) {
            // 경기장 꼴: 오른쪽 반원 → 위 직선 → 왼쪽 반원 → 아래 직선
            goL(F, half, -s * e);
            arcL(half, 0, s * Math.PI, half, s * e);
            goL(F, -half, s * e);
            arcL(-half, 0, s * Math.PI, -half, -s * e);
            goL(F, half, -s * e);
          }
          goL(F, half, 0);
        }
        break;
      }
      case 232: {
        const u0 = Q('Q225') + this.shift[a0]!;
        const v0 = Q('Q226') + this.shift[a1]!;
        const Lx = Q('Q218');
        const Wy = Q('Q219');
        const strategy = Math.round(Q('Q389'));
        if (strategy === 2) this.w.add('CYCL DEF 232: Q389=2(나선)는 지그재그로 그림', line);
        const step = Number.isFinite(step0) ? step0 : Math.abs(Wy) / 10 || 1;
        const sgnW = Wy < 0 ? -1 : 1;
        const rows: number[] = [];
        for (let e = 0; e < Math.abs(Wy) - 1e-9; e += step) rows.push(v0 + sgnW * e);
        rows.push(v0 + Wy);
        const uA = u0 - r - setup;
        const uB = u0 + Lx + r + setup;
        go(Rp, uA, rows[0]!, clear);
        go(Rp, uA, rows[0]!, safe);
        for (const d of levels) {
          go(Rp, uA, rows[0]!, safe);
          this.feed = fPlunge;
          go(F, uA, rows[0]!, d);
          this.feed = fMill;
          rows.forEach((v, k) => {
            const fwd = strategy === 1 || k % 2 === 0;
            const [from, to] = fwd ? [uA, uB] : [uB, uA];
            if (strategy === 1 && k > 0) {
              go(Rp, this.pos[a0]!, this.pos[a1]!, safe);
              go(Rp, from, v, safe);
              go(F, from, v, d);
            } else go(F, from, v);
            go(F, to, v);
          });
        }
        break;
      }
    }
    go(Rp, this.pos[a0]!, this.pos[a1]!, clear);
    // 사이클 뒤 공구는 시작 자리 위(평면 위치는 CYCL CALL 자리)로
    if (n !== 232) go(Rp, cu0, cv0, clear);
    this.feed = saveFeed;
    this.known = 7;
  }

  finish(): NcProgram {
    return this.build({ name: this.o.name ?? (this.name || 'Heidenhain'), format: 'heidenhain', dialect: 'heidenhain', blocks: this.blocks, stock: this.stock });
  }

}

function indexOutsideQuotes(s: string, ch: string): number {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === ch && !q) return i;
  }
  return -1;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  // "Q1 = 5" 꼴을 한 낱말로 붙이지는 않는다(qAssign은 글 전체를 본다)
  return out;
}

/** 'R+5', 'S3000' 꼴에서 글자 뒤 값 */
function findWord(T: string[], letter: string): string | undefined {
  const re = new RegExp(`^${letter}([+-]?(?:[\\d.]+|Q[LRS]?\\d+))$`, 'i');
  for (const w of T) {
    const m = re.exec(w);
    if (m) return m[1];
  }
  return undefined;
}

/** Heidenhain 평문을 해석한다 */
export function parseHeidenhain(input: Uint8Array | ArrayBuffer | string | NcSource, opts: HeidenhainOptions = {}): NcProgram {
  const src = isSource(input) ? input : makeSource(input);
  const r = new HRunner(src, opts);
  r.run();
  return r.finish();
}
