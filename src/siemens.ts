/**
 * Siemens Sinumerik(840D sl·828D 꼴) 프로그램 해석기.
 *
 * 이동·원호·좌표 변환·반경 보정·기계 좌표 규칙은 gcode.ts의 Runner를 그대로 쓰고, 블록 읽기·식·흐름·사이클·프레임만 Siemens 꼴로 읽는다.
 *
 * 지원: `;` 주석, N 번호·표지(LABEL:), 주소 = 식(X=R1*2), 축별 AC(…)/IC(…), 원호 CR=(음수 = 180도 넘음)·I/J/K(I=AC(…) 절대 중심)·
 * AR=(여는 각)·CIP(중간점 I1/J1/K1)·TURN=(나선 바퀴), 극좌표 G110/G111/G112 + AP=·RP=, 공구 T="이름"·T번호·D·M6,
 * R 매개변수(R1·R[식])·DEF REAL/INT/BOOL 변수·PROC 매개변수, 식(+ - * / DIV MOD, 비교, AND/OR/NOT, SIN·COS·TAN·ASIN·ACOS·ATAN2·SQRT·
 * POT·ABS·TRUNC·ROUND·ROUNDUP·MIN·MAX·LN·EXP), 흐름(IF … GOTOF/GOTOB/GOTO/GOTOC, IF/ELSE/ENDIF, WHILE/ENDWHILE, FOR/ENDFOR,
 * REPEAT/UNTIL, LOOP/ENDLOOP, REPEAT 표지 [표지] P=n), 부프로그램(L123 P3, 이름, 이름(인수), CALL "이름", MCALL 이름 — 같은 글의
 * PROC·%_N_이름_SPF 머리나 함께 연 파일), RET·M17, 드릴 사이클 CYCLE81~89·CYCLE840(모달 MCALL 포함)과 HOLES1·HOLES2 점 패턴,
 * 프레임 TRANS·ATRANS·ROT·AROT(RPL·X·Y·Z)·SCALE·ASCALE·MIRROR·AMIRROR·G58·G59, 작업 좌표계 G54~G57·G505~G599,
 * 기계 좌표 쪽 이동 SUPA·G53·G153·G74·G75(위치를 모르면 안전 높이 규칙), 단위 G70/G71/G700/G710, G4 F(초)·S(회전).
 * CT(접선 원호, 모달)는 앞 요소에 접하는 원호로, RND·RNDM·CHF·CHR은 앞뒤가 직선인 모서리를 다듬는다(원호와 만나면 그대로, 경고).
 * 포켓 사이클 POCKET3(사각)·POCKET4(원)는 층마다 중심에서 바깥으로 고리 경로(38차 — pocket 참고)와 사이클 설정 _ZSD[1]·[2]·[9] 대입,
 * POCKET1(사각)·POCKET2(원)도 같은 길로 황삭·MIDF 층 윤곽 정삭(41차). 사이클 깊이 DP·DPR은 cycleDepth(DPR이 앞섬, 41차),
 * 후퇴 면·기준면이 맞지 않는 사이클(알람 61101)은 그리지 않음(planeAlarm, 43차). 후퇴 면이 기준면 아래인 드릴 사이클(위로 뚫음)은
 * 그 이동을 급속 안전 검사에서 뺀다(markFromBelow — emitter.ts, 43차).
 * 홈 사이클 LONGHOLE(원 위 긴 구멍)·SLOT1(원 위 홈)·SLOT2(원주 홈)는 층마다 왕복·홈 둘레 고리(40차 — slot 참고).
 * 선반 윤곽 거친 깎기 CYCLE95는 윤곽 부프로그램(이름·표지 구간)을 읽어 구간마다 층·언더컷·다듬질(44차 — cycle95 참고),
 * 평면 밀링 CYCLE71은 층마다 한 방향·오가는 길(44차 — cycle71 참고). DEF STRING 변수는 CYCLE95 윤곽 이름에만 읽는다.
 * 그리지 않는 것(경고): CYCLE800(기울인 평면), 그 밖의 밀링·선반 사이클(CYCLE72·CYCLE93 등), 시스템 변수($…), 배열 변수.
 */
import { ExprError } from './expr';
import { Block, Runner, ZERO3, affine, composeAffine, diagAbout, registerDialectParser, rotAbout, type Affine, type GcodeOptions } from './gcode';
import { G7X_MAX_LEVELS, cycle95Rough, g7xCorners, g7xLine, g7xOffset, g7xPolyline, g7xSide, polyMonotonic, type G7xCorner, type G7xEl } from './lathe-g7x';
import { FLAG_CYCLE, JOB_FILE_MARK, MOVE_ARC, MOVE_FEED, PLANE_AXES, type NcProgram } from './model';
import { sourceLine, type NcSource } from './text';

const DEG = Math.PI / 180;
const LET = (c: string): number => c.charCodeAt(0) - 65;
const AX = ['X', 'Y', 'Z'];
const CENTER = ['I', 'J', 'K'];

/** 무시해도 되는 낱말(가공 모양에 영향 없는 모드·제어) */
const IGNORE_WORDS = new Set([
  'SOFT', 'BRISK', 'DRIVE', 'CFC', 'CFTCP', 'CFIN', 'FFWON', 'FFWOF', 'COMPON', 'COMPOF', 'COMPCURV', 'COMPCAD', 'UPATH', 'SPATH',
  'BTAN', 'BSPLINE', 'POLY', 'ASPLINE', 'CSPLINE', 'G642', 'TRAORI', 'TRAFOOF', 'ORIWKS', 'ORIMKS', 'ORIAXES', 'ORIVECT', 'CUT2D', 'CUT3DC',
  'CUT2DF', 'CDON', 'CDOF', 'CDOF2', 'DISKUL', 'DISKUM', 'DITS', 'DITE', 'STOPRE', 'SPCON', 'SPCOF', 'SETMS', 'ACN', 'ACP', 'DC', 'FGROUP',
  'FNORM', 'FLIN', 'FCUB', 'OFFN', 'KONT', 'KONTC', 'KONTT', 'NORM', 'DIAMOF', 'DIAMON', 'DIAM90', 'DIAMCYCOF', 'PTP', 'CP', 'TCARR', 'TCOABS',
  'TCOFR', 'PAROT', 'PAROTOF', 'TOROT', 'TOROTOF', 'TOFRAME', 'TOROTZ', 'WALIMON', 'WALIMOF', 'SBLOF', 'SBLON', 'DISPLOF', 'DISPLON',
  'SUPD', 'ORIC', 'ORID', 'ORIS', 'FENDNORM', 'CTOL', 'OTOL', 'ATOL', 'SPOF', 'SPON', 'GWPSON', 'GWPSOF', 'DRFOF', 'SETPIECE',
]);
/** 무시하는 주소(값을 읽고 버린다) */
const IGNORE_ADDR = new Set(['SPOS', 'SPOSA', 'OFFN', 'ACC', 'FA', 'FL', 'SF', 'H', 'E', 'Q', 'U', 'V', 'W', 'O', 'SPI', 'OVR', 'SCC', 'LIMS', 'CTOL', 'OTOL', 'ATOL', 'ADIS', 'ADISPOS', 'FFWON', 'FFWOF', 'DITS', 'DITE', 'DISCL', 'DISR', 'DISRP', 'FAD', 'PM', 'PR', 'LF', 'DIAMCYCOF']);
/** CYCLE95 윤곽 안에서 읽지 않는 블록(흐름·호출·프레임 — 윤곽 모양을 바꿀 수 있어 그리지 않음) */
const CONTOUR_SKIP = new Set(['IF', 'ELSE', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR', 'REPEAT', 'REPEATB', 'UNTIL', 'LOOP', 'ENDLOOP', 'GOTOF', 'GOTOB', 'GOTO', 'GOTOC', 'CALL', 'PCALL', 'MCALL', 'TRANS', 'ATRANS', 'ROT', 'AROT', 'SCALE', 'ASCALE', 'MIRROR', 'AMIRROR']);
/** 지원하지 않는 사이클(그리지 않음) */
const UNSUPPORTED_CYCLE = /^(?:POCKET\d|SLOT\d|LONGHOLE|CYCLE7\d|CYCLE9\d|CYCLE6\d+|CYCLE899|CYCLE952|CYCLE930|CYCLE940|CYCLE951|CYCLE99|CYCLE98|CYCLE97|CYCLE96|CYCLE95|CYCLE92|CYCLE90|CYCLE802|CYCLE801|CYCLE90\d?|E_\w+|F_\w+)$/;

type Word = { name: string; value?: number; str?: string; mode?: 'AC' | 'IC' };
/** 평면 두 축의 프로그램 좌표 */
type P2 = readonly [number, number];
/** 밀링 사이클 이동 도구(cycleMover): 반복 문지기·G0~G3 블록 이동·멈췄는지 */
interface CycleMover {
  go(): boolean;
  move(g: 0 | 1 | 2 | 3, p: P2 | null, w: number | null, f: number, c?: P2): void;
  stopped(): boolean;
}

/** 줄 글을 주석과 코드로(따옴표 밖 ;부터 주석, 코드는 따옴표 밖만 대문자) */
function splitLine(raw: string): { code: string; comment: string } {
  let q = false;
  let code = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') q = !q;
    if (c === ';' && !q) return { code, comment: raw.slice(i + 1).trim() };
    code += q ? c : c.toUpperCase();
  }
  return { code, comment: '' };
}

/** 식·낱말 읽기 */
class Scan {
  i = 0;
  constructor(readonly s: string) {}
  ws(): void {
    while (this.i < this.s.length && (this.s[this.i] === ' ' || this.s[this.i] === '\t' || this.s[this.i] === '\r')) this.i++;
  }
  end(): boolean {
    this.ws();
    return this.i >= this.s.length;
  }
  peek(): string {
    this.ws();
    return this.s[this.i] ?? '';
  }
  eat(t: string): boolean {
    this.ws();
    if (this.s.startsWith(t, this.i)) {
      this.i += t.length;
      return true;
    }
    return false;
  }
  /** 낱말(뒤에 글자·숫자가 이어지지 않을 때만) */
  eatWord(w: string): boolean {
    this.ws();
    if (this.s.startsWith(w, this.i) && !/[A-Z0-9_]/.test(this.s[this.i + w.length] ?? '')) {
      this.i += w.length;
      return true;
    }
    return false;
  }
  ident(): string {
    this.ws();
    const m = /^[A-Z_$][A-Z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }
  number(): number | undefined {
    this.ws();
    const m = /^[-+]?\s*(?:\d+\.?\d*|\.\d+)/.exec(this.s.slice(this.i));
    if (!m) return undefined;
    this.i += m[0].length;
    return parseFloat(m[0].replace(/\s+/g, ''));
  }
  str(): string | undefined {
    this.ws();
    if (this.s[this.i] !== '"') return undefined;
    const e = this.s.indexOf('"', this.i + 1);
    if (e < 0) throw new ExprError('" 없음');
    const v = this.s.slice(this.i + 1, e);
    this.i = e + 1;
    return v;
  }
  rest(): string {
    return this.s.slice(this.i).trim();
  }
}

interface SFrame {
  kind: 'sub' | 'rep';
  ret: number;
  start: number;
  /** 구간 반복의 끝 줄 */
  end?: number;
  reps: number;
  locals: Map<string, number> | null;
  /** 모달 호출(MCALL)로 들어왔으면 true(안에서 다시 부르지 않는다) */
  modal?: boolean;
}

interface Section {
  name: string;
  /** 머리 줄(본문은 다음 줄부터) */
  line: number;
  params: string[];
}

type ModalCall = { kind: 'cycle'; name: string; args: (number | undefined)[] } | { kind: 'sub'; name: string } | null;

class SiemensRunner extends Runner {
  private sBlk = new Block();
  private r = new Map<number, number>();
  private vars = new Map<string, number>();
  private sStack: SFrame[] = [];
  private sections = new Map<string, Section>();
  private sectionLines = new Map<number, Section>();
  private mainHeader = -1;
  /** 앞 머리에 이어진 머리 줄(같은 프로그램의 시작 — 지나가도 프로그램 끝이 아니다) */
  private chainedHeads = new Set<number>();
  private labels = new Map<string, number[]>();
  private nLines = new Map<number, number[]>();
  private kwAt: (string | undefined)[] = [];
  private forActive = new Set<number>();
  private modalCall: ModalCall = null;
  private sMotion = 0;
  private sCip = false;
  /** CT(접선 원호) — G 그룹 1처럼 모달(G0~G3·CIP가 끔) */
  private sCt = false;
  /** RNDM(모달 둥글리기 반지름, 0 = 끔) */
  private sRndm = 0;
  private pole = [0, 0];
  private ap = 0;
  private rp = 0;
  private frame: Affine | null = null;
  private toolByName = new Map<string, number>();
  private warnedWord = new Set<string>();
  /** 사이클 설정 _ZSD[n](38차 — 프로그램이 대입한 것만, 없으면 0) */
  private zsd = new Map<number, number>();
  /** DEF STRING 변수의 글 값(44차 — CYCLE95 윤곽 이름 NPP에만 쓴다) */
  private strVars = new Map<string, string>();
  /** 포켓 사이클이 만드는 이동인지(고정 사이클 표시 FLAG_CYCLE) */
  private inCycle = false;

  constructor(src: NcSource, opts: GcodeOptions, head: () => string) {
    super(src, opts, 'siemens', head);
  }

  protected override flags(): number {
    return super.flags() | (this.inCycle ? FLAG_CYCLE : 0);
  }

  // ───────────────────────── 색인 ─────────────────────────

  private index(): void {
    const n = this.src.lineCount;
    this.kwAt = new Array(n);
    let firstCode = -1;
    // 본문이 아직 없는 머리(함께 연 파일 표지 → %_N_…_SPF → PROC처럼 이어지면 마지막 머리가 본문 시작)
    let pending: Section | null = null;
    for (let i = 0; i < n; i++) {
      const raw = sourceLine(this.src, i);
      const { code, comment } = splitLine(raw);
      let sec: Section | null = null;
      const t = code.trim();
      let m: RegExpExecArray | null;
      if ((m = /^%_N_(\w+?)_(?:MPF|SPF)\b/.exec(t))) sec = { name: m[1]!, line: i, params: [] };
      else if ((m = /^(?:N\d+\s+)?PROC\s+([A-Z_][A-Z0-9_]*)\s*(?:\(([^)]*)\))?/.exec(t)))
        sec = { name: m[1]!, line: i, params: (m[2] ?? '').split(',').map((p) => (/([A-Z_][A-Z0-9_]*)\s*(?:\[[^\]]*\])?\s*$/.exec(p.trim().replace(/^VAR\s+/, ''))?.[1] ?? '')).filter(Boolean) };
      else if (!t && comment.startsWith(JOB_FILE_MARK)) {
        const name = comment.slice(JOB_FILE_MARK.length).trim().replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').toUpperCase();
        sec = { name, line: i, params: [] };
      }
      if (sec) {
        this.sectionLines.set(i, sec);
        // 머리 바로 뒤의 머리(파일 표지 뒤 %_N_…_SPF, 그 뒤 PROC): 앞 머리 이름으로 불러도 뒤 머리(인수 포함) 다음부터
        if (pending) {
          for (const [k, v] of this.sections) if (v === pending) this.sections.set(k, sec);
          this.chainedHeads.add(i);
        }
        if (!this.sections.has(sec.name)) this.sections.set(sec.name, sec);
        pending = sec;
        if (firstCode < 0) {
          firstCode = i;
          this.mainHeader = i;
        }
        continue;
      }
      if (!t) continue;
      if (t !== '%') pending = null;
      if (firstCode < 0 && t !== '%') firstCode = i;
      let s = t.replace(/^\/\d?\s*/, '');
      if ((m = /^N(\d+)\s*/.exec(s))) {
        const list = this.nLines.get(+m[1]!);
        if (list) list.push(i);
        else this.nLines.set(+m[1]!, [i]);
        s = s.slice(m[0].length);
      }
      if ((m = /^([A-Z_][A-Z0-9_]*)\s*:(?!=)\s*/.exec(s))) {
        const list = this.labels.get(m[1]!);
        if (list) list.push(i);
        else this.labels.set(m[1]!, [i]);
        s = s.slice(m[0].length);
      }
      const kw = /^[A-Z_]+/.exec(s)?.[0];
      if (kw === 'IF') {
        if (!/\bGOTO[FBC]?\b/.test(s)) this.kwAt[i] = 'IF';
      } else if (kw === 'REPEAT') {
        // "REPEAT 표지 …"는 구간 반복, 홀로 쓴 REPEAT는 UNTIL까지의 반복
        if (!/^REPEAT\s+[A-Z_]/.test(s)) this.kwAt[i] = 'REPEAT';
      } else if (kw && ['ELSE', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR', 'UNTIL', 'LOOP', 'ENDLOOP'].includes(kw)) this.kwAt[i] = kw;
    }
  }

  /** open/close 짝: line 뒤에서 같은 깊이의 close(또는 mid) 줄 */
  private matchForward(line: number, open: string, close: string[], mid: string[] = []): number {
    let depth = 0;
    for (let i = line + 1; i < this.src.lineCount; i++) {
      const k = this.kwAt[i];
      if (!k) continue;
      if (k === open) depth++;
      else if (close.includes(k) || mid.includes(k)) {
        if (depth === 0) return i;
        if (close.includes(k)) depth--;
      }
    }
    return -1;
  }
  private matchBackward(line: number, open: string, close: string): number {
    let depth = 0;
    for (let i = line - 1; i >= 0; i--) {
      const k = this.kwAt[i];
      if (k === close) depth++;
      else if (k === open) {
        if (depth === 0) return i;
        depth--;
      }
    }
    return -1;
  }

  private findTarget(name: string, line: number, dir: 'F' | 'B' | 'FB'): number {
    const nm = /^N(\d+)$/.exec(name);
    const list = (nm ? this.nLines.get(+nm[1]!) : this.labels.get(name)) ?? [];
    if (dir !== 'B') {
      const f = list.find((l) => l > line);
      if (f !== undefined) return f;
    }
    if (dir !== 'F') {
      for (let k = list.length - 1; k >= 0; k--) if (list[k]! < line || (dir === 'FB' && list[k]! <= line)) return list[k]!;
    }
    return -1;
  }

  // ───────────────────────── 실행 ─────────────────────────

  override run(): void {
    this.index();
    this.pc = 0;
    while (!this.ended) {
      // 글 끝: 마지막 파일의 부프로그램이 RET·M17 없이 끝에 닿았으면 돌아간다
      if (this.pc >= this.src.lineCount) {
        if (!this.sStack.some((f) => f.kind === 'sub')) break;
        this.subReturn(-1);
        continue;
      }
      const line = this.pc++;
      if (++this.blocks > this.maxBlocks) {
        this.w.add(`실행 블록이 ${this.maxBlocks}개를 넘어 멈춤(끝없는 반복일 수 있음)`, line);
        this.hitLimit = true;
        break;
      }
      // 다른 프로그램(부프로그램 머리·PROC·함께 연 파일)이 시작하는 줄
      if (this.sectionLines.has(line) && line !== this.mainHeader) {
        if (this.chainedHeads.has(line)) continue;
        if (this.sStack.some((f) => f.kind === 'sub')) this.subReturn(line);
        else break;
        continue;
      }
      try {
        this.step(line);
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        this.w.add(`읽을 수 없는 블록 — ${err.message}`, line);
      }
      this.afterLine(line);
      if (this.limitReached(line)) break;
    }
  }

  /** 구간 반복(REPEAT 표지)의 끝 줄을 지났으면 다시 */
  private afterLine(line: number): void {
    const f = this.sStack[this.sStack.length - 1];
    if (!f || f.kind !== 'rep' || f.end !== line || this.pc !== line + 1) return;
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
    } else {
      this.sStack.pop();
      this.pc = f.ret;
    }
  }

  private step(line: number): void {
    const { code: rawCode, comment } = splitLine(sourceLine(this.src, line));
    let code = rawCode.trim();
    if (!code) {
      if (comment) this.passComment(comment, line);
      return;
    }
    if (code.startsWith('%')) return;
    if (code.startsWith('/')) {
      if (this.o.blockDelete) return;
      code = code.replace(/^\/\d?\s*/, '');
    }
    code = code.replace(/^N\d+\s*/, '');
    code = code.replace(/^[A-Z_][A-Z0-9_]*\s*:(?!=)\s*/, '');
    if (!code) {
      if (comment) this.passComment(comment, line);
      return;
    }
    const kw = /^[A-Z_]+/.exec(code)?.[0] ?? '';
    const sc = new Scan(code);
    switch (kw) {
      case 'IF':
        sc.eatWord('IF');
        return this.sIf(sc, line);
      case 'ELSE': {
        // 참 갈래를 끝내고 들어왔다 — 짝 ENDIF 뒤로
        const e = this.matchForward(line, 'IF', ['ENDIF']);
        if (e >= 0) this.pc = e + 1;
        return;
      }
      case 'ENDIF':
      case 'LOOP':
        return;
      case 'WHILE': {
        sc.eatWord('WHILE');
        if (!this.expr(sc)) this.jumpPast(line, 'WHILE', 'ENDWHILE');
        return;
      }
      case 'ENDWHILE': {
        const w = this.matchBackward(line, 'WHILE', 'ENDWHILE');
        if (w >= 0) this.pc = w;
        return;
      }
      case 'FOR':
        sc.eatWord('FOR');
        return this.sFor(sc, line);
      case 'ENDFOR': {
        const f = this.matchBackward(line, 'FOR', 'ENDFOR');
        if (f < 0) return;
        const m = /FOR\s+(R\d+|[A-Z_][A-Z0-9_]*)\s*=/.exec(splitLine(sourceLine(this.src, f)).code);
        if (m) this.sSet(m[1]!, (this.sGet(m[1]!) ?? 0) + 1);
        this.pc = f;
        return;
      }
      case 'UNTIL': {
        sc.eatWord('UNTIL');
        if (!this.expr(sc)) {
          const r = this.matchBackward(line, 'REPEAT', 'UNTIL');
          if (r >= 0) this.pc = r + 1;
        }
        return;
      }
      case 'ENDLOOP': {
        const l = this.matchBackward(line, 'LOOP', 'ENDLOOP');
        if (l >= 0) this.pc = l + 1;
        return;
      }
      case 'REPEAT':
      case 'REPEATB':
        if (this.kwAt[line] === 'REPEAT') return;
        return this.sRepeat(sc, kw, line);
      case 'GOTOF':
      case 'GOTOB':
      case 'GOTO':
      case 'GOTOC':
        sc.eatWord(kw);
        return this.sGoto(kw, sc.ident() || sc.rest(), line);
      case 'DEF':
        sc.eatWord('DEF');
        return this.sDef(sc);
      case 'PROC':
        return;
      case 'RET':
        return this.subReturn(line);
      case 'MSG':
      case 'EXTERN':
      case 'SAVE':
      case 'STOPRE':
      case 'SETAL':
      case 'WAITM':
      case 'WAITMC':
      case 'WAITE':
      case 'STOPFIFO':
      case 'STARTFIFO':
      case 'SBLOF':
      case 'SBLON':
      case 'DISPLOF':
      case 'DISPLON':
      case 'GETD':
      case 'RELEASE':
      case 'TRAFOOF':
      case 'TRAORI':
        return;
      case 'TRANS':
      case 'ATRANS':
      case 'ROT':
      case 'AROT':
      case 'SCALE':
      case 'ASCALE':
      case 'MIRROR':
      case 'AMIRROR':
        sc.eatWord(kw);
        return this.sFrame(kw, sc);
      case 'MCALL':
        sc.eatWord('MCALL');
        return this.sMcall(sc, line);
      case 'CALL':
      case 'PCALL': {
        sc.eatWord(kw);
        const name = sc.str() ?? sc.ident();
        return this.callSub(name.replace(/^.*\//, '').replace(/_SPF$|\.SPF$/i, '').toUpperCase(), 1, [], line, false);
      }
    }
    this.sBlock(sc, line, comment);
  }

  /** 주석만 있는 줄: 프로그램 이름·공구 목록 주석을 Runner 규칙으로 읽힌다 */
  private passComment(text: string, line: number): void {
    if (text.startsWith(JOB_FILE_MARK)) return;
    const b = this.sBlk;
    b.reset();
    b.comments.push(text);
    this.exec(b, line);
  }

  // ── 변수 ──
  private sGet(name: string): number | undefined {
    const m = /^R(\d+)$/.exec(name);
    if (m) return this.r.get(+m[1]!) ?? 0;
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      const l = this.sStack[k]!.locals;
      if (l?.has(name)) return l.get(name);
      if (this.sStack[k]!.kind === 'sub') break;
    }
    return this.vars.get(name);
  }
  private sSet(name: string, v: number): void {
    const m = /^R(\d+)$/.exec(name);
    if (m) {
      this.r.set(+m[1]!, v);
      return;
    }
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      const l = this.sStack[k]!.locals;
      if (l?.has(name)) {
        l.set(name, v);
        return;
      }
      if (this.sStack[k]!.kind === 'sub') break;
    }
    this.vars.set(name, v);
  }
  private isVar(name: string): boolean {
    if (/^R\d+$/.test(name)) return true;
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      if (this.sStack[k]!.locals?.has(name)) return true;
      if (this.sStack[k]!.kind === 'sub') break;
    }
    return this.vars.has(name);
  }

  // ── 식 ──
  private expr(sc: Scan): number {
    let v = this.andExpr(sc);
    for (;;) {
      if (sc.eatWord('OR')) {
        const b = this.andExpr(sc);
        v = v !== 0 || b !== 0 ? 1 : 0;
      } else if (sc.eatWord('XOR')) {
        const b = this.andExpr(sc);
        v = (v !== 0) !== (b !== 0) ? 1 : 0;
      } else return v;
    }
  }
  private andExpr(sc: Scan): number {
    let v = this.notExpr(sc);
    while (sc.eatWord('AND')) {
      const b = this.notExpr(sc);
      v = v !== 0 && b !== 0 ? 1 : 0;
    }
    return v;
  }
  private notExpr(sc: Scan): number {
    if (sc.eatWord('NOT')) return this.notExpr(sc) === 0 ? 1 : 0;
    return this.cmpExpr(sc);
  }
  private cmpExpr(sc: Scan): number {
    const a = this.addExpr(sc);
    for (const op of ['==', '<>', '>=', '<=', '>', '<']) {
      if (sc.eat(op)) {
        const b = this.addExpr(sc);
        const eq = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        const r = op === '==' ? eq : op === '<>' ? !eq : op === '>=' ? a >= b || eq : op === '<=' ? a <= b || eq : op === '>' ? a > b && !eq : a < b && !eq;
        return r ? 1 : 0;
      }
    }
    return a;
  }
  private addExpr(sc: Scan): number {
    let v = this.mulExpr(sc);
    for (;;) {
      if (sc.eat('+')) v += this.mulExpr(sc);
      else if (sc.peek() === '-') {
        sc.i++;
        v -= this.mulExpr(sc);
      } else return v;
    }
  }
  private mulExpr(sc: Scan): number {
    let v = this.unary(sc);
    for (;;) {
      if (sc.eat('*')) v *= this.unary(sc);
      else if (sc.eat('/')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v /= b;
      } else if (sc.eatWord('DIV')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v = Math.trunc(v / b);
      } else if (sc.eatWord('MOD')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v = v % b;
      } else return v;
    }
  }
  private unary(sc: Scan): number {
    if (sc.eat('-')) return -this.unary(sc);
    if (sc.eat('+')) return this.unary(sc);
    return this.primary(sc);
  }
  private primary(sc: Scan): number {
    sc.ws();
    const c = sc.peek();
    if (c === '(') {
      sc.i++;
      const v = this.expr(sc);
      if (!sc.eat(')')) throw new ExprError(') 없음');
      return v;
    }
    if (/[0-9.]/.test(c)) {
      const v = sc.number();
      if (v === undefined) throw new ExprError('수 없음');
      return v;
    }
    if (c === '"') throw new ExprError('글 값은 식에 쓸 수 없음');
    const id = sc.ident();
    if (!id) throw new ExprError(`알 수 없는 글자 '${c}'`);
    if (id.startsWith('$')) throw new ExprError(`시스템 변수 ${id}는 읽지 않음`);
    if (id === 'TRUE') return 1;
    if (id === 'FALSE') return 0;
    if (id === 'R' && sc.peek() === '[') {
      sc.i++;
      const k = Math.round(this.expr(sc));
      if (!sc.eat(']')) throw new ExprError('] 없음');
      return this.r.get(k) ?? 0;
    }
    if (sc.peek() === '(') {
      sc.i++;
      const args: number[] = [];
      if (!sc.eat(')')) {
        for (;;) {
          args.push(this.expr(sc));
          if (sc.eat(')')) break;
          if (!sc.eat(',')) throw new ExprError(', 없음');
        }
      }
      return this.func(id, args);
    }
    if (sc.peek() === '[') throw new ExprError(`배열 변수 ${id}[…]는 읽지 않음`);
    const v = this.sGet(id);
    if (v === undefined) throw new ExprError(`모르는 변수 ${id}`);
    return v;
  }
  private func(name: string, a: number[]): number {
    const x = a[0] ?? 0;
    switch (name) {
      case 'SIN':
        return Math.sin(x * DEG);
      case 'COS':
        return Math.cos(x * DEG);
      case 'TAN':
        return Math.tan(x * DEG);
      case 'ASIN':
        return Math.asin(x) / DEG;
      case 'ACOS':
        return Math.acos(x) / DEG;
      case 'ATAN2':
        return Math.atan2(x, a[1] ?? 1) / DEG;
      case 'SQRT':
        return Math.sqrt(x);
      case 'POT':
        return x * x;
      case 'ABS':
        return Math.abs(x);
      case 'TRUNC':
        return Math.trunc(x);
      case 'ROUND':
        return Math.sign(x) * Math.round(Math.abs(x));
      case 'ROUNDUP':
        return Math.ceil(x);
      case 'MIN':
        return Math.min(...a);
      case 'MAX':
        return Math.max(...a);
      case 'LN':
        return Math.log(x);
      case 'EXP':
        return Math.exp(x);
      case 'BOUND':
        return Math.min(Math.max(a[2] ?? 0, a[0] ?? 0), a[1] ?? 0);
    }
    throw new ExprError(`함수 ${name}은 읽지 않음`);
  }

  // ── 흐름 ──
  private jumpPast(line: number, open: string, close: string): void {
    const e = this.matchForward(line, open, [close]);
    if (e < 0) {
      this.w.add(`${open}에 맞는 ${close}이 없음 — 멈춤`, line);
      this.ended = true;
    } else this.pc = e + 1;
  }

  private sIf(sc: Scan, line: number): void {
    const cond = this.expr(sc);
    for (const g of ['GOTOF', 'GOTOB', 'GOTOC', 'GOTO']) {
      if (sc.eatWord(g)) {
        const target = sc.ident() || sc.rest();
        if (cond) this.sGoto(g, target, line);
        return;
      }
    }
    if (cond) return;
    // 거짓: 짝 ELSE 다음(또는 ENDIF 다음)으로
    const e = this.matchForward(line, 'IF', ['ENDIF'], ['ELSE']);
    if (e < 0) {
      this.w.add('IF에 맞는 ENDIF가 없음 — 멈춤', line);
      this.ended = true;
    } else this.pc = e + 1;
  }

  private sFor(sc: Scan, line: number): void {
    const name = sc.ident();
    if (!name || !sc.eat('=')) throw new ExprError('FOR 변수 없음');
    const from = this.expr(sc);
    if (!sc.eatWord('TO')) throw new ExprError('FOR … TO 없음');
    const to = this.expr(sc);
    if (!this.forActive.has(line)) {
      this.forActive.add(line);
      this.sSet(name, from);
    }
    if ((this.sGet(name) ?? 0) > to + 1e-9) {
      this.forActive.delete(line);
      this.jumpPast(line, 'FOR', 'ENDFOR');
    }
  }

  private sGoto(kind: string, target: string, line: number): void {
    const t = this.findTarget(target.trim(), line, kind === 'GOTOF' ? 'F' : kind === 'GOTOB' ? 'B' : 'FB');
    if (t < 0) {
      if (kind === 'GOTOC') return;
      this.w.add(`${kind} ${target}: 표지가 없음 — 멈춤`, line);
      this.ended = true;
      return;
    }
    this.pc = t;
  }

  /** REPEAT 표지 [끝 표지] P=n — 구간을 n번 하고 REPEAT 다음 줄로 */
  private sRepeat(sc: Scan, kw: string, line: number): void {
    sc.eatWord(kw);
    const a = sc.ident();
    let b = '';
    let p = 1;
    for (;;) {
      if (sc.end()) break;
      if (sc.eatWord('P')) {
        sc.eat('=');
        p = Math.round(this.expr(sc));
      } else {
        const id = sc.ident();
        if (!id) break;
        b = id;
      }
    }
    const start = kw === 'REPEATB' ? this.findTarget(a, line, 'B') : (this.findTarget(a, line, 'B') >= 0 ? this.findTarget(a, line, 'B') : this.findTarget(a, line, 'F'));
    if (start < 0) {
      this.w.add(`REPEAT ${a}: 표지가 없음`, line);
      return;
    }
    let end = start;
    if (b) {
      end = this.findTarget(b, start, b === 'ENDLABEL' ? 'F' : 'F');
      if (end < 0) end = start;
    }
    if (p <= 0) return;
    if (this.sStack.length >= 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.sStack.push({ kind: 'rep', ret: line + 1, start, end, reps: p, locals: null });
    this.pc = start;
  }

  private sDef(sc: Scan): void {
    const type = sc.ident();
    if (sc.peek() === '[') {
      // STRING[20] 꼴
      const e = sc.s.indexOf(']', sc.i);
      sc.i = e < 0 ? sc.s.length : e + 1;
    }
    if (!['REAL', 'INT', 'BOOL', 'CHAR', 'AXIS', 'STRING', 'FRAME'].includes(type)) throw new ExprError(`DEF ${type}`);
    const numeric = type === 'REAL' || type === 'INT' || type === 'BOOL' || type === 'CHAR';
    for (;;) {
      const name = sc.ident();
      if (!name) break;
      if (sc.peek() === '[') {
        const e = sc.s.indexOf(']', sc.i);
        sc.i = e < 0 ? sc.s.length : e + 1;
        this.w.add(`배열 변수 ${name}[…]는 읽지 않음`);
      }
      let v = 0;
      let text = '';
      if (sc.eat('=')) {
        if (numeric) v = this.expr(sc);
        else text = sc.str() ?? '';
      }
      if (type === 'STRING') this.strVars.set(name, text);
      if (numeric) {
        const top = this.sStack[this.sStack.length - 1];
        if (top && top.kind === 'sub' && top.locals) top.locals.set(name, type === 'INT' ? Math.trunc(v) : v);
        else this.vars.set(name, type === 'INT' ? Math.trunc(v) : v);
      }
      if (!sc.eat(',')) break;
    }
  }

  // ── 부프로그램 ──
  /** name 부프로그램을 reps번 부른다. 못 찾으면 경고 */
  private callSub(name: string, reps: number, args: (number | undefined)[], line: number, modal: boolean): void {
    const sec = this.sections.get(name) ?? this.sections.get(name.replace(/^L0*(\d+)$/, 'L$1'));
    if (!sec) {
      this.missingProgram(name, `부프로그램 ${name}을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
      return;
    }
    if (reps <= 0) return;
    if (this.sStack.length >= 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    const locals = new Map<string, number>();
    sec.params.forEach((p, k) => locals.set(p, args[k] ?? 0));
    this.sStack.push({ kind: 'sub', ret: this.pc, start: sec.line + 1, reps, locals, modal });
    this.pc = sec.line + 1;
  }

  /** RET·M17·부프로그램 끝 */
  private subReturn(line: number): void {
    // 구간 반복 안에서 돌아가면 그 반복도 끝
    while (this.sStack.length && this.sStack[this.sStack.length - 1]!.kind === 'rep') this.sStack.pop();
    const f = this.sStack[this.sStack.length - 1];
    if (!f) {
      // 주 프로그램의 RET·M17 = 끝
      if (line >= 0) this.ended = true;
      return;
    }
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
      return;
    }
    this.sStack.pop();
    this.pc = f.ret;
  }

  private inModalCall(): boolean {
    return this.sStack.some((f) => f.modal);
  }

  private sMcall(sc: Scan, line: number): void {
    if (sc.end()) {
      this.modalCall = null;
      return;
    }
    const name = sc.ident();
    if (sc.peek() === '(') {
      const args = this.args(sc);
      if (/^CYCLE8\d+$|^CYCLE840$/.test(name)) this.modalCall = { kind: 'cycle', name, args };
      else if (this.sections.has(name)) this.modalCall = { kind: 'sub', name };
      else {
        this.w.add(`MCALL ${name}(…)은 지원하지 않음`, line);
        this.modalCall = null;
      }
      return;
    }
    this.modalCall = { kind: 'sub', name };
  }

  /**
   * ( 식, 빈칸, … ) — 빈 자리는 undefined. strs를 주면 글 값 자리("…" 또는 DEF STRING 변수 이름)의 글을 같은 차례에 적는다(44차 CYCLE95 NPP).
   * 주지 않으면 글 변수는 예전처럼 식으로 읽는다
   */
  private args(sc: Scan, strs?: (string | undefined)[]): (number | undefined)[] {
    const out: (number | undefined)[] = [];
    if (!sc.eat('(')) return out;
    if (sc.eat(')')) return out;
    for (;;) {
      sc.ws();
      const sv = strs ? /^([A-Z_][A-Z0-9_]*)\s*(?=[,)])/.exec(sc.s.slice(sc.i)) : null;
      if (sc.peek() === ',' || sc.peek() === ')') out.push(undefined);
      else if (sc.peek() === '"') {
        const s = sc.str();
        if (strs) strs[out.length] = s;
        out.push(undefined);
      } else if (sv && this.strVars.has(sv[1]!)) {
        sc.i += sv[0].length;
        strs![out.length] = this.strVars.get(sv[1]!);
        out.push(undefined);
      } else out.push(this.expr(sc));
      if (sc.eat(')')) break;
      if (!sc.eat(',')) throw new ExprError(', 없음');
    }
    return out;
  }

  // ── 프레임 ──
  private setFrame(m: Affine | null): void {
    this.frame = m;
    this.progXf = m && !isIdentity(m) ? m : null;
    this.rebuildXf();
  }

  private sFrame(kw: string, sc: Scan): void {
    const vals: (number | undefined)[] = [undefined, undefined, undefined];
    let rpl: number | undefined;
    while (!sc.end()) {
      const c = sc.peek();
      if (c === 'X' || c === 'Y' || c === 'Z') {
        sc.i++;
        const a = AX.indexOf(c);
        if (sc.eat('=')) vals[a] = this.expr(sc);
        else vals[a] = sc.number() ?? 0;
        continue;
      }
      const id = sc.ident();
      if (id === 'RPL' && sc.eat('=')) {
        rpl = this.expr(sc);
        continue;
      }
      if (!id) throw new ExprError(`알 수 없는 글자 '${c}'`);
      if (sc.eat('=')) this.expr(sc);
    }
    const sc3 = this.scale;
    const none = vals.every((v) => v === undefined) && rpl === undefined;
    let m: Affine;
    switch (kw) {
      case 'TRANS':
      case 'ATRANS':
        m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], vals.map((v) => (v ?? 0) * sc3));
        break;
      case 'ROT':
      case 'AROT': {
        if (rpl !== undefined) m = rotAbout(ZERO3, rpl, this.plane);
        else {
          // RPY: Z → Y → X 차례(프로그램 좌표 → 작업 좌표 R = Rz·Ry·Rx)
          m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
          if (vals[0]) m = composeAffine(rotAbout(ZERO3, vals[0], 2), m);
          if (vals[1]) m = composeAffine(rotAbout(ZERO3, vals[1], 1), m);
          if (vals[2]) m = composeAffine(rotAbout(ZERO3, vals[2], 0), m);
        }
        break;
      }
      case 'SCALE':
      case 'ASCALE':
        m = diagAbout(ZERO3, vals.map((v) => v ?? 1));
        break;
      default:
        m = diagAbout(ZERO3, vals.map((v) => (v !== undefined ? -1 : 1)));
    }
    if (kw.startsWith('A')) this.setFrame(this.frame ? composeAffine(this.frame, m) : m);
    else this.setFrame(none ? null : m);
  }

  // ── 블록 ──
  private toolNumber(name: string): number {
    if (/^\d+$/.test(name)) return +name;
    let n = this.toolByName.get(name);
    if (n === undefined) {
      n = 100000 + this.toolByName.size;
      this.toolByName.set(name, n);
      this.addToolInfo(n, name);
      this.setToolInfo(n, { name });
    }
    return n;
  }

  private warnOnce(key: string, msg: string, line: number): void {
    if (this.warnedWord.has(key)) return;
    this.warnedWord.add(key);
    this.w.add(msg, line);
  }

  private sBlock(sc: Scan, line: number, comment: string): void {
    const words: Word[] = [];
    const gs: number[] = [];
    const ms: number[] = [];
    const idents: string[] = [];
    const calls: { name: string; args: (number | undefined)[]; strs: (string | undefined)[] }[] = [];
    let lCall: number | undefined;
    let pRep: number | undefined;
    while (!sc.end()) {
      const c = sc.peek();
      if (/[A-Z_$]/.test(c)) {
        const nx = sc.s[sc.i + 1] ?? '';
        // 한 글자 주소 + 수(G01·X10·L100·T1), 또는 R1= 꼴 변수·X1= 꼴 주소
        if (/[A-Z]/.test(c) && /[0-9.+\-]/.test(nx)) {
          const ext = /^([A-Z])(\d+)\s*=(?!=)/.exec(sc.s.slice(sc.i));
          if (ext) {
            sc.i += ext[0].length;
            this.assignOrAddr(ext[1]! + ext[2]!, sc, words, line);
            continue;
          }
          sc.i++;
          const v = sc.number();
          if (v === undefined) throw new ExprError(`${c} 뒤에 수 없음`);
          if (c === 'G') gs.push(v);
          else if (c === 'M') ms.push(v);
          else if (c === 'L') lCall = v;
          else if (c === 'P') pRep = v;
          else if (c === 'N') {
            /* 가운데 N은 무시 */
          } else words.push({ name: c, value: v });
          continue;
        }
        const id = sc.ident();
        sc.ws();
        if (sc.s[sc.i] === '=' && sc.s[sc.i + 1] !== '=') {
          sc.i++;
          this.assignOrAddr(id, sc, words, line);
          continue;
        }
        if (id === 'R' && sc.peek() === '[') {
          sc.i++;
          const k = Math.round(this.expr(sc));
          if (!sc.eat(']') || !sc.eat('=')) throw new ExprError('R[…] = 없음');
          this.r.set(k, this.expr(sc));
          continue;
        }
        if (sc.peek() === '(') {
          const strs: (string | undefined)[] = [];
          calls.push({ name: id, args: this.args(sc, id === 'CYCLE95' ? strs : undefined), strs });
          continue;
        }
        if (id === '_ZSD' && sc.peek() === '[') {
          // 사이클 설정 _ZSD[n] = 값(38차 — 포켓 사이클의 깊이 셈·기준점)
          sc.i++;
          const k = Math.round(this.expr(sc));
          if (!sc.eat(']') || !sc.eat('=')) throw new ExprError('_ZSD[…] = 없음');
          this.zsd.set(k, this.expr(sc));
          continue;
        }
        if (sc.peek() === '[') {
          // FA[X]=… 꼴: 값을 읽고 버린다
          const e = sc.s.indexOf(']', sc.i);
          sc.i = e < 0 ? sc.s.length : e + 1;
          if (sc.eat('=')) this.skipValue(sc);
          this.warnOnce(id, `Siemens 낱말 '${id}'은(는) 무시함`, line);
          continue;
        }
        idents.push(id);
        continue;
      }
      if (c === '"') {
        sc.str();
        continue;
      }
      throw new ExprError(`알 수 없는 글자 '${c}'`);
    }

    const word = (n: string): Word | undefined => {
      for (let k = words.length - 1; k >= 0; k--) if (words[k]!.name === n) return words[k];
      return undefined;
    };
    // ── G 코드 고르기·바꾸기 ──
    const pass: number[] = [];
    let dwell = false;
    let refApproach = '';
    let poleMode = -1;
    let noMove = false;
    let frameShift = -1;
    for (const g of gs) {
      const gi = Math.round(g * 10);
      if (gi === 0 || gi === 10 || gi === 20 || gi === 30) {
        this.sMotion = gi;
        this.sCip = false;
        this.sCt = false;
        pass.push(g);
      } else if (gi === 40) dwell = true;
      else if (gi === 700 || gi === 7000) pass.push(20);
      else if (gi === 710 || gi === 7100) pass.push(21);
      else if (gi === 740 || gi === 750) refApproach = `G${g}`;
      else if (gi === 1100 || gi === 1110 || gi === 1120) poleMode = gi;
      else if (gi === 250 || gi === 260) noMove = true;
      else if (gi === 580 || gi === 590) frameShift = gi;
      else if (gi === 1530) pass.push(53);
      else if (gi >= 5050 && gi <= 5990 && gi % 10 === 0) this.selectWcs(6 + (gi / 10 - 505), line);
      else if (gi === 5000) this.warnOnce('G500', 'G500(설정 원점 끄기)은 첫 작업 좌표계와 같은 원점으로 그림', line);
      else if (gi === 3310 || gi === 3320 || gi === 630) {
        this.sMotion = 10;
        pass.push(1);
      } else if (gi === 340 || gi === 350) pass.push(33);
      else if ([1400, 1410, 1420, 1430, 1470, 1480, 2470, 2480, 3470, 3480].includes(gi)) {
        this.warnOnce(`G${g}`, `G${g}(부드러운 접근·이탈)은 끝점까지 이송 직선으로 그림`, line);
        this.sMotion = 10;
        pass.push(1);
      } else if (gi === 600 || gi === 90 || (gi >= 6410 && gi <= 6450) || (gi >= 6010 && gi <= 6030) || gi === 4500 || gi === 4510 || (gi >= 4600 && gi <= 4620) || gi === 3400 || gi === 3410 || gi === 2900 || gi === 2910 || gi === 50 || gi === 70 || gi === 40) {
        /* 정확 정지·연속 경로·모서리·이송 모드: 모양은 그대로 */
      } else pass.push(g);
    }

    // 같은 블록의 모드(G90/G91·평면·단위)는 목표점을 셈하기 전에(Runner.exec도 다시 건다)
    for (const g of pass) {
      const gi = Math.round(g * 10);
      if (gi === 900) this.absolute = true;
      else if (gi === 910) this.absolute = false;
      else if (gi === 170 || gi === 180 || gi === 190) this.plane = ((gi - 170) / 10) as 0 | 1 | 2;
      else if (gi === 200 || gi === 210) {
        this.blockInch = gi === 200;
        this.updateScale();
      }
    }
    if (pRep === undefined && word('P')?.value !== undefined) pRep = word('P')!.value;
    const [a0, a1] = PLANE_AXES[this.plane]!;

    if (dwell) {
      // G4 F = 초, G4 S = 주축 회전 수
      const f = word('F');
      const s = word('S');
      if (f?.value !== undefined) this.dwell(f.value);
      else if (s?.value !== undefined && this.speed > 0) this.dwell((s.value / this.speed) * 60);
      return;
    }

    // 기계 원점·고정점 접근(G74·G75): 기계 좌표 쪽 이동 규칙
    if (refApproach) {
      let mask = 0;
      for (let a = 0; a < 3; a++) if (word(`${AX[a]}1`) || word(AX[a]!)) mask |= 1 << a;
      if (!mask) mask = 7;
      this.machineEstimate(mask, line, refApproach);
      return;
    }

    // 극(G110·G111·G112): 이 블록의 평면 좌표는 극 위치
    if (poleMode >= 0) {
      const cur = this.progPos();
      const sc0 = this.axScale;
      const wu = word(AX[a0]!);
      const wv = word(AX[a1]!);
      const base = poleMode === 1100 ? [cur[a0]!, cur[a1]!] : poleMode === 1120 ? [this.pole[0]!, this.pole[1]!] : [0, 0];
      this.pole = [base[0]! + (wu?.value ?? 0) * sc0[a0]!, base[1]! + (wv?.value ?? 0) * sc0[a1]!];
      if (poleMode === 1110 && !wu && !wv) this.pole = [0, 0];
      words.splice(0, words.length, ...words.filter((w) => w.name !== AX[a0] && w.name !== AX[a1]));
    }

    // G58·G59: 축별 프로그램 원점 이동(대체·더하기)
    if (frameShift >= 0) {
      const t = [0, 0, 0];
      let any = false;
      for (let a = 0; a < 3; a++) {
        const w0 = word(AX[a]!);
        if (w0?.value !== undefined) {
          t[a] = w0.value * this.scale;
          any = true;
        }
      }
      if (any) {
        const m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], t);
        if (frameShift === 590 || !this.frame) this.setFrame(this.frame ? composeAffine(this.frame, m) : m);
        else {
          // G58: 이동 성분만 바꾼다
          const f = new Float64Array(this.frame);
          for (let a = 0; a < 3; a++) if (word(AX[a]!)) f[9 + a] = t[a]!;
          this.setFrame(f);
        }
      }
      noMove = true;
    }

    // ── 목표점(프로그램 좌표) ──
    const cur = Array.from(this.progPos());
    const incMode = (w: Word): boolean => (w.mode === 'IC' ? true : w.mode === 'AC' ? false : !this.absolute);
    const end = cur.slice();
    let moveAxes = 0;
    if (!noMove)
      for (let a = 0; a < 3; a++) {
        const w0 = word(AX[a]!);
        if (w0?.value === undefined) continue;
        const v = w0.value * this.axScale[a]!;
        end[a] = incMode(w0) ? cur[a]! + v : v;
        moveAxes |= 1 << a;
      }
    // 극좌표 AP·RP
    const wAp = word('AP');
    const wRp = word('RP');
    if (!noMove && (wAp || wRp)) {
      if (wAp?.value !== undefined) this.ap = wAp.mode === 'IC' ? this.ap + wAp.value : wAp.value;
      if (wRp?.value !== undefined) this.rp = wRp.mode === 'IC' ? this.rp + wRp.value * this.scale : wRp.value * this.scale;
      end[a0] = this.pole[0]! + this.rp * Math.cos(this.ap * DEG);
      end[a1] = this.pole[1]! + this.rp * Math.sin(this.ap * DEG);
      moveAxes |= (1 << a0) | (1 << a1);
    }

    // ── 원호 꼴 바꾸기 ──
    let motionOut = -1;
    let center: number[] | null = null;
    let radiusR: number | undefined;
    if (idents.includes('CIP')) {
      this.sCip = true;
      this.sCt = false;
      this.sMotion = 25;
    } else if (idents.includes('CT')) {
      // 앞 요소에 접하는 원호(끝점만 줌) — Runner에는 이송 직선으로 넘기고 그리는 자리에서 원호로 바꾼다(tangentArc)
      this.sCt = true;
      this.sMotion = 10;
      this.sCip = false;
    }
    if (this.sCt) motionOut = 10;
    const isArc = this.sMotion === 20 || this.sMotion === 30;
    if (this.sCip && moveAxes) {
      const mid = cur.slice();
      let gotMid = false;
      for (let a = 0; a < 3; a++) {
        const w0 = word(`${CENTER[a]}1`);
        if (w0?.value === undefined) continue;
        const v = w0.value * this.axScale[a]!;
        mid[a] = incMode(w0) ? cur[a]! + v : v;
        gotMid = true;
      }
      const c = gotMid ? circle3(cur, mid, end, a0, a1) : null;
      if (!c) {
        this.w.add(gotMid ? 'CIP 세 점이 한 직선 위 — 직선으로 그림' : 'CIP에 중간점(I1·J1·K1)이 없음 — 직선으로 그림', line);
        motionOut = 10;
      } else {
        motionOut = c.ccw ? 30 : 20;
        center = [0, 0, 0];
        center[a0] = c.cu;
        center[a1] = c.cv;
      }
    } else if (isArc) {
      const ar = word('AR');
      const cr = word('CR');
      if (ar?.value !== undefined) {
        const hasC = !!(word(CENTER[a0]!) || word(CENTER[a1]!));
        const ccw = this.sMotion === 30;
        if (hasC && !(moveAxes & ((1 << a0) | (1 << a1)))) {
          // 중심 + 여는 각 → 끝점
          const cu = this.centerValue(word(CENTER[a0]!), cur[a0]!);
          const cv = this.centerValue(word(CENTER[a1]!), cur[a1]!);
          const t = Math.atan2(cur[a1]! - cv, cur[a0]! - cu) + (ccw ? 1 : -1) * ar.value * DEG;
          const r = Math.hypot(cur[a0]! - cu, cur[a1]! - cv);
          end[a0] = cu + r * Math.cos(t);
          end[a1] = cv + r * Math.sin(t);
          moveAxes |= (1 << a0) | (1 << a1);
          center = [0, 0, 0];
          center[a0] = cu;
          center[a1] = cv;
        } else if (moveAxes) {
          // 끝점 + 여는 각 → 반지름(180도 넘으면 음수)
          const d = Math.hypot(end[a0]! - cur[a0]!, end[a1]! - cur[a1]!);
          const s = Math.sin((ar.value * DEG) / 2);
          if (d > 0 && Math.abs(s) > 1e-12) radiusR = ((d / 2 / Math.abs(s)) * (ar.value > 180 ? -1 : 1)) / this.scale;
        }
      } else if (cr?.value !== undefined) radiusR = cr.value;
    }

    // ── Runner 블록 ──
    const b = this.sBlk;
    b.reset();
    if (comment) b.comments.push(comment);
    for (const g of pass) b.set(6, g, true);
    if (motionOut >= 0 && !pass.some((g) => [0, 1, 2, 3].includes(g))) b.set(6, motionOut / 10, true);
    else if (this.sCip && motionOut < 0 && moveAxes) b.set(6, 1, true);
    let ret = false;
    let endProg = false;
    const inSub = this.sStack.some((f) => f.kind === 'sub');
    for (const m of ms) {
      if (m === 17) ret = true;
      else if ((m === 2 || m === 30) && inSub) ret = true;
      else if (m === 2 || m === 30) endProg = true;
      else b.set(12, m, true);
    }
    if (!noMove) {
      if (center) {
        for (let a = 0; a < 3; a++) {
          if (moveAxes & (1 << a)) {
            b.set(LET(AX[a]!), end[a]! / this.axScale[a]!, true);
            b.axAbs |= 1 << a;
          }
        }
        b.set(LET(CENTER[a0]!), center[a0]! / this.scale, true);
        b.set(LET(CENTER[a1]!), center[a1]! / this.scale, true);
        b.cAbs |= (1 << a0) | (1 << a1);
      } else {
        for (let a = 0; a < 3; a++) {
          if (!(moveAxes & (1 << a))) continue;
          b.set(LET(AX[a]!), end[a]! / this.axScale[a]!, true);
          b.axAbs |= 1 << a;
        }
        if (isArc && radiusR === undefined)
          for (let a = 0; a < 3; a++) {
            const w0 = word(CENTER[a]!);
            if (w0?.value === undefined) continue;
            b.set(LET(CENTER[a]!), w0.value, true);
            if (w0.mode === 'AC') b.cAbs |= 1 << a;
          }
        if (radiusR !== undefined) b.set(LET('R'), radiusR, true);
      }
      for (const n of ['A', 'B', 'C']) {
        const w0 = word(n);
        if (w0?.value !== undefined) b.set(LET(n), w0.value, true);
      }
      const turn = word('TURN');
      if (turn?.value !== undefined && isArc) b.set(LET('P'), turn.value + 1, true);
    }
    for (const n of ['F', 'S', 'D']) {
      const w0 = word(n);
      if (w0?.value !== undefined) b.set(LET(n), w0.value, true);
    }
    const t = word('T');
    if (t) b.set(LET('T'), t.str !== undefined ? this.toolNumber(t.str) : (t.value ?? 0), true);
    const wRndm = word('RNDM');
    if (wRndm?.value !== undefined) this.sRndm = Math.max(0, wRndm.value);
    if (idents.includes('SUPA')) b.set(6, 53, true);
    for (const id of idents) {
      if (id === 'CIP' || id === 'CT' || id === 'SUPA' || IGNORE_WORDS.has(id)) continue;
      if (/^G\d/.test(id)) continue;
      if (this.sections.has(id)) continue;
      this.warnOnce(id, `Siemens 낱말 '${id}'은(는) 무시함`, line);
    }
    if (endProg) b.set(12, 30, true);
    this.tangentArc = this.sCt && moveAxes !== 0;
    if (b.words > 0 || b.comments.length) this.exec(b, line);
    this.tangentArc = false;
    if (this.ended) return;
    // 이 블록 끝 모서리 다듬기(다음 직선·원호 이송과, 어느 조합이든): RND = 둥글리기 반지름, CHF = 모따기 선 길이,
    // CHR = 모서리에서 자르는 길이(원호 위는 현 길이), RNDM = 모달 둥글리기(직선·원호·CIP·CT 블록 모두)
    if (moveAxes !== 0) {
      const wRnd = word('RND');
      const wChf = word('CHF');
      const wChr = word('CHR');
      if (wRnd?.value !== undefined) this.requestCorner('round', wRnd.value * this.scale, line, this.plane, 'RND');
      else if (wChf?.value !== undefined) this.requestCorner('chamferHyp', wChf.value * this.scale, line, this.plane, 'CHF');
      else if (wChr?.value !== undefined) this.requestCorner('chamferLeg', wChr.value * this.scale, line, this.plane, 'CHR');
      else if (
        this.sRndm > 0 &&
        (this.sMotion === 10 || this.sMotion === 20 || this.sMotion === 30 || this.sMotion === 25) &&
        this.lastSeg?.i === this.mb.count - 1 &&
        (this.lastSeg.kind === MOVE_FEED || this.lastSeg.kind === MOVE_ARC)
      )
        this.requestCorner('round', this.sRndm * this.scale, line, this.plane, 'RNDM');
    }

    // ── 움직인 뒤: 사이클·패턴·부프로그램 ──
    const moved = moveAxes !== 0;
    for (const c of calls) {
      if (/^CYCLE8\d$|^CYCLE840$/.test(c.name)) this.sCycle(c.name, c.args, line);
      else if (c.name === 'HOLES1' || c.name === 'HOLES2') this.holes(c.name, c.args, line);
      else if (c.name === 'CYCLE832' || c.name === 'MSG' || c.name === 'SETAL') {
        /* 고속 가공 설정·글: 모양 없음 */
      } else if (c.name === 'CYCLE800') this.warnOnce('CYCLE800', 'CYCLE800 기울인 평면은 지원하지 않음(변환 없이 그림)', line);
      else if (this.sections.has(c.name)) this.callSub(c.name, 1, c.args, line, false);
      else if (c.name === 'POCKET1' || c.name === 'POCKET2' || c.name === 'POCKET3' || c.name === 'POCKET4') this.pocket(c.name, c.args, line);
      else if (c.name === 'SLOT1' || c.name === 'SLOT2' || c.name === 'LONGHOLE') this.slot(c.name, c.args, line);
      else if (c.name === 'CYCLE95') this.cycle95(c.args, c.strs[0], line);
      else if (c.name === 'CYCLE71') this.cycle71(c.args, line);
      else if (UNSUPPORTED_CYCLE.test(c.name) || /^CYCLE/.test(c.name)) this.warnOnce(c.name, `Siemens 사이클 ${c.name}은(는) 지원하지 않음(그리지 않음)`, line);
      else this.callSub(c.name, 1, c.args, line, false);
    }
    if (moved && this.modalCall && !this.inModalCall()) {
      const mc = this.modalCall;
      if (mc.kind === 'cycle') this.sCycle(mc.name, mc.args, line);
      else this.callSub(mc.name, 1, [], line, true);
    }
    if (lCall !== undefined) this.callSub(`L${Math.round(lCall)}`, Math.max(1, Math.round(pRep ?? 1)), [], line, false);
    for (const id of idents) if (this.sections.has(id)) this.callSub(id, Math.max(1, Math.round(pRep ?? 1)), [], line, false);
    if (ret) this.subReturn(line);
  }

  private centerValue(w: Word | undefined, cur: number): number {
    if (w?.value === undefined) return cur;
    const v = w.value * this.scale;
    return w.mode === 'AC' ? v : cur + v;
  }

  private skipValue(sc: Scan): void {
    if (sc.str() !== undefined) return;
    try {
      this.expr(sc);
    } catch {
      sc.i = sc.s.length;
    }
  }

  /** NAME = 값: 변수면 대입, 주소면 낱말로 */
  private assignOrAddr(name: string, sc: Scan, words: Word[], line: number): void {
    sc.ws();
    if (name.startsWith('$')) {
      this.skipValue(sc);
      this.warnOnce(name, `시스템 변수 ${name} 대입은 무시함`, line);
      return;
    }
    if (sc.peek() === '"') {
      const s = sc.str()!;
      if (name === 'T') words.push({ name, str: s });
      else if (this.strVars.has(name)) this.strVars.set(name, s);
      else if (this.isVar(name)) {
        /* 글 변수: 무시 */
      } else this.warnOnce(name, `Siemens 낱말 '${name}'은(는) 무시함`, line);
      return;
    }
    let mode: 'AC' | 'IC' | undefined;
    const m = /^(AC|IC|DC|ACP|ACN|CAC|CIC|CDC|CACP|CACN)\s*\(/.exec(sc.s.slice(sc.i));
    let v: number;
    if (m) {
      sc.i += m[0].length;
      v = this.expr(sc);
      if (!sc.eat(')')) throw new ExprError(') 없음');
      mode = m[1] === 'IC' || m[1] === 'CIC' ? 'IC' : 'AC';
    } else v = this.expr(sc);
    if (this.isVar(name)) {
      this.sSet(name, v);
      return;
    }
    if (IGNORE_ADDR.has(name)) return;
    if (/^(?:[XYZABCIJKFSTDP]|CR|AR|AP|RP|TURN|I1|J1|K1|X1|Y1|Z1|FP|RND|RNDM|CHF|CHR)$/.test(name)) {
      words.push({ name, value: v, mode });
      return;
    }
    // 처음 보는 이름 = 대입(정의 없이 쓰는 변수로 본다)
    if (/^_?[A-Z][A-Z0-9_]{2,}$/.test(name)) {
      this.vars.set(name, v);
      return;
    }
    this.warnOnce(name, `Siemens 낱말 '${name}'은(는) 무시함`, line);
  }

  // ── 드릴 사이클·점 패턴 ──
  /** 프로그램 좌표의 공구 축 높이 h → 표시 좌표(지금 평면 자리에서) */
  private level(h: number, da: number): number {
    const q = Array.from(this.progPos());
    q[da] = h;
    const out = [0, 0, 0];
    this.toDisplay(q, out);
    return out[da]!;
  }

  /**
   * 사이클 깊이 DP·DPR(a[k]·a[k + 1]) — 설명서(6FC5398-3BP20-0BA0, 2006-11) 2.1.3절 CYCLE81 44쪽: 상대 깊이 DPR은 후퇴 면·기준면의 자리로
   * 방향을 셈(기준면에서 후퇴 면 반대쪽으로 — 후퇴 면 = 기준면이면 알람 61101, planeAlarm), DP와 DPR이 둘 다 있으면 DPR이고 DP와 다르면
   * differ(그릴 때 depthDiffers로 알린다 — 컨트롤러도 대화 줄에 "Depth: Corresponding to value for relative depth"). 빠진 매개변수는 0(1.2절 17쪽)이라
   * DPR = 0은 적지 않은 것과 같다. 둘 다 없으면 undefined. rtp·rfp는 배율 s를 곱한 값이고 돌려주는 깊이도 그렇다(DP와 같은 깊이면 DP 값 그대로).
   * rel = 상대 깊이 DPR로 셈
   */
  private cycleDepth(a: (number | undefined)[], k: number, rtp: number, rfp: number, s: number): { d: number; differ: boolean; rel: boolean } | undefined {
    const dp = a[k];
    const dpr = a[k + 1];
    if (dpr !== undefined && dpr !== 0) {
      const d = rfp - (rtp >= rfp ? 1 : -1) * Math.abs(dpr) * s;
      if (dp === undefined) return { d, differ: false, rel: true };
      if (Math.abs(dp * s - d) <= 1e-9 * Math.max(1, Math.abs(d))) return { d: dp * s, differ: false, rel: true };
      return { d, differ: true, rel: true };
    }
    if (dp !== undefined) return { d: dp * s, differ: false, rel: false };
    return dpr !== undefined ? { d: rfp, differ: false, rel: false } : undefined;
  }

  /**
   * 알람 61101 "Reference plane defined incorrectly"(43차 — 설명서 2.1.3절 CYCLE81 44쪽 주): 사이클은 후퇴 면이 기준면 앞(최종 깊이까지 거리가 더 김)이라고 본다.
   * 후퇴 면 = 기준면인데 상대 깊이(DPR ≠ 0)를 주었거나, 후퇴 면이 기준면 뒤(최종 깊이까지 거리가 더 짧음)이면 알람을 내고 사이클을 하지 않는다.
   * RTP·RFP의 설명이 CYCLE81을 가리키는 사이클(CYCLE82~89·840, LONGHOLE·SLOT1·SLOT2·POCKET1~4 — 2.1.1절 40쪽: 기하 매개변수는 드릴·패턴·밀링 사이클에 같음)에 쓴다.
   * 걸리면 그 줄에 알리고 true(그리지 않음). 같은 값끼리 견주므로(배율도 같음) 수치 오차만 넘긴다
   */
  private planeAlarm(name: string, rtp: number, rfp: number, depth: { d: number; rel: boolean }, line: number): boolean {
    const tol = 1e-9 * Math.max(1, Math.abs(rtp), Math.abs(rfp), Math.abs(depth.d));
    if (depth.rel && Math.abs(rtp - rfp) <= tol) {
      this.w.add(`${name}: 후퇴 면과 기준면이 같은데 상대 깊이(DPR)를 줌(알람 61101) — 그리지 않음`, line);
      return true;
    }
    if (Math.abs(rtp - depth.d) < Math.abs(rfp - depth.d) - tol) {
      this.w.add(`${name}: 후퇴 면이 기준면보다 최종 깊이에 가까움(알람 61101) — 그리지 않음`, line);
      return true;
    }
    return false;
  }

  /**
   * 43차: 사이클이 기준면 rfp에서 최종 깊이 d로 가는 공구 축(da) 방향이 표시 좌표에서 위(+Z)로 가면(후퇴 면이 기준면 아래 — 위로 뚫음, 프레임으로
   * 뒤집힌 것 포함) 이동 first부터를 아래에서 위로 가공한 몫으로 적는다(markFromBelow). 설명서 2.1.3절 44쪽은 후퇴 면이 기준면 앞(최종 깊이에서 더 멂)
   * 이라고 보고 아니면 알람 61101이므로, 그린 사이클의 후퇴 면·안전 거리 쪽은 늘 공구가 들어오는 쪽이다. rfp·d는 progPos와 같은 단위
   */
  private markIfFromBelow(first: number, rfp: number, d: number, da: number): void {
    const q = Array.from(this.progPos());
    const p = [0, 0, 0];
    const b = [0, 0, 0];
    q[da] = rfp;
    this.toDisplay(q, p);
    q[da] = d;
    this.toDisplay(q, b);
    if (b[2]! - p[2]! > 1e-9 * Math.max(1, Math.abs(p[2]!), Math.abs(b[2]!))) this.markFromBelow(first);
  }

  /** DP와 DPR이 달라 DPR로 그린다고 알림(cycleDepth의 differ — 사이클을 그릴 때만) */
  private depthDiffers(name: string, depth: { differ: boolean }, line: number): void {
    if (depth.differ) this.w.add(`${name}: DP와 DPR이 달라 DPR 깊이로 그림`, line);
  }

  /**
   * CYCLE81~89·CYCLE840(RTP, RFP, SDIS, DP, DPR, …)을 지금 자리에서. from = 이 사이클의 몫이 시작하는 이동 번호(HOLES1·HOLES2가 자리 잡기 급속을
   * 넣어 준다 — 설명서 2.3절 92쪽: 패턴 사이클이 구멍 자리를 차례로 급속으로 찾아감. 없으면 지금부터)
   */
  private sCycle(name: string, a: (number | undefined)[], line: number, from?: number): void {
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const s = this.scale;
    const rtp = (a[0] ?? 0) * s;
    const rfp = (a[1] ?? 0) * s;
    const sdis = Math.abs(a[2] ?? 0) * s;
    const depth = this.cycleDepth(a, 3, rtp, rfp, s);
    if (!depth) {
      this.w.add(`${name}에 깊이(DP·DPR)가 없음`, line);
      return;
    }
    if (this.planeAlarm(name, rtp, rfp, depth, line)) return;
    this.depthDiffers(name, depth, line);
    const dp = depth.d;
    const up = rfp >= dp ? 1 : -1;
    const code: Record<string, number> = { CYCLE81: 810, CYCLE82: 820, CYCLE83: 830, CYCLE84: 840, CYCLE840: 840, CYCLE85: 850, CYCLE86: 860, CYCLE87: 860, CYCLE88: 880, CYCLE89: 890 };
    let c = code[name] ?? 810;
    const dtb = (k: number): number => Math.max(0, a[k] ?? 0);
    const saveQ = [this.cq, this.cp, this.cqI, this.cqJ, this.cqK, this.retractR ? 1 : 0, this.initLevel] as const;
    this.cq = 0;
    this.cp = 0;
    this.cqI = this.cqJ = this.cqK = 0;
    if (name === 'CYCLE82' || name === 'CYCLE84' || name === 'CYCLE840' || name === 'CYCLE85' || name === 'CYCLE86' || name === 'CYCLE88' || name === 'CYCLE89') this.cp = dtb(5);
    if (name === 'CYCLE83') {
      // FDEP(5) 첫 깊이 절대 · FDPR(6) 첫 깊이(기준면에서) · DAM(7) 줄이는 양 · DTB(8) · VARI(11) 0 = 칩 끊기, 1 = 칩 빼기.
      // 42차: 둘 다 있으면 상대 값 FDPR — 설명서 2.1.5절 52쪽("FDPR은 사이클에서 DPR과 같은 구실")과 5.3절 364쪽(CYCLE83 알림
      // "1. drilling depth: according to the value for the relative depth" — DP·DPR과 같은 규칙). FDEP와 다르면 알린다.
      // 빠진 매개변수는 0(1.2절 17쪽)이라 FDPR = 0은 적지 않은 것과 같다(FDEP). 같으면 FDEP 값 그대로(전과 같은 경로)
      const fdep = a[5] !== undefined ? Math.abs(rfp - a[5] * s) : undefined;
      const fdpr = a[6] !== undefined && a[6] !== 0 ? Math.abs(a[6]) * s : undefined;
      let first = fdep ?? fdpr ?? 0;
      if (fdep !== undefined && fdpr !== undefined && Math.abs(fdep - fdpr) > 1e-9 * Math.max(1, fdpr)) {
        first = fdpr;
        this.w.add(`${name}: FDEP와 FDPR이 달라 FDPR 첫 깊이로 그림`, line);
      }
      const dam = Math.abs(a[7] ?? 0) * s;
      this.cp = dtb(8);
      if (first > 0) {
        this.cqI = first;
        this.cqJ = dam;
        this.cqK = dam > 0 ? dam : first;
        this.peckFirstExtra = sdis;
      }
      c = Math.round(a[11] ?? 1) === 0 ? 730 : 830;
    }
    this.retractR = false;
    this.peckName = name;
    const first = from ?? this.mb.count;
    if (!this.xfPlane(this.plane).keeps) {
      // 기울인 프레임(ROT X/Y): 프로그램 좌표에서 구멍 길을 만들고 점마다 옮긴다(공구 축도 기운다)
      const q = this.progPos();
      const saveInit = this.initLevelProg;
      this.initLevelProg = rtp;
      this.drillAt(c, p0, p1, da, q[p0]!, q[p1]!, rfp + up * sdis, dp, line, (v) => this.toDisplay(v, v));
      this.initLevelProg = saveInit;
    } else {
      this.initLevel = this.level(rtp, da);
      const rD = this.level(rfp + up * sdis, da);
      const zD = this.level(dp, da);
      this.drillAt(c, p0, p1, da, this.pos[p0]!, this.pos[p1]!, rD, zD, line);
    }
    this.markIfFromBelow(first, rfp, dp, da);
    this.peckFirstExtra = 0;
    this.peckName = undefined;
    [this.cq, this.cp, this.cqI, this.cqJ, this.cqK] = [saveQ[0], saveQ[1], saveQ[2], saveQ[3], saveQ[4]];
    this.retractR = !!saveQ[5];
    this.initLevel = saveQ[6];
    this.known = 7;
  }

  /** HOLES1(SPCA, SPCO, STA1, FDIS, DBH, NUM)·HOLES2(CPA, CPO, RAD, STA1, INDA, NUM): 자리마다 모달 사이클 */
  private holes(name: string, a: (number | undefined)[], line: number): void {
    const mc = this.modalCall;
    if (!mc || mc.kind !== 'cycle') {
      this.w.add(`${name} 앞에 MCALL 드릴 사이클이 없음 — 자리만 지나감`, line);
    }
    const s = this.scale;
    const num = Math.max(0, Math.round(a[5] ?? 0));
    const p0 = (a[0] ?? 0) * s;
    const p1 = (a[1] ?? 0) * s;
    const ang = (a[2] ?? 0) * DEG;
    const fdis = (a[3] ?? 0) * s;
    const dbh = (a[4] ?? 0) * s;
    const r = (a[2] ?? 0) * s;
    const sta = a[3] ?? 0;
    const inda = a[4] ? a[4] : num > 0 ? 360 / num : 0;
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const b = new Block();
    // NUM이 아주 크면 이동 한도에서 멈추도록 자리를 모아 두지 않는다
    const more = this.blockLoop();
    for (let k = 0; k < num && more(); k++) {
      const u = name === 'HOLES1' ? p0 + (fdis + k * dbh) * Math.cos(ang) : p0 + r * Math.cos((sta + k * inda) * DEG);
      const v = name === 'HOLES1' ? p1 + (fdis + k * dbh) * Math.sin(ang) : p1 + r * Math.sin((sta + k * inda) * DEG);
      // 지금 높이에서 급속으로 자리 잡고 사이클
      b.reset();
      b.set(6, 0, true);
      b.set(LET(AX[a0]!), u / this.axScale[a0]!, true);
      b.set(LET(AX[a1]!), v / this.axScale[a1]!, true);
      b.axAbs = (1 << a0) | (1 << a1);
      const first = this.mb.count;
      this.exec(b, line);
      this.sMotion = 0;
      // 자리 잡기 급속도 패턴 사이클의 몫(위로 뚫는 사이클이면 급속 안전 검사에서 함께 뺀다 — markIfFromBelow)
      if (mc && mc.kind === 'cycle') this.sCycle(mc.name, mc.args, line, first);
    }

  }

  // ── 포켓 사이클 ──
  /**
   * POCKET3(사각 포켓)·POCKET4(원 포켓)(38차): SINUMERIK 840D sl/840D/840Di sl/840Di/810D 사이클 프로그래밍 설명서
   * (6FC5398-3BP20-0BA0, 2006-11 — 3.2절 사이클 설정, 3.9 POCKET3, 3.10 POCKET4. 2006-04판 6FC5398-3BP10-0BA0도 같음)의 매개변수 차례·뜻대로.
   * POCKET3(_RTP, _RFP, _SDIS, _DP, _LENG, _WID, _CRAD, _PA, _PO, _STA, _MID, _FAL, _FALD, _FFP1, _FFD, _CDIR, _VARI, _MIDA, _AP1, _AP2, _AD, _RAD1, _DP1)
   * POCKET4(_RTP, _RFP, _SDIS, _DP, _PRAD, _PA, _PO, _MID, _FAL, _FALD, _FFP1, _FFD, _CDIR, _VARI, _MIDA, _AP1, _AD, _RAD1, _DP1)
   * - 기준점: POCKET3은 _ZSD[2] = 0이면 (_PA, _PO)가 포켓 중심, 1이면 모서리(_LENG·_WID 부호가 놓이는 쪽). _STA는 첫 축에서 긴 축까지의 각으로
   *   기준점 둘레로 돌린다(_ZSD[9] = 1이면 모서리 기준이어도 중심 둘레). POCKET4는 늘 중심. _ZSD는 프로그램이 대입한 것만 쓰고 없으면 0
   * - 순서(설명서): 급속으로 후퇴 면(_RTP)에서 포켓 중심 위로 → 기준면 + 안전 거리(_RFP + _SDIS)로 → 진입 → 층마다 평면 가공 → 끝나면 후퇴 면
   *   (설명서는 POCKET1에서 "포켓 중심 위 후퇴 면"으로 끝난다고 적는다 — 같은 꼴로)
   * - 깊이: _ZSD[1] = 0이면 기준면 + 안전 거리, 1이면 기준면부터 _DP까지(황삭은 바닥 여유 _FALD만큼 위까지)를 _MID 이하의 같은 절입으로 가장 적은 층(_MID = 0이면 한 번)
   * - 진입(_VARI 십의 자리): 0 = 중심에서 수직 G0, 1 = 수직 G1(_FFD), 2 = 반지름 _RAD1·한 바퀴 깊이 _DP1의 나선(긴 축 + 쪽 자리에서 G1로 들어가 정수 바퀴,
   *   그 깊이에서 한 바퀴 더 — _FFD), 3(POCKET3) = 긴 축 왕복(왕복 길이는 사이클이 셈한다고만 적어 수직 G1로 그리고 경고)
   * - 평면 가공: 중심에서 바깥으로 고리(사각은 둥근 모서리 사각, 원은 원) — 옆 간격은 _MIDA 이하(없거나 0이면 공구 지름 × 0.8)로 고르게 나누고 가장자리 여유 _FAL까지.
   *   설명서는 고리 꼴을 적지 않아 Heidenhain 251·252와 같은 꼴(정한 것). 모서리 반지름은 공구 반지름보다 작으면 공구 반지름(공구 중심 모서리 0)
   * - 정삭(_VARI 일의 자리 2): 가장자리(_FAL > 0)는 윤곽을 한 번만 돈다(설명서 — 중심에서 바닥 여유 높이까지 급속으로 내려가 곧게 들어감, 접근 사분원은 그리지 않음),
   *   바닥(_FALD > 0)은 중심에서 _DP + _FALD + _SDIS까지 급속, _DP까지 _FFD로 내려가 바닥을 한 번(고리)
   * - 가공 방향(_CDIR): 2 = G2, 3 = G3, 0 = 하향(M3 → G3, M4 → G2), 1 = 상향(M3 → G2, M4 → G3) — 영어판 매개변수 표는 1도 "Down-cut"으로
   *   적지만 같은 절의 설명(하향·상향을 고른다)과 같은 판의 스페인어판(6FC5398-3BP10-0EA0, "1: Fresado en oposición")대로 상향
   * - 경고하고 그리는 것: 블랭크 치수(_AP1·_AP2·_AD — 온 포켓으로), POCKET4 나선 가공(_VARI 1xxx — 층마다 평면으로), 공구 반지름 모름(0으로)
   * - 그리지 않는 것: 깊이·크기 없음, 공구가 포켓보다 큼(알람 61105), _VARI가 맞지 않음(알람 61002)
   * - 이동 한도(maxMoves)는 층·고리·나선 바퀴를 돌 때마다 본다(아주 작은 _MID·_MIDA·_DP1이나 아주 큰 깊이·크기 한 줄이 한 블록에서
   *   한도를 넘게 만들지 않게). 넘으면 그 자리에서 멈추고, 그 줄에서 "이동이 …개를 넘어 나머지는 읽지 않음"으로 읽기를 멈춘다
   * 이동은 블록으로 Runner에 넘겨 프레임(TRANS·ROT·MIRROR·SCALE)·평면(G17~G19)을 그대로 따르고, 고정 사이클 이동(FLAG_CYCLE)으로 표시한다.
   * 앞의 G 모드(이동 꼴)·이송은 사이클 뒤 그대로다(설명서 3.2절)
   *
   * POCKET1(사각 포켓)·POCKET2(원 포켓)(41차): 같은 설명서 3.7절(130~135쪽)·3.8절(136~140쪽), FFD·FFP1·MID·CDIR·FAL·VARI·MIDF·FFP2·SSF는
   * 두 절이 가리키는 3.5절 SLOT1 설명(120~121쪽)대로. 고리 꼴·끝난 뒤 자리·중심에서 진입은 POCKET3·4와 같은 길을 쓴다.
   * POCKET1(RTP, RFP, SDIS, DP, DPR, LENG, WID, CRAD, CPA, CPO, STA1, FFD, FFP1, MID, CDIR, FAL, VARI, MIDF, FFP2, SSF)
   * POCKET2(RTP, RFP, SDIS, DP, DPR, PRAD, CPA, CPO, FFD, FFP1, MID, CDIR, FAL, VARI, MIDF, FFP2, SSF)
   * - 깊이: DP·DPR(cycleDepth — DPR이 앞섬), _ZSD[1]을 따름. 중심 (CPA, CPO)는 늘 중심 기준, STA1은 긴 축 각
   * - 순서(133·139쪽): 후퇴 면에서 중심 위 → 기준면 + 안전 거리 → 황삭(VARI 0·1): MID 층마다 중심에서 G1(FFD) 진입하고 가장자리 여유 FAL까지
   *   평면 가공(FFP1, 바닥 여유 없음 — 옆 간격은 공구 지름 × 0.8 이하) → 정삭(VARI 0·2): 온 가공은 안전 높이로 올라가, MIDF 이하 층마다(0이면 바닥 한 번 —
   *   "MIDF=0이면 끝 깊이까지 한 번") 중심에서 G1(FFD)으로 진입해 윤곽 한 바퀴(FFP2, 없으면 FFP1) → 중심 위 후퇴 면
   * - FAL이 너비와 공구로 허용되는 것보다 크면 그 최대로(121쪽). 모서리 CRAD가 공구 반지름보다 작으면 공구 반지름(134쪽)
   * - 가공 방향 CDIR은 매개변수 표대로 2(G2)·3(G3)만 — 그 밖은 경고하고 하향(SLOT2와 같음). SSF는 반영하지 않음(경고)
   * - 그리지 않는 것: 깊이·크기 없음, 공구가 포켓보다 큼(알람 61105 — POCKET1은 길이·너비의 반, POCKET2는 PRAD), VARI가 0·1·2가 아님(알람 61102)
   */
  private pocket(name: 'POCKET1' | 'POCKET2' | 'POCKET3' | 'POCKET4', a: (number | undefined)[], line: number): void {
    // old = POCKET1·POCKET2(41차 — 위 설명 끝), p3 = 사각(POCKET1·POCKET3)
    const old = name === 'POCKET1' || name === 'POCKET2';
    const p3 = name === 'POCKET1' || name === 'POCKET3';
    const at = (k: number): number => a[k] ?? 0;
    const rtp = at(0);
    const rfp = at(1);
    const sdis = Math.abs(at(2));
    const depth = old ? this.cycleDepth(a, 3, rtp, rfp, 1) : a[3] === undefined ? undefined : { d: a[3], differ: false, rel: false };
    if (!depth) {
      this.w.add(old ? `${name}: 깊이(DP·DPR)가 없음 — 그리지 않음` : `${name}: 깊이(_DP)가 없음 — 그리지 않음`, line);
      return;
    }
    if (this.planeAlarm(name, rtp, rfp, depth, line)) return;
    const dp = depth.d;
    // POCKET3·4: _MID부터는 두 사이클이 같은 차례(POCKET3은 10번째, POCKET4는 7번째 자리부터 — POCKET4에는 _AP2가 없다)
    // POCKET1·2: FFD, FFP1, MID, CDIR, FAL, VARI, MIDF, FFP2, SSF(POCKET1은 11번째, POCKET2는 8번째 자리부터)
    const k0 = old ? (p3 ? 11 : 8) : p3 ? 10 : 7;
    const mid = Math.abs(at(old ? k0 + 2 : k0));
    const fal = Math.abs(at(old ? k0 + 4 : k0 + 1));
    const fald = old ? 0 : Math.abs(at(k0 + 2));
    const ffp1 = at(old ? k0 + 1 : k0 + 3);
    const ffd = at(old ? k0 : k0 + 4);
    const cdir = Math.round(at(old ? k0 + 3 : k0 + 5));
    const vari = Math.round(at(k0 + (old ? 5 : 6)));
    const mida = old ? 0 : Math.abs(at(k0 + 7));
    const midf = old ? Math.abs(at(k0 + 6)) : 0;
    const ffp2 = (old ? at(k0 + 7) : 0) || ffp1;
    const ssf = old ? at(k0 + 8) : 0;
    const blank = old ? [] : p3 ? [at(18), at(19), at(20)] : [at(15), at(16)];
    const rad1 = old ? 0 : Math.abs(at(p3 ? 21 : 17));
    const dp1 = old ? 0 : Math.abs(at(p3 ? 22 : 18));
    // POCKET1·2의 VARI는 0 온 가공·1 황삭·2 정삭(매개변수 표 — 그 밖은 알람 61102), 진입은 늘 수직 G1(FFD — 설명서 순서)
    const units = old ? vari : vari % 10;
    const tens = old ? 1 : Math.floor(vari / 10) % 10;
    const hundreds = Math.floor(vari / 100) % 10;
    const thousands = Math.floor(vari / 1000);
    if (old ? !(vari >= 0 && vari <= 2) : !(vari > 0 && (units === 1 || units === 2) && hundreds === 0 && (p3 ? tens <= 3 && thousands === 0 : tens <= 2 && thousands <= 1))) {
      this.w.add(old ? `${name}: 가공 종류(VARI = ${vari})가 맞지 않음 — 그리지 않음` : `${name}: 가공 종류(_VARI = ${vari})가 맞지 않음 — 그리지 않음`, line);
      return;
    }
    const rd = this.toolRadiusFor(this.dNum >= 0 ? this.dNum : undefined);
    if (rd === undefined) this.w.add(`${name}: 공구 반지름을 몰라 반지름 0으로 그림`, line);
    // 프로그램 단위 공구 반지름(toolRadiusFor는 표시 단위)
    const r = (rd ?? 0) / this.scale;

    // 포켓 중심(프로그램 좌표)·긴 축 각·공구 중심의 완성 윤곽(반너비·모서리)
    let cu: number;
    let cv: number;
    let ang = 0;
    let hx: number;
    let hy: number;
    let rc: number;
    if (p3) {
      // POCKET1: LENG·WID·CRAD는 5~7번째, 중심 CPA·CPO·각 STA1은 8~10번째(늘 중심 기준 — _ZSD[2]는 POCKET3만)
      const j = old ? 1 : 0;
      const leng = at(4 + j);
      const wid = at(5 + j);
      const L = Math.abs(leng);
      const W = Math.abs(wid);
      if (!(L > 0 && W > 0)) {
        this.w.add(old ? 'POCKET1: 길이·너비(LENG·WID)가 없음 — 그리지 않음' : 'POCKET3: 길이·너비(_LENG·_WID)가 없음 — 그리지 않음', line);
        return;
      }
      if (r > Math.min(L, W) / 2 + 1e-9) {
        this.w.add(`${name}: 공구 반지름이 포켓보다 큼 — 그리지 않음`, line);
        return;
      }
      ang = at(9 + j) * DEG;
      if (old) {
        cu = at(8);
        cv = at(9);
      } else if ((this.zsd.get(2) ?? 0) === 1) {
        // 모서리 기준: 부호 있는 _LENG·_WID의 반만큼(_ZSD[9] = 0이면 모서리 둘레로 돈 긴 축을 따라)
        const t = (this.zsd.get(9) ?? 0) === 1 ? 0 : ang;
        cu = at(7) + (leng / 2) * Math.cos(t) - (wid / 2) * Math.sin(t);
        cv = at(8) + (leng / 2) * Math.sin(t) + (wid / 2) * Math.cos(t);
      } else {
        cu = at(7);
        cv = at(8);
      }
      hx = L / 2 - r;
      hy = W / 2 - r;
      rc = Math.max(0, Math.abs(at(6 + j)) - r);
    } else {
      // POCKET2: PRAD·CPA·CPO는 6~8번째(POCKET4는 5~7번째)
      const j = old ? 1 : 0;
      const prad = Math.abs(at(4 + j));
      if (!(prad > 0)) {
        this.w.add(old ? 'POCKET2: 포켓 반지름(PRAD)이 없음 — 그리지 않음' : 'POCKET4: 포켓 반지름(_PRAD)이 없음 — 그리지 않음', line);
        return;
      }
      if (r > prad + 1e-9) {
        this.w.add(`${name}: 공구 반지름이 포켓보다 큼 — 그리지 않음`, line);
        return;
      }
      cu = at(5 + j);
      cv = at(6 + j);
      hx = hy = rc = prad - r;
    }
    this.depthDiffers(name, depth, line);
    if (blank.some((v) => v !== 0)) this.w.add(`${name}: 블랭크 치수(_AP·_AD)는 반영하지 않고 온 포켓으로 그림`, line);
    if (!old && !p3 && thousands === 1) this.w.add('POCKET4: 나선 가공(_VARI 1xxx)은 층마다 평면 가공으로 그림', line);
    // 가공 방향: 2 = G2(시계), 3 = G3(반시계), 1 = 상향(M3 → G2, M4 → G3), 0·그 밖은 하향(M3 → G3, M4 → G2).
    // POCKET1·2의 매개변수 표는 2·3만 적어(SLOT2와 같음) 그 밖은 경고하고 하향
    let dirc = cdir;
    if (old ? cdir !== 2 && cdir !== 3 : cdir < 0 || cdir > 3) {
      this.w.add(old ? `${name}: 가공 방향(CDIR = ${cdir})이 맞지 않아 하향으로 그림` : `${name}: 가공 방향(_CDIR = ${cdir})이 맞지 않아 하향으로 그림`, line);
      if (old) dirc = 0;
    }
    const ccw = dirc === 2 ? false : dirc === 3 ? true : dirc === 1 ? this.spindleDir === 4 : this.spindleDir !== 4;
    const finishing = old && (units === 0 || units === 2);
    if (ssf && finishing) this.w.add(`${name}: 정삭 회전수(SSF)는 반영하지 않음`, line);
    // POCKET1·2: 너비와 공구로 허용되는 것보다 큰 FAL은 그 최대로(설명서 121쪽 — SLOT1 설명을 따름)
    const falE = old ? Math.min(fal, Math.max(0, Math.min(hx, hy))) : fal;

    const up = rfp >= dp ? 1 : -1;
    const safe = rfp + up * sdis;
    const top = (this.zsd.get(1) ?? 0) === 1 ? rfp : safe;
    // 이동 한도: 층·고리·나선 바퀴는 한 블록 안에서 돌아 run의 블록 사이 검사가 닿지 않으므로 여기서도 본다.
    // 반복(층·고리·바퀴) 한 번은 보통 이동을 하나 넘게 만들므로 반복 수도 남은 이동 수까지만 — 길이 0 이동만 만드는
    // 아주 작은 절입·간격도 멈춘다. 멈추면 run이 그 줄에서 "이동이 …개를 넘어 나머지는 읽지 않음"으로 읽기를 멈춘다
    const { go, move, stopped } = this.cycleMover(line);
    /** from에서 to까지 _MID(정삭 MIDF) 이하 같은 절입의 층 수(가장 적은 수 — 배열로 만들지 않는다: 아주 작은 _MID면 매우 크다) */
    const levelCount = (from: number, to: number, st = mid): number => {
      const total = up * (from - to);
      return total > 1e-9 && st > 0 ? Math.max(1, Math.ceil(total / st - 1e-9)) : 1;
    };
    /** n층 가운데 k번째(0부터) 깊이 */
    const levelAt = (from: number, to: number, n: number, k: number): number => (k >= n - 1 ? to : from - ((from - to) * (k + 1)) / n);
    /** 0에서 m까지 _MIDA 이하(없으면 공구 지름 × 0.8) 같은 간격의 칸 수 */
    const maxW = mida > 0 ? mida : 1.6 * r;
    const widthCount = (m: number): number => (maxW > 0 ? Math.max(1, Math.ceil(m / maxW - 1e-9)) : 1);

    // ── 블록으로 그리기(프로그램 좌표, 중심 (cu, cv)·긴 축 각 ang의 지역 좌표) ──
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const P = (lu: number, lv: number): [number, number] => [cu + lu * ca - lv * sa, cv + lu * sa + lv * ca];
    const lin =(lu: number, lv: number, f = ffp1): void => move(1, P(lu, lv), null, f);
    const arc = (lcu: number, lcv: number, lu: number, lv: number, w: number | null, f: number): void => move(ccw ? 3 : 2, P(lu, lv), w, f, P(lcu, lcv));
    const s = ccw ? 1 : -1;
    /** 공구 중심 고리 하나(반너비 ex·ey, 모서리 er, 이송 f) — 오른쪽 가운데에서 시작해 가공 방향으로 */
    const loop = (ex: number, ey: number, er: number, f = ffp1): void => {
      if (!p3) {
        lin(ex, 0, f);
        if (ex > 1e-9) {
          arc(0, 0, -ex, 0, null, f);
          arc(0, 0, ex, 0, null, f);
        }
        return;
      }
      er = Math.max(0, Math.min(er, ex, ey));
      lin(ex, 0, f);
      if (ex < 1e-9 || ey < 1e-9) {
        // 폭 0인 고리: 긴 쪽으로 왕복
        lin(-ex, -s * ey, f);
        lin(ex, s * ey, f);
        lin(ex, 0, f);
        return;
      }
      lin(ex, s * (ey - er), f);
      if (er > 0) arc(ex - er, s * (ey - er), ex - er, s * ey, null, f);
      lin(-ex + er, s * ey, f);
      if (er > 0) arc(-ex + er, s * (ey - er), -ex, s * (ey - er), null, f);
      lin(-ex, -s * (ey - er), f);
      if (er > 0) arc(-ex + er, -s * (ey - er), -ex + er, -s * ey, null, f);
      lin(ex - er, -s * ey, f);
      if (er > 0) arc(ex - er, -s * (ey - er), ex, -s * (ey - er), null, f);
      lin(ex, 0, f);
    };
    /** 평면 가공: 가장자리 여유 al까지 중심에서 바깥으로 고리(마지막 고리만 모서리) */
    const solid = (al: number): void => {
      const ex = hx - al;
      const ey = hy - al;
      if (ex < -1e-9 || ey < -1e-9) return;
      const m = Math.min(ex, ey);
      // 폭이 0이면 고리 하나(모서리 있는 마지막 고리), 아니면 0·m/n·…·m의 n + 1개
      const flat = !(m > 1e-9);
      const n = flat ? 0 : widthCount(m);
      for (let k = 0; k <= n && go(); k++) {
        const e = flat ? Math.max(0, m) : (m * k) / n;
        if (!p3 && e <= 1e-9) continue;
        loop(ex - m + e, ey - m + e, k === n ? rc - al : 0);
      }
      lin(0, 0);
    };
    /** 지금 높이(cur)에서 깊이 d까지 진입 */
    let cur = safe;
    const plunge = (d: number): void => {
      if (tens === 2 && rad1 > 0 && dp1 > 0) {
        // 나선: 긴 축 + 쪽 자리에서 정수 바퀴로 d까지, 그 깊이에서 한 바퀴 더
        lin(rad1, 0, ffd);
        const turns = Math.max(1, Math.ceil((up * (cur - d)) / dp1 - 1e-9));
        for (let k = 1; k <= turns && go(); k++) {
          const w1 = cur - (up * (cur - d) * (k - 0.5)) / turns;
          const w2 = cur - (up * (cur - d) * k) / turns;
          arc(0, 0, -rad1, 0, w1, ffd);
          arc(0, 0, rad1, 0, w2, ffd);
        }
        arc(0, 0, -rad1, 0, null, ffd);
        arc(0, 0, rad1, 0, null, ffd);
        lin(0, 0);
      } else move(tens === 0 ? 0 : 1, null, d, ffd);
      cur = d;
    };
    if (tens === 2 && !(rad1 > 0 && dp1 > 0)) this.w.add(`${name}: 나선 진입 반지름·깊이(_RAD1·_DP1)가 없어 수직 이송으로 그림`, line);
    if (p3 && tens === 3) this.w.add('POCKET3: 긴 축 왕복 진입(_VARI 3X)은 수직 이송으로 그림', line);

    const save = { motion: this.motion, sMotion: this.sMotion, feed: this.feed };
    const first = this.mb.count;
    this.inCycle = true;
    try {
      // 후퇴 면으로 올라가 포켓 중심 위 → 기준면 + 안전 거리
      move(0, null, rtp, 0);
      move(0, P(0, 0), null, 0);
      move(0, null, safe, 0);
      if (old) {
        // POCKET1·2(설명서 133·139쪽): 황삭(VARI 0·1)은 MID 층마다 중심에서 G1(FFD) 진입해 가장자리 여유까지 평면 가공(FFP1),
        // 정삭(VARI 0·2)은 MIDF 층마다(0이면 바닥 한 번 — 121쪽) 중심에서 진입해 윤곽 한 바퀴(FFP2, 없으면 FFP1). 온 가공은 황삭 뒤 안전 높이로 올라간다
        if (units !== 2) {
          const n = levelCount(top, dp);
          for (let k = 0; k < n && go(); k++) {
            plunge(levelAt(top, dp, n, k));
            solid(falE);
          }
        }
        if (finishing) {
          if (units === 0) move(0, null, safe, 0);
          const n = levelCount(top, dp, midf);
          for (let k = 0; k < n && go(); k++) {
            move(1, null, levelAt(top, dp, n, k), ffd);
            loop(hx, hy, rc, ffp2);
            lin(0, 0, ffp2);
          }
        }
      } else if (units === 1) {
        const to = dp + up * fald;
        const n = levelCount(top, to);
        for (let k = 0; k < n && go(); k++) {
          plunge(levelAt(top, to, n, k));
          solid(fal);
        }
      } else {
        // 정삭: 가장자리는 바닥 여유 높이까지 급속으로 내려가 윤곽 한 바퀴만, 그다음 바닥 한 번
        if (fal > 0) {
          move(0, null, dp + up * fald, 0);
          loop(hx, hy, rc);
          lin(0, 0);
        }
        if (fald > 0) {
          move(0, null, dp + up * (fald + sdis), 0);
          move(1, null, dp, ffd);
          solid(0);
        }
      }
      move(0, null, rtp, 0);
    } finally {
      this.inCycle = false;
      this.motion = save.motion;
      this.sMotion = save.sMotion;
      this.feed = save.feed;
    }
    this.markIfFromBelow(first, rfp * this.scale, dp * this.scale, PLANE_AXES[this.plane]![2]!);
    if (stopped()) this.mb.overflow = true;
    this.known = 7;
  }

  /**
   * 밀링 사이클(POCKET1~4, SLOT1·2, LONGHOLE)의 이동 도구: 프로그램 좌표(평면 두 축 p·공구 축 w·원호 중심 c — 모두 절대)로 G0~G3 블록을 만들어
   * Runner에 넘기므로 프레임(TRANS·ROT·MIRROR·SCALE)·평면(G17~G19)을 그대로 따른다. 층·고리·홈·바퀴를 돌 때마다 go()로 이동 한도를 본다 —
   * 반복 한 번은 보통 이동을 하나 넘게 만들므로 반복 수도 남은 이동 수까지만(길이 0 이동만 만드는 아주 작은 절입·간격도 멈춘다).
   * 멈췄으면(stopped) 부른 쪽이 mb.overflow를 켜 run이 그 줄에서 "이동이 …개를 넘어 나머지는 읽지 않음"으로 읽기를 멈춘다
   */
  private cycleMover(line: number): CycleMover {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const budget = Math.max(0, this.maxMoves - this.mb.count);
    let steps = 0;
    let stop = false;
    const b = new Block();
    return {
      go: (): boolean => {
        if (!stop && (this.mb.count >= this.maxMoves || ++steps > budget)) stop = true;
        return !stop;
      },
      move: (g, p, w, f, c): void => {
        if (stop) return;
        b.reset();
        b.set(6, g, true);
        if (p) {
          b.set(LET(AX[a0]!), p[0], true);
          b.set(LET(AX[a1]!), p[1], true);
          b.axAbs |= (1 << a0) | (1 << a1);
        }
        if (w !== null) {
          b.set(LET(AX[a2]!), w, true);
          b.axAbs |= 1 << a2;
        }
        if (c) {
          b.set(LET(CENTER[a0]!), c[0], true);
          b.set(LET(CENTER[a1]!), c[1], true);
          b.cAbs = (1 << a0) | (1 << a1);
        }
        if (g !== 0 && f > 0) b.set(LET('F'), f, true);
        this.exec(b, line);
        if (this.mb.count >= this.maxMoves) stop = true;
      },
      stopped: () => stop,
    };
  }

  // ── 홈·긴 구멍 사이클 ──
  /**
   * LONGHOLE(원 위 긴 구멍)·SLOT1(원 위 홈)·SLOT2(원주 홈)(40차): SINUMERIK 840D sl/840D/840Di sl/840Di/810D 사이클 프로그래밍 설명서
   * (6FC5398-3BP20-0BA0, 2006-11 — 3.2절 사이클 설정, 3.4 LONGHOLE, 3.5 SLOT1, 3.6 SLOT2, 2.1 CYCLE81의 DP·DPR. 2008-01 독일어판 6FC5398-3BP20-1AA0도 같음)의 매개변수 차례·뜻대로.
   * LONGHOLE(RTP, RFP, SDIS, DP, DPR, NUM, LENG, CPA, CPO, RAD, STA1, INDA, FFD, FFP1, MID)
   * SLOT1(RTP, RFP, SDIS, DP, DPR, NUM, LENG, WID, CPA, CPO, RAD, STA1, INDA, FFD, FFP1, MID, CDIR, FAL, VARI, MIDF, FFP2, SSF, _FALD, _STA2)
   * SLOT2(RTP, RFP, SDIS, DP, DPR, NUM, AFSL, WID, CPA, CPO, RAD, STA1, INDA, FFD, FFP1, MID, CDIR, FAL, VARI, MIDF, FFP2, SSF, _FFCP)
   * - 자리: 원 중심 (CPA, CPO)·반지름 RAD, k번째는 STA1 + k × INDA(INDA = 0이면 360 / NUM). LONGHOLE·SLOT1은 긴 축이 반지름 방향이고 안쪽 끝이 원에 닿아
   *   바깥으로 LENG(끝에서 끝)만큼(설명서 그림), 너비는 LONGHOLE = 공구 지름, SLOT1 = WID. SLOT2는 원 위를 따라 STA1에서 반시계로 AFSL(양 끝 반원 중심 사이 각),
   *   너비 WID. AFSL이 360 이상이면 고리 홈(설명서: NUM = 1, AFSL = 369)
   * - 깊이: DPR이 0이 아니면 DPR(둘 다 있으면 DPR, DP와 다르면 알림 — CYCLE81 설명, cycleDepth), 아니면 DP. _ZSD[1] = 0이면 기준면 + 안전 거리부터, 1이면 기준면부터 MID 이하의 같은 절입으로
   *   가장 적은 층(MID = 0이면 한 번)
   * - LONGHOLE(설명서 순서): 후퇴 면에서 가까운 끝 위로 → 기준면 + 안전 거리 → 끝마다 다음 깊이로 G1(FFD) 진입하며 FFP1로 왕복 → 후퇴 면 →
   *   다음 구멍의 가까운 끝(가장 짧은 길). 마지막 구멍 뒤 그 자리에서 후퇴 면으로(독일어판 — 영어판은 그림을 가리키는데 그림이 없다)
   * - SLOT1·SLOT2 황삭: 공구 지름이 너비의 반보다 작으면 가운데가 남는다(설명서 — 보지 않음)는 설명에 맞춰 층마다 홈 둘레 고리 하나
   *   (반너비 = 너비/2 − FAL − 공구 반지름, FAL이 너무 크면 줄임)로 깎는다(정한 것). 진입은 층마다 같은 자리(설명서)인데 어디인지 적지 않아 가까운 끝 반원의 중심으로
   *   정했다. 너비 − 2 × FAL = 공구 지름이면 설명서대로 LONGHOLE처럼 양 끝에서 번갈아 진입하며 왕복. SLOT1의 바닥 여유 _FALD만큼 위까지
   * - 정삭(VARI 일의 자리 0·2): 후퇴 없이 안전 높이로 올라가 MIDF 이하 층마다(0이면 바닥 한 번) 홈 윤곽 한 바퀴(FFP2, 없으면 FFP1). 공구 지름 = 너비면 바닥만(중심선 한 번)
   * - 진입(SLOT1 VARI 십의 자리): 0 수직 G0, 1 수직 G1(FFD), 3 = 홈 가운데 축 위 왕복(LENG − WID 길이, _STA2 이하 각, FFD — 진입 자리에서 끝나게 시작 끝을 고름).
   *   LONGHOLE·SLOT2는 G1(FFD)
   * - SLOT2: 홈 사이 옮김은 VARI 십의 자리 0 = 후퇴 면에서 G0 직선, 1 = 후퇴 면 높이에서 원을 따라(_FFCP). 일의 자리 3 = 가장자리만 정삭(MID 층마다 윤곽 한 바퀴,
   *   설명서의 부드러운 접근은 그리지 않고 곧게 들어감). 가공 방향 CDIR은 2(G2)·3(G3)
   * - 그리지 않는 것(경고): 깊이·개수·크기가 없거나 맞지 않음, 공구가 홈보다 큼(알람 61105), 홈끼리 겹침(알람 61104), VARI가 맞지 않음(알람 61102)
   * - 반영하지 않는 것(경고): SSF(정삭 회전수)
   * 이동은 cycleMover로 프레임·평면을 따르고, 홈·층·왕복 행정마다 이동 한도를 본다. 앞의 G 모드·이송은 사이클 뒤 그대로다(설명서 3.2절)
   */
  private slot(name: 'LONGHOLE' | 'SLOT1' | 'SLOT2', a: (number | undefined)[], line: number): void {
    const long = name === 'LONGHOLE';
    const s1 = name === 'SLOT1';
    const s2 = name === 'SLOT2';
    const at = (k: number): number => a[k] ?? 0;
    const rtp = at(0);
    const rfp = at(1);
    const sdis = Math.abs(at(2));
    // 깊이: 상대 깊이 DPR은 기준면에서 후퇴 면 반대쪽으로(둘 다 있으면 DPR — cycleDepth)
    const depth = this.cycleDepth(a, 3, rtp, rfp, 1);
    if (!depth) {
      this.w.add(`${name}: 깊이(DP·DPR)가 없음 — 그리지 않음`, line);
      return;
    }
    if (this.planeAlarm(name, rtp, rfp, depth, line)) return;
    const dp = depth.d;
    const num = Math.round(at(5));
    // LONGHOLE·SLOT1은 LENG(길이), SLOT2는 AFSL(각)
    const size = Math.abs(at(6));
    // CPA 자리(SLOT은 앞에 WID가 있다)
    const k0 = long ? 7 : 8;
    const wid = long ? 0 : Math.abs(at(7));
    const cpa = at(k0);
    const cpo = at(k0 + 1);
    const rad = Math.abs(at(k0 + 2));
    const sta1 = at(k0 + 3);
    const inda = at(k0 + 4) || (num > 0 ? 360 / num : 0);
    const ffd = at(k0 + 5);
    const ffp1 = at(k0 + 6);
    const mid = Math.abs(at(k0 + 7));
    const cdir = Math.round(at(16));
    const fal = long ? 0 : Math.abs(at(17));
    const vari = long ? 1 : Math.round(at(18));
    const midf = long ? 0 : Math.abs(at(19));
    const ffp2 = (long ? 0 : at(20)) || ffp1;
    const ssf = long ? 0 : at(21);
    const fald = s1 ? Math.abs(at(22)) : 0;
    const sta2 = s1 ? Math.abs(at(23)) : 0;
    const ffcp = s2 ? at(22) : 0;
    const units = vari % 10;
    const tens = Math.floor(vari / 10) % 10;
    if (!long && !(vari >= 0 && vari < 100 && (s1 ? units <= 2 && (tens === 0 || tens === 1 || tens === 3) : units <= 3 && tens <= 1))) {
      this.w.add(`${name}: 가공 종류(VARI = ${vari})가 맞지 않음 — 그리지 않음`, line);
      return;
    }
    if (!(num > 0)) {
      this.w.add(`${name}: 개수(NUM)가 없음 — 그리지 않음`, line);
      return;
    }
    const rd = this.toolRadiusFor(this.dNum >= 0 ? this.dNum : undefined);
    if (rd === undefined) this.w.add(`${name}: 공구 반지름을 몰라 반지름 0으로 그림`, line);
    // 프로그램 단위 공구 반지름(toolRadiusFor는 표시 단위)
    const r = (rd ?? 0) / this.scale;
    // 홈 반너비(LONGHOLE = 공구 반지름)와 반지름 방향 양 끝 반원 중심의 거리(LONGHOLE·SLOT1)
    const hw = long ? r : wid / 2;
    const e1 = rad + hw;
    const e2 = rad + size - hw;
    const ring = s2 && size >= 360;
    if (!(size > 0) || (!long && !(wid > 0)) || (s1 && size < wid - 1e-9) || (s2 && !(rad > hw + 1e-9))) {
      this.w.add(`${name}: 홈 크기(${long ? 'LENG' : s1 ? 'LENG·WID' : 'AFSL·WID·RAD'})가 맞지 않음 — 그리지 않음`, line);
      return;
    }
    if (long ? size < 2 * r - 1e-9 : 2 * r > wid + 1e-9) {
      this.w.add(`${name}: 공구가 홈보다 큼(알람 61105) — 그리지 않음`, line);
      return;
    }
    const angOf = (k: number): number => sta1 + k * inda;
    if (num > 1) {
      // 홈끼리 겹침(알람 61104): 시작 각을 0~360으로 접어 이웃끼리 본다(반지름 방향 홈은 안쪽 끝끼리 가장 가깝다)
      const st = Array.from({ length: num }, (_, k) => ((angOf(k) % 360) + 360) % 360).sort((x, y) => x - y);
      let clash = ring;
      for (let k = 0; k < num && !clash; k++) {
        const gap = (k + 1 < num ? st[k + 1]! : st[0]! + 360) - st[k]!;
        if (s2) {
          const free = gap - size;
          clash = free < -1e-9 || 2 * rad * Math.sin((free * DEG) / 2) < wid - 1e-9;
        } else clash = e1 * Math.sin((Math.min(gap, 360 - gap) * DEG) / 2) < hw - 1e-9;
      }
      if (clash) {
        this.w.add(`${name}: 홈끼리 겹침(알람 61104) — 그리지 않음`, line);
        return;
      }
    }
    this.depthDiffers(name, depth, line);
    // 가공 방향: SLOT1 = POCKET3와 같음(0 하향·1 상향 — 주축 방향으로 셈, 2 G2, 3 G3), SLOT2는 2·3만
    let dirc = cdir;
    if (!long && (s2 ? dirc !== 2 && dirc !== 3 : dirc < 0 || dirc > 3)) {
      this.w.add(`${name}: 가공 방향(CDIR = ${cdir})이 맞지 않아 하향으로 그림`, line);
      dirc = 0;
    }
    const ccw = dirc === 2 ? false : dirc === 3 ? true : dirc === 1 ? this.spindleDir === 4 : this.spindleDir !== 4;
    const finishing = units === 0 || units === 2;
    if (ssf && finishing) this.w.add(`${name}: 정삭 회전수(SSF)는 반영하지 않음`, line);
    const oscillate = s1 && tens === 3;
    if (oscillate && !(sta2 > 0)) this.w.add('SLOT1: 왕복 진입 각(_STA2)이 없어 수직 이송으로 그림', line);
    // 마무리 여유(너비와 공구로 허용되는 것보다 크면 그 최대로 — 설명서)와 황삭 고리·정삭 윤곽의 반너비
    const falE = Math.min(fal, Math.max(0, hw - r));
    const hr = hw - falE - r;
    const hf = hw - r;
    const up = rfp >= dp ? 1 : -1;
    const safe = rfp + up * sdis;
    const top = (this.zsd.get(1) ?? 0) === 1 ? rfp : safe;
    /** from에서 to까지 step 이하 같은 절입의 층 수(가장 적은 수, step = 0이면 한 번) */
    const levelCount = (from: number, to: number, step: number): number => {
      const total = up * (from - to);
      return total > 1e-9 && step > 0 ? Math.max(1, Math.ceil(total / step - 1e-9)) : 1;
    };
    const levelAt = (from: number, to: number, n: number, k: number): number => (k >= n - 1 ? to : from - ((from - to) * (k + 1)) / n);
    const C: P2 = [cpa, cpo];
    const onRay = (deg: number, rr: number): P2 => [cpa + rr * Math.cos(deg * DEG), cpo + rr * Math.sin(deg * DEG)];
    const dist = (p: P2, q: P2): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const [a0, a1] = PLANE_AXES[this.plane]!;

    const { go, move, stopped } = this.cycleMover(line);
    /** 홈 k 하나: 가까운 끝 E에서 들어가 층마다 깎고, 끝난 평면 자리를 돌려준다 */
    const cutSlot = (k: number, last: P2): P2 => {
      const al = angOf(k);
      // 축 위 양 끝(반원 중심): LONGHOLE·SLOT1은 반지름 방향 안쪽·바깥쪽, SLOT2는 원 위 시작·끝 각
      const A = s2 ? onRay(al, rad) : onRay(al, e1);
      const B = s2 ? (ring ? A : onRay(al + size, rad)) : onRay(al, e2);
      const eA = dist(last, A) <= dist(last, B);
      const E = eA ? A : B;
      const O = eA ? B : A;
      /** 중심선을 따라 지금 끝(atE)에서 다른 끝으로(SLOT2는 원호, 고리면 한 바퀴) */
      const traverse = (atE: boolean, f: number): void => {
        const to = atE ? O : E;
        if (!s2) return move(1, to, null, f);
        if (ring) {
          const half = onRay(al + 180, rad);
          move(ccw ? 3 : 2, half, null, f, C);
          return move(ccw ? 3 : 2, A, null, f, C);
        }
        // 시작 끝(A)에서 끝(B)으로는 반시계
        move((atE ? eA : !eA) ? 3 : 2, to, null, f, C);
      };
      /** 진입 끝(E)에서 반너비 hh의 홈 둘레 한 바퀴(가공 방향 ccw)를 돌고 E로 돌아온다 */
      const loop = (hh: number, f: number): void => {
        if (s2) return arcLoop(hh, f);
        const L = dist(E, O);
        const d: P2 = L > 1e-9 ? [(O[0] - E[0]) / L, (O[1] - E[1]) / L] : [Math.cos(al * DEG), Math.sin(al * DEG)];
        const n: P2 = [-d[1], d[0]];
        const pt = (p: P2, sd: number, sn: number): P2 => [p[0] + sd * d[0] + sn * n[0], p[1] + sd * d[1] + sn * n[1]];
        const S = pt(E, -hh, 0);
        move(1, S, null, f);
        if (L <= 1e-9) {
          move(ccw ? 3 : 2, pt(E, hh, 0), null, f, E);
          move(ccw ? 3 : 2, S, null, f, E);
        } else {
          const g = ccw ? 3 : 2;
          const sn = ccw ? -1 : 1;
          move(g, pt(E, 0, sn * hh), null, f, E);
          move(1, pt(O, 0, sn * hh), null, f);
          move(g, pt(O, 0, -sn * hh), null, f, O);
          move(1, pt(E, 0, -sn * hh), null, f);
          move(g, S, null, f, E);
        }
        move(1, E, null, f);
      };
      /** SLOT2: 원 위 홈 둘레(바깥 원호·끝 반원·안쪽 원호·끝 반원). 고리 홈이면 바깥 원과 안쪽 원 */
      const arcLoop = (hh: number, f: number): void => {
        if (ring) {
          const o = onRay(al, rad + hh);
          const i = onRay(al, rad - hh);
          move(1, o, null, f);
          move(ccw ? 3 : 2, onRay(al + 180, rad + hh), null, f, C);
          move(ccw ? 3 : 2, o, null, f, C);
          move(1, i, null, f);
          move(ccw ? 2 : 3, onRay(al + 180, rad - hh), null, f, C);
          move(ccw ? 2 : 3, i, null, f, C);
          move(1, E, null, f);
          return;
        }
        const a2 = al + size;
        // 끝 반원 꼭대기(홈 몸통에서 먼 쪽) — A는 각이 작아지는 쪽, B는 커지는 쪽
        const SA: P2 = [A[0] + hh * Math.sin(al * DEG), A[1] - hh * Math.cos(al * DEG)];
        const SB: P2 = [B[0] - hh * Math.sin(a2 * DEG), B[1] + hh * Math.cos(a2 * DEG)];
        const Ao = onRay(al, rad + hh);
        const Ai = onRay(al, rad - hh);
        const Bo = onRay(a2, rad + hh);
        const Bi = onRay(a2, rad - hh);
        // 반시계 한 바퀴(홈이 왼쪽): A 반원 꼭대기 → A 바깥 → (바깥 원호) → B 바깥 → (B 반원) → B 안쪽 → (안쪽 원호, 시계) → A 안쪽 → A 반원 꼭대기
        type Seg = { to: P2; c: P2; g: 2 | 3 };
        const fromA: Seg[] = [
          { to: Ao, c: A, g: 3 },
          { to: Bo, c: C, g: 3 },
          { to: SB, c: B, g: 3 },
          { to: Bi, c: B, g: 3 },
          { to: Ai, c: C, g: 2 },
          { to: SA, c: A, g: 3 },
        ];
        // 진입 끝에서 시작하도록 돌리고(B면 B 반원 꼭대기부터), 시계 방향이면 거꾸로 돈다
        const start = eA ? SA : SB;
        let segs = eA ? fromA : [...fromA.slice(3), ...fromA.slice(0, 3)];
        let pts: P2[] = [start, ...segs.map((s) => s.to)];
        if (!ccw) {
          segs = segs.slice().reverse().map((s) => ({ ...s, g: s.g === 3 ? 2 : 3 }) as Seg);
          pts = pts.slice().reverse();
        }
        move(1, start, null, f);
        segs.forEach((s, i) => move(s.g, pts[i + 1]!, null, f, s.c));
        move(1, E, null, f);
      };
      /** 지금 높이(cur)에서 깊이 d까지 진입(끝 end에서) — SLOT1 왕복 진입은 다른 끝 other와 사이를 오가며 */
      let cur = safe;
      const infeed = (d: number, end: P2, other: P2): void => {
        if (oscillate && sta2 > 0) {
          const L = dist(end, other);
          const drop = Math.abs(cur - d);
          if (L > 1e-9 && drop > 1e-12) {
            const strokes = Math.max(1, Math.ceil(drop / (L * Math.tan(Math.min(sta2, 89.9) * DEG)) - 1e-9));
            // 마지막 행정이 end에서 끝나게: 홀수면 다른 끝에서 시작
            if (strokes % 2 === 1) move(1, other, null, ffd);
            for (let i = 1; i <= strokes && go(); i++) move(1, (strokes - i) % 2 === 0 ? end : other, cur - ((cur - d) * i) / strokes, ffd);
            cur = d;
            return;
          }
        }
        move(s1 && tens === 0 ? 0 : 1, null, d, ffd);
        cur = d;
      };
      let atE = true;
      const narrow = hr <= 1e-9;
      if (units !== 2 && units !== 3) {
        // 황삭: 바닥 여유(_FALD)만큼 위까지 MID 층
        const to = dp + up * fald;
        const n = levelCount(top, to, mid);
        for (let i = 0; i < n && go(); i++) {
          const lev = levelAt(top, to, n, i);
          if (narrow) {
            // 공구 지름 = 홈 너비(LONGHOLE·SLOT): 양 끝에서 번갈아 진입하며 중심선 왕복
            infeed(lev, atE ? E : O, atE ? O : E);
            traverse(atE, ffp1);
            if (!ring) atE = !atE;
          } else {
            infeed(lev, E, O);
            loop(hr, ffp1);
          }
        }
      }
      if (finishing || units === 3) {
        // 정삭: 안전 높이로 올라가 진입 끝에서 층마다 윤곽 한 바퀴(가장자리만 정삭은 MID, 그 밖은 MIDF 층 — 0이면 바닥 한 번)
        if (units === 0) {
          move(0, null, safe, 0);
          cur = safe;
        }
        const here = atE ? E : O;
        if (hf <= 1e-9) {
          // 공구 지름 = 홈 너비: 바닥만(중심선 한 번)
          move(1, null, dp, ffd);
          cur = dp;
          traverse(atE, ffp2);
          if (!ring) atE = !atE;
        } else {
          // 왕복 황삭이 다른 끝에서 끝났으면 안전 높이에서 진입 끝으로
          if (here !== E) move(0, E, null, 0);
          atE = true;
          const step = units === 3 ? mid : midf;
          const n = levelCount(top, dp, step);
          for (let i = 0; i < n && go(); i++) {
            move(1, null, levelAt(top, dp, n, i), ffd);
            loop(hf, ffp2);
          }
        }
      }
      return atE ? E : O;
    };

    const save = { motion: this.motion, sMotion: this.sMotion, feed: this.feed };
    const first = this.mb.count;
    this.inCycle = true;
    try {
      let last: P2 = [this.progCoord(a0), this.progCoord(a1)];
      // 후퇴 면으로 올라가(공구 축) 홈마다: 후퇴 면에서 진입 끝 위로 → 기준면 + 안전 거리 → 깎기 → 후퇴 면
      move(0, null, rtp, 0);
      for (let k = 0; k < num && go(); k++) {
        const al = angOf(k);
        const A = s2 ? onRay(al, rad) : onRay(al, e1);
        const B = s2 ? (ring ? A : onRay(al + size, rad)) : onRay(al, e2);
        const E = dist(last, A) <= dist(last, B) ? A : B;
        // SLOT2 VARI 1x: 홈 사이는 후퇴 면 높이에서 원을 따라 _FFCP로(INDA 방향)
        if (k > 0 && s2 && tens === 1) move(inda >= 0 ? 3 : 2, E, null, ffcp, C);
        else move(0, E, null, 0);
        move(0, null, safe, 0);
        last = cutSlot(k, last);
        move(0, null, rtp, 0);
      }
    } finally {
      this.inCycle = false;
      this.motion = save.motion;
      this.sMotion = save.sMotion;
      this.feed = save.feed;
    }
    this.markIfFromBelow(first, rfp * this.scale, dp * this.scale, PLANE_AXES[this.plane]![2]!);
    if (stopped()) this.mb.overflow = true;
    this.known = 7;
  }

  // ── 평면 밀링 CYCLE71(44차) ──
  /**
   * CYCLE71(_RTP, _RFP, _SDIS, _DP, _PA, _PO, _LENG, _WID, _STA, _MID, _MIDA, _FDP, _FALD, _FFP1, _VARI, _FDP1) — 사각 면 밀링. 설명서(6FC5398-3BP20-0BA0, 2006-11)
   * 3.11절 156~162쪽. _RTP·_RFP·_SDIS는 CYCLE81 설명(알람 61101 — planeAlarm), _STA·_MID·_FFP1은 POCKET3 설명, _ZSD[1]은 밀링 사이클 설정을 따른다(162쪽).
   * - 면: (_PA, _PO)에서 첫 축과 _STA만큼 돈 긴 축으로 _LENG, 그와 수직으로 _WID(부호가 놓이는 쪽 — 157·161쪽)
   * - 순서(159쪽): 지금 높이에서 G0으로 진입 자리 → 기준면 + 안전 거리 → 가공 높이까지 G0(진입은 면 밖에서 — 156쪽). 거친 깎기(_VARI 일의 자리 1)는 _DP + _FALD까지
   *   _MID 이하의 같은 절입으로 위에서부터 층마다(_ZSD[1] = 0이면 기준면 + 안전 거리부터, 1이면 기준면부터 — 포켓과 같음), 다듬질(2)은 _DP에서 한 번.
   *   끝나면 지금 자리에서 후퇴 면으로(160쪽)
   * - 길(_VARI 십의 자리): 1·3 = 긴 축과 나란히, 2·4 = 수직 축과 나란히 깎고, 1·2는 한 방향(길 끝에서 들어 올려 급속으로 다음 길 시작 — 거친 깎기는 그 층 + 안전 거리,
   *   다듬질은 _DP + _FALD + 안전 거리까지 — 160쪽), 3·4는 오가며(길 끝에서 면 밖으로 다음 길로 옮김)
   * - 폭 절입(159·161쪽): 첫 길은 가장자리에서 꼭 _MIDA만큼 물리도록(공구 중심 = _MIDA − 공구 반지름), 마지막 길의 공구 중심은 너비 + _FDP1 − 공구 반지름,
   *   그 사이는 _MIDA 이하의 같은 간격. _MIDA가 0이면 공구 지름의 80 %
   * 여기서 정한 것: 길의 양 끝은 면 가장자리에서 공구 반지름 + _FDP만큼 밖(진입이 면 밖에서 되게 — 설명서 그림은 _FDP만 보임), 오가는 길 사이 옮김은 FFP1 이송,
   * 층 사이는 그 층 + 안전 거리로 올라 첫 길 시작에서 다시 들어감(설명서: "깊이 진입은 거친 깎기와 같은 자리").
   * 그리지 않는 것(경고): 깊이 없음, _LENG·_WID 없음, _VARI가 맞지 않음(알람 61002), 공구 반지름·_MIDA를 몰라 폭 절입을 정할 수 없음
   */
  private cycle71(a: (number | undefined)[], line: number): void {
    const at = (k: number): number => a[k] ?? 0;
    const rtp = at(0);
    const rfp = at(1);
    const sdis = Math.abs(at(2));
    if (a[3] === undefined) {
      this.w.add('CYCLE71: 깊이(_DP)가 없음 — 그리지 않음', line);
      return;
    }
    const dp = at(3);
    if (this.planeAlarm('CYCLE71', rtp, rfp, { d: dp, rel: false }, line)) return;
    const leng = at(6);
    const wid = at(7);
    const mid = Math.abs(at(9));
    const fdp = Math.abs(at(11));
    const fald = Math.abs(at(12));
    const ffp1 = at(13);
    const vari = Math.round(at(14));
    const fdp1 = Math.abs(at(15));
    const units = vari % 10;
    const tens = Math.floor(vari / 10);
    if (!(vari > 0 && (units === 1 || units === 2) && tens >= 1 && tens <= 4)) {
      this.w.add(`CYCLE71: 가공 종류(_VARI = ${vari})가 맞지 않음(알람 61002) — 그리지 않음`, line);
      return;
    }
    if (!(Math.abs(leng) > 0 && Math.abs(wid) > 0)) {
      this.w.add('CYCLE71: 면 크기(_LENG·_WID)가 없음 — 그리지 않음', line);
      return;
    }
    const rd = this.toolRadiusFor(this.dNum >= 0 ? this.dNum : undefined);
    const r = (rd ?? 0) / this.scale;
    const mida = Math.abs(at(10)) > 0 ? Math.abs(at(10)) : 1.6 * r;
    if (!(mida > 0)) {
      this.w.add('CYCLE71: 공구 반지름을 몰라 폭 절입(_MIDA)을 정할 수 없음 — 그리지 않음', line);
      return;
    }
    if (rd === undefined) this.w.add('CYCLE71: 공구 반지름을 몰라 반지름 0으로 그림', line);
    if (!(fdp > 0)) this.w.add('CYCLE71: 물러남(_FDP)이 0 — 설명서는 0보다 커야 한다고 함(0으로 그림)', line);
    // 지역 좌표: u = 긴 축(_STA), v = 수직 축. 깎는 축 c와 폭을 옮기는 축 t(십의 자리 1·3 = u를 따라 깎음)
    const ang = at(8) * DEG;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const pa = at(4);
    const po = at(5);
    const alongU = tens === 1 || tens === 3;
    const alt = tens === 3 || tens === 4;
    const sgU = Math.sign(leng) || 1;
    const sgV = Math.sign(wid) || 1;
    const P = (c: number, t: number): P2 => {
      const lu = alongU ? c * sgU : t * sgU;
      const lv = alongU ? t * sgV : c * sgV;
      return [pa + lu * ca - lv * sa, po + lu * sa + lv * ca];
    };
    const cLen = alongU ? Math.abs(leng) : Math.abs(wid);
    const tLen = alongU ? Math.abs(wid) : Math.abs(leng);
    const c0 = -(r + fdp);
    const c1 = cLen + r + fdp;
    const t0 = mida - r;
    const t1 = tLen + fdp1 - r;
    const nT = t1 > t0 + 1e-9 ? Math.max(1, Math.ceil((t1 - t0) / mida - 1e-9)) : 0;
    const tAt = (k: number): number => (nT === 0 ? t0 : k >= nT ? t1 : t0 + ((t1 - t0) * k) / nT);
    const up = rfp >= dp ? 1 : -1;
    const safe = rfp + up * sdis;
    const top = (this.zsd.get(1) ?? 0) === 1 ? rfp : safe;
    const to = units === 1 ? dp + up * fald : dp;
    const total = up * (top - to);
    // 거친 깎기의 끝(_DP + _FALD)이 시작 높이보다 위면 깎을 것이 없다(층 없이 후퇴 면으로)
    const nL = units === 2 ? 1 : total < -1e-9 ? 0 : total > 1e-9 && mid > 0 ? Math.max(1, Math.ceil(total / mid - 1e-9)) : 1;
    const levelAt = (k: number): number => (units === 2 || k >= nL - 1 ? to : top - ((top - to) * (k + 1)) / nL);
    const { go, move, stopped } = this.cycleMover(line);
    const save = { motion: this.motion, sMotion: this.sMotion, feed: this.feed };
    const first = this.mb.count;
    this.inCycle = true;
    try {
      // 지금 높이에서 진입 자리 위 → 기준면 + 안전 거리
      move(0, P(c0, tAt(0)), null, 0);
      move(0, null, safe, 0);
      for (let k = 0; k < nL && go(); k++) {
        const L = levelAt(k);
        const lift = units === 2 ? dp + up * (fald + sdis) : L + up * sdis;
        for (let i = 0; i <= nT && go(); i++) {
          const back = alt && i % 2 === 1;
          const s0 = back ? c1 : c0;
          const s1 = back ? c0 : c1;
          const t = tAt(i);
          if (i === 0) {
            move(0, P(s0, t), null, 0);
            move(0, null, L, 0);
          } else if (alt) move(1, P(s0, t), null, ffp1);
          else {
            move(0, null, lift, 0);
            move(0, P(s0, t), null, 0);
            move(0, null, L, 0);
          }
          move(1, P(s1, t), null, ffp1);
        }
        // 다음 층은 그 층 + 안전 거리로 올라 첫 길 시작에서
        if (k + 1 < nL) {
          move(0, null, lift, 0);
          move(0, P(c0, tAt(0)), null, 0);
        }
      }
      move(0, null, rtp, 0);
    } finally {
      this.inCycle = false;
      this.motion = save.motion;
      this.sMotion = save.sMotion;
      this.feed = save.feed;
    }
    this.markIfFromBelow(first, rfp * this.scale, dp * this.scale, PLANE_AXES[this.plane]![2]!);
    if (stopped()) this.mb.overflow = true;
    this.known = 7;
  }

  // ── 선반 윤곽 거친 깎기 CYCLE95(44차) ──
  /**
   * CYCLE95(NPP, MID, FALZ, FALX, FAL, FF1, FF2, FF3, VARI, DT, DAM, _VRT) — 설명서(6FC5398-3BP20-0BA0, 2006-11) 4.5절 309~322쪽, 사이클 설정 _ZSD[0]은 4.2절 293쪽.
   * 지금 평면(G18이면 긴 축 Z·가로 축 X — 292쪽)에서 윤곽 부프로그램 NPP를 읽어 축과 나란히 거친 깎기(cycle95Rough — lathe-g7x.ts)·다듬질을 그린다.
   * - NPP(314~315쪽): 프로그램 이름(%_N_이름_SPF·PROC·함께 연 파일 — 부프로그램 규칙), "표지1:표지2"(부른 프로그램 안 구간 — 표지나 N 번호),
   *   "이름:표지1:표지2"(그 프로그램 안 구간). 경로·_N_·_SPF는 떼고 찾는다. 못 찾으면 경고(함께 열 파일 띠)
   * - 윤곽(320쪽): G0~G3 직선·원호와 RND·CHF·CHR, 한 좌표와 ANG(윤곽 정의 — 한 블록 꼴만). 평면에서 움직이는 블록이 3개보다 적으면 알람 10933,
   *   첫 이동 블록에 G0~G3이 없거나 반경 보정 중이면 알람 15800(그리지 않음). 윤곽 시작 = 첫 블록의 자리(두 좌표를 다 적어야 함 — 321쪽)
   * - VARI(317~319쪽): 1~12·201~212(그 밖은 알람 61002). 1~4 거친 깎기, 5~8 다듬질, 9~12 온 가공 × 길이·가로 × 바깥·안. 바깥은 음의 쪽으로, 안은 양의 쪽으로
   *   절입. 길이 가공은 가로 축으로, 가로 가공은 긴 축으로 절입(319쪽). 백의 자리(0 = 겹쳐 둥글리기, 2 = 앞 교점까지 둥글리기)는 같은 길로 그린다
   * - 깎는 방향(321쪽): 거친 깎기·온 가공은 첫 점과 끝 점 가운데 더 깊은 쪽에서 시작(윤곽을 뒤집어도 같은 길), 다듬질만은 프로그램 차례.
   *   최대 지름(가장 얕은 점)이 시작·끝에 없으면 끝에서 축과 나란한 직선을 그 깊이까지 더해 언더컷으로 깎는다(320쪽 — 거친 깎기만)
   * - 다듬질 여유(316쪽): FALZ·FALX(축별)와 FAL(윤곽 따라)을 모두 더한다 — 축별 여유는 윤곽을 시작 쪽·바깥으로 옮김(정한 것), FAL은 떨어진 곡선.
   *   MID는 _ZSD[0] = 0이면 절입 축의 프로그램 단위(지름 지정이면 지름 — 316쪽 보기가 지름 차로 셈), 1이면 반지름, 2이면 지름. FALX·FAL은 반지름 값으로 본다(정한 것)
   * - _VRT(319쪽): 물러남, 0이면 1 mm. 시작 자리(322쪽) = 절입 축은 가장 얕은 윤곽 + 여유 + _VRT, 다른 축은 윤곽 시작 + 여유 + _VRT 앞 — 두 축 함께 G0
   * - 다듬질(314쪽): 시작 자리로 G0, 윤곽 시작보다 여유 + 공구 끝 반지름 + 1 mm 앞으로 G0, G1(FF3)로 윤곽 시작, 윤곽을 FF3, 시작 자리로 G0
   * 그리지 않는 것(경고): 걸친 윤곽(321쪽 — 설명서도 깎을 수 없다고 함, 거친 깎기만 뺌), MID 없음(거친 깎기만 뺌), DT·DAM 칩 끊기, 공구 끝 반지름 보정
   */
  private cycle95(a: (number | undefined)[], npp: string | undefined, line: number): void {
    if (!npp || !npp.trim()) {
      this.w.add('CYCLE95: 윤곽 이름(NPP)이 없음 — 그리지 않음', line);
      return;
    }
    const vari = Math.round(a[8] ?? 0);
    const lo = vari % 100;
    const hi = Math.floor(vari / 100);
    if (!((hi === 0 || hi === 2) && lo >= 1 && lo <= 12)) {
      this.w.add(`CYCLE95: 가공 종류(VARI = ${vari})가 맞지 않음(알람 61002) — 그리지 않음`, line);
      return;
    }
    if (this.comp) {
      this.w.add('CYCLE95: 반경 보정(G41·G42)이 켜져 있음(알람 15800) — 그리지 않음', line);
      return;
    }
    const range = this.contourRange(npp, line);
    if (!range) return;
    const prof = this.readContour(range[0], range[1], line);
    if (!prof) return;
    if (prof.blocks < 3) {
      this.w.add('CYCLE95: 윤곽 이동 블록이 3개보다 적음(알람 10933) — 그리지 않음', line);
      return;
    }
    const cut = g7xCorners(prof.els, prof.corners);
    if (cut.failed) this.w.add('CYCLE95: 모서리 둥글리기·모따기(RND·CHF·CHR)를 넣을 수 없음 — 모서리 그대로 그림', line);
    const raw = cut.els;
    if (!raw.length) {
      this.w.add('CYCLE95: 윤곽 점이 모자람 — 그리지 않음', line);
      return;
    }
    const s = this.scale;
    const [a0, a1] = PLANE_AXES[this.plane]!;
    // 가공 꼴: mode 0 거친 깎기·1 다듬질·2 온 가공, kind 0 길이 바깥·1 가로 바깥·2 길이 안·3 가로 안
    const mode = Math.floor((lo - 1) / 4);
    const kind = (lo - 1) % 4;
    const facing = kind === 1 || kind === 3;
    const sI = kind >= 2 ? 1 : -1;
    // (u, v) = 평면 두 축(표시 단위, 프로그램 좌표 — X는 반지름). 깎는 축 ci, 절입 축은 다른 하나
    const ci = facing ? 1 : 0;
    const cutAx = ci === 0 ? a0 : a1;
    const infAx = ci === 0 ? a1 : a0;
    const zsd0 = Math.round(this.zsd.get(0) ?? 0);
    const mid = Math.abs(a[1] ?? 0) * (zsd0 === 1 ? s : zsd0 === 2 && infAx === 0 ? s / 2 : this.axScale[infAx]!);
    const falz = Math.abs(a[2] ?? 0) * s;
    const falx = Math.abs(a[3] ?? 0) * s;
    const fal = Math.abs(a[4] ?? 0) * s;
    const ff1 = a[5] ?? 0;
    const ff2 = a[6] ?? 0;
    const ff3 = a[7] ?? 0;
    const vrt = (a[11] ?? 0) !== 0 ? Math.abs(a[11]!) * s : this.displayInch ? 1 / 25.4 : 1;
    // 축별 여유: 깎는 축은 시작 쪽, 절입 축은 바깥(G18 길이 가공 = FALZ·FALX, 가로 가공 = FALX·FALZ)
    const allowCut = facing ? falx : falz;
    const allowInf = facing ? falz : falx;
    let ext = 1;
    for (const e of raw) ext = Math.max(ext, Math.abs(e.su), Math.abs(e.sv), Math.abs(e.eu), Math.abs(e.ev));
    const tol = 1e-7 * ext;
    const iOf = (u: number, v: number): number => (ci === 0 ? v : u);
    const cOf = (u: number, v: number): number => (ci === 0 ? u : v);
    const lastRaw = raw[raw.length - 1]!;
    const reverse = mode !== 1 && sI * iOf(lastRaw.eu, lastRaw.ev) > sI * iOf(raw[0]!.su, raw[0]!.sv) + tol;
    const els = reverse ? raw.map((e) => ({ ...e, su: e.eu, sv: e.ev, eu: e.su, ev: e.sv, sweep: -e.sweep })).reverse() : raw;
    const cdir = Math.sign(cOf(els[els.length - 1]!.eu, els[els.length - 1]!.ev) - cOf(els[0]!.su, els[0]!.sv));
    if (!cdir || Math.abs(cOf(els[els.length - 1]!.eu, els[els.length - 1]!.ev) - cOf(els[0]!.su, els[0]!.sv)) <= tol) {
      this.w.add(`CYCLE95: 윤곽이 깎는 축(${AX[cutAx]})으로 움직이지 않음 — 그리지 않음`, line);
      return;
    }
    // 방향 잡은 좌표(p = 깎아 나가는 쪽, q = 절입 깊이)와 되돌림
    const det = ci === 0 ? cdir * sI : -cdir * sI;
    const toPQ = (u: number, v: number): [number, number] => (ci === 0 ? [cdir * u, sI * v] : [cdir * v, sI * u]);
    const fromPQ = (p: number, q: number): [number, number] => (ci === 0 ? [cdir * p, sI * q] : [sI * q, cdir * p]);
    const elsO: G7xEl[] = els.map((e) => {
      const [su, sv] = toPQ(e.su, e.sv);
      const [eu, ev] = toPQ(e.eu, e.ev);
      const [cu, cv] = e.arc ? toPQ(e.cu, e.cv) : [0, 0];
      return { arc: e.arc, su, sv, eu, ev, cu, cv, sweep: e.arc ? e.sweep * det : 0 };
    });
    const polyRaw = g7xPolyline(elsO, Math.PI / 90).pts;
    let roughOk = mode !== 1;
    if (roughOk && !(mid > 0)) {
      this.w.add('CYCLE95: 절입 깊이(MID)가 없어 거친 깎기를 그리지 않음', line);
      roughOk = false;
    }
    if (roughOk && polyMonotonic(polyRaw, 0, tol) !== 1) {
      this.w.add(`CYCLE95: 윤곽이 깎는 축(${AX[cutAx]})으로 되돌아감(걸친 윤곽 — 설명서: CYCLE95로 깎을 수 없음) — 거친 깎기를 그리지 않음`, line);
      roughOk = false;
    }
    // 가장 얕은 점이 시작·끝이 아니면 끝에서 축과 나란한 직선을 더한다(320쪽)
    let qMin = Infinity;
    for (let i = 1; i < polyRaw.length; i += 2) qMin = Math.min(qMin, polyRaw[i]!);
    const pEnd = polyRaw[polyRaw.length - 2]!;
    const qEnd = polyRaw[polyRaw.length - 1]!;
    const roughEls = elsO.slice();
    if (polyRaw[1]! > qMin + tol && qEnd > qMin + tol) roughEls.push(g7xLine(pEnd, qEnd, pEnd, qMin));
    // 다듬질 여유: FAL은 바깥으로 떨어진 곡선, 축별 여유는 옮김
    let off = roughEls;
    if (fal > 0) off = g7xOffset(roughEls, fal, g7xSide(roughEls, [(polyRaw[0]! + pEnd) / 2, qMin - 10 * ext], 0).k);
    off = off.map((e) => ({ ...e, su: e.su - allowCut, eu: e.eu - allowCut, cu: e.cu - allowCut, sv: e.sv - allowInf, ev: e.ev - allowInf, cv: e.cv - allowInf }));
    const poly = g7xPolyline(off, Math.PI / 90).pts;
    let top = Infinity;
    for (let i = 1; i < poly.length; i += 2) top = Math.min(top, poly[i]!);
    const p0 = poly[0]! - vrt;
    const S: [number, number] = [p0, top - vrt];

    const { go, move, stopped } = this.cycleMover(line);
    const putUV = (g: 0 | 1 | 2 | 3, u: number, v: number, f: number, c?: [number, number]): void =>
      move(g, [u / this.axScale[a0]!, v / this.axScale[a1]!], null, f, c ? [c[0] / s, c[1] / s] : undefined);
    const put = (g: 0 | 1, p: number, q: number, f = 0): void => {
      const [u, v] = fromPQ(p, q);
      putUV(g, u, v, f);
    };
    const save = { motion: this.motion, sMotion: this.sMotion, feed: this.feed };
    this.inCycle = true;
    try {
      // 계산한 시작 자리로 두 축 함께 G0(313쪽)
      put(0, S[0], S[1]);
      if (roughOk) {
        const plan = cycle95Rough(poly, top, p0, mid, vrt, (k, p, q) => {
          if (!go()) return false;
          put(k === 0 ? 0 : 1, p, q, k === 2 ? ff2 : ff1);
          return !stopped();
        });
        if (plan.levelCap) this.guardStop(`CYCLE95: 층이 ${G7X_MAX_LEVELS}개를 넘어 그 뒤 층은 건너뜀`, line);
        if (plan.levels) this.w.add('CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림', line);
        if (plan.sections > 1 && allowCut > 0)
          this.w.add(`CYCLE95: 언더컷이 있는데 축 방향 여유 ${facing ? 'FALX' : 'FALZ'}가 0이 아님 — 윤곽을 시작 쪽으로 옮겨 그려 언더컷의 내려가는 벽은 여유만큼 파고들 수 있음`, line);
      }
      if (mode !== 0 && !stopped()) {
        // 다듬질(314쪽): 시작 자리 → 윤곽 시작보다 여유 + 공구 끝 반지름 + 1 mm 앞 → G1(FF3) 윤곽 시작 → 윤곽 → 시작 자리
        const rn = this.toolRadiusFor(this.dNum >= 0 ? this.dNum : undefined) ?? 0;
        const [ps, qs] = toPQ(els[0]!.su, els[0]!.sv);
        put(0, S[0], S[1]);
        put(0, ps - (allowCut + rn + (this.displayInch ? 1 / 25.4 : 1)), qs);
        put(1, ps, qs, ff3);
        for (const e of els) {
          if (!go()) break;
          if (e.arc) putUV(e.sweep > 0 ? 3 : 2, e.eu, e.ev, ff3, [e.cu, e.cv]);
          else putUV(1, e.eu, e.ev, ff3);
        }
        put(0, S[0], S[1]);
      }
    } finally {
      this.inCycle = false;
      this.motion = save.motion;
      this.sMotion = save.sMotion;
      this.feed = save.feed;
    }
    if (mode !== 1 && Math.abs(a[10] ?? 0) > 0) this.w.add('CYCLE95: 칩 끊기(DT·DAM)는 그리지 않음', line);
    if (stopped()) this.mb.overflow = true;
    this.known = 7;
  }

  /**
   * CYCLE95 윤곽 NPP의 줄 범위(설명서 315쪽): "이름"(그 프로그램 몸통 — 다음 머리 줄 앞까지), "표지1:표지2"(부른 프로그램 안 — 표지1 줄부터 표지2 줄까지),
   * "이름:표지1:표지2"(그 프로그램 안). 표지는 이름표(LABEL:)나 N 번호. 경로·_N_·_SPF는 뗀다. 못 찾으면 경고하고 null
   */
  private contourRange(npp: string, line: number): [number, number] | null {
    const parts = npp.split(':').map((p) => p.trim().toUpperCase());
    const prog = (p: string): string => p.replace(/^.*\//, '').replace(/^_N_/, '').replace(/(?:_SPF|_MPF|\.SPF|\.MPF)$/, '');
    let lo = 0;
    let hi = this.src.lineCount - 1;
    if (parts.length === 1 || parts.length === 3) {
      const name = prog(parts[0]!);
      const sec = this.sections.get(name);
      if (!sec) {
        this.missingProgram(name, `CYCLE95: 윤곽 ${name}을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
        return null;
      }
      lo = sec.line + 1;
      for (const h of this.sectionLines.keys()) if (h >= lo && h - 1 < hi) hi = h - 1;
      if (parts.length === 1) return [lo, hi];
    } else if (parts.length !== 2) {
      this.w.add(`CYCLE95: 윤곽 구간 ${npp}을(를) 찾지 못함 — 그리지 않음`, line);
      return null;
    }
    const find = (name: string, from: number, to: number): number => {
      const nm = /^N(\d+)$/.exec(name);
      const list = (nm ? this.nLines.get(+nm[1]!) : this.labels.get(name)) ?? [];
      return list.find((l) => l >= from && l <= to) ?? -1;
    };
    const k = parts.length - 2;
    const s = k === 0 ? this.findTarget(parts[0]!, line, 'FB') : find(parts[1]!, lo, hi);
    const e = s < 0 ? -1 : find(parts[k + 1]!, s, hi);
    if (s < 0 || e < 0) {
      this.w.add(`CYCLE95: 윤곽 구간 ${npp}을(를) 찾지 못함 — 그리지 않음`, line);
      return null;
    }
    return [s, e];
  }

  /**
   * CYCLE95 윤곽 블록(줄 s~e)을 상태를 건드리지 않고 평면 두 축(a0, a1)의 요소로(표시 단위, 프로그램 좌표 — 지름 지정 X는 반지름). 첫 이동 블록의 자리가 윤곽 시작.
   * G0~G3(G0은 직선), G90·G91, 축별 AC·IC, 원호 CR·I·J·K(I=AC 절대 중심), RND·CHF·CHR, 한 좌표 + ANG를 읽고, M17·M2·M30·RET에서 끝난다.
   * 읽지 않는 꼴(흐름·호출·프레임·CIP·CT·AR·극좌표·두 블록 윤곽 정의)과 읽을 수 없는 식은 경고하고 null(그리지 않음)
   */
  private readContour(s: number, e: number, line: number): { els: G7xEl[]; corners: G7xCorner[]; blocks: number } | null {
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const cur = this.progPos();
    let u = cur[a0]!;
    let v = cur[a1]!;
    let abs = this.absolute;
    let mot = -1;
    let blocks = 0;
    let first = true;
    const els: G7xEl[] = [];
    const corners: G7xCorner[] = [];
    const bad = (what: string): null => {
      this.w.add(`CYCLE95: 윤곽의 ${what}은(는) 읽지 않음 — 그리지 않음`, line);
      return null;
    };
    const L0 = AX[a0]!;
    const L1 = AX[a1]!;
    for (let i = s; i <= e; i++) {
      if (i > s && this.sectionLines.has(i)) break;
      let t = splitLine(sourceLine(this.src, i)).code.trim();
      if (!t || t.startsWith('%')) continue;
      if (t.startsWith('/')) {
        if (this.o.blockDelete) continue;
        t = t.replace(/^\/\d?\s*/, '');
      }
      t = t.replace(/^N\d+\s*/, '').replace(/^[A-Z_][A-Z0-9_]*\s*:(?!=)\s*/, '');
      if (!t) continue;
      const kw = /^[A-Z_]+/.exec(t)?.[0] ?? '';
      if (kw === 'RET') break;
      if (kw === 'PROC' || kw === 'DEF') continue;
      if (CONTOUR_SKIP.has(kw)) return bad(kw);
      const sc = new Scan(t);
      const words = new Map<string, { v: number; mode?: 'AC' | 'IC' }>();
      let gMot = -1;
      let end = false;
      try {
        while (!sc.end()) {
          const c = sc.peek();
          if (c === '"') {
            sc.str();
            continue;
          }
          if (!/[A-Z_$]/.test(c)) throw new ExprError(`알 수 없는 글자 '${c}'`);
          if (/[A-Z]/.test(c) && /[0-9.+\-]/.test(sc.s[sc.i + 1] ?? '') && !/^[A-Z]\d+\s*=(?!=)/.test(sc.s.slice(sc.i))) {
            sc.i++;
            const val = sc.number();
            if (val === undefined) throw new ExprError(`${c} 뒤에 수 없음`);
            if (c === 'G') {
              const gi = Math.round(val * 10);
              if (gi === 0 || gi === 10 || gi === 20 || gi === 30) gMot = gi;
              else if (gi === 900 || gi === 910) abs = gi === 900;
              else if (gi === 410 || gi === 420 || (gi >= 1100 && gi <= 1120) || ((gi === 170 || gi === 180 || gi === 190) && (gi - 170) / 10 !== this.plane)) return bad(`G${val}`);
            } else if (c === 'M') {
              if (val === 17 || val === 2 || val === 30) end = true;
            } else words.set(c, { v: val });
            continue;
          }
          const id = sc.ident();
          sc.ws();
          if (sc.s[sc.i] === '=' && sc.s[sc.i + 1] !== '=') {
            sc.i++;
            sc.ws();
            const m = /^(AC|IC)\s*\(/.exec(sc.s.slice(sc.i));
            if (m) {
              sc.i += m[0].length;
              const val = this.expr(sc);
              if (!sc.eat(')')) throw new ExprError(') 없음');
              words.set(id, { v: val, mode: m[1] as 'AC' | 'IC' });
            } else words.set(id, { v: this.expr(sc) });
            continue;
          }
          if (id === 'CIP' || id === 'CT' || /^A?(?:TRANS|ROT|SCALE|MIRROR)$/.test(id)) return bad(id);
          // 그 밖의 낱말(DIAMON·SOFT 등)은 윤곽 모양과 상관없어 건너뛴다
        }
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        this.w.add(`CYCLE95: 윤곽 블록을 읽을 수 없음 — ${err.message}`, line);
        return null;
      }
      for (const k of ['AR', 'AP', 'RP', 'TURN', 'I1', 'J1', 'K1', 'ANG1', 'ANG2']) if (words.has(k)) return bad(k);
      if (gMot >= 0) mot = gMot;
      const w0 = words.get(L0);
      const w1 = words.get(L1);
      const ang = words.get('ANG');
      if (w0 || w1 || ang) {
        blocks++;
        if (first && gMot < 0) {
          this.w.add('CYCLE95: 윤곽 첫 이동 블록에 G0~G3이 없음(알람 15800) — 그리지 않음', line);
          return null;
        }
        const val = (w: { v: number; mode?: 'AC' | 'IC' }, ax: number, c0: number): number => {
          const inc = w.mode === 'IC' || (w.mode !== 'AC' && !abs);
          return inc ? c0 + w.v * this.axScale[ax]! : w.v * this.axScale[ax]!;
        };
        let nu = w0 ? val(w0, a0, u) : u;
        let nv = w1 ? val(w1, a1, v) : v;
        if (ang) {
          // 윤곽 정의(한 블록): 한 좌표와 첫 축에서 잰 각(Programming Guide) — 두 좌표·좌표 없음은 두 블록 꼴이라 읽지 않음
          if (first || !w0 === !w1) return bad('ANG');
          const cs = Math.cos(ang.v * DEG);
          const sn = Math.sin(ang.v * DEG);
          if (w0) {
            if (Math.abs(cs) < 1e-9) return bad('ANG');
            nv = v + ((nu - u) * sn) / cs;
          } else {
            if (Math.abs(sn) < 1e-9) return bad('ANG');
            nu = u + ((nv - v) * cs) / sn;
          }
        }
        if (first) {
          if (!(w0 && w1)) this.w.add('CYCLE95: 윤곽 첫 블록에 두 축 좌표가 다 있어야 함 — 없는 축은 지금 자리로 봄', line);
          first = false;
        } else if (Math.hypot(nu - u, nv - v) > 1e-9) {
          if (mot === 20 || mot === 30) {
            const ccw = mot === 30;
            const cr = words.get('CR');
            let cu: number;
            let cv: number;
            if (cr) {
              const R = cr.v * this.scale;
              const du = nu - u;
              const dv = nv - v;
              const d = Math.hypot(du, dv);
              const rr = Math.max(Math.abs(R), d / 2);
              const h = Math.sqrt(Math.max(0, rr * rr - (d * d) / 4));
              const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
              cu = u + du / 2 - (side * h * dv) / d;
              cv = v + dv / 2 + (side * h * du) / d;
            } else {
              const k0 = words.get(CENTER[a0]!);
              const k1 = words.get(CENTER[a1]!);
              if (!k0 && !k1) {
                this.w.add('CYCLE95: 윤곽 원호에 중심(I·J·K)·반지름(CR)이 없음 — 그리지 않음', line);
                return null;
              }
              cu = k0 ? (k0.mode === 'AC' ? k0.v * this.scale : u + k0.v * this.scale) : u;
              cv = k1 ? (k1.mode === 'AC' ? k1.v * this.scale : v + k1.v * this.scale) : v;
            }
            let sw = Math.atan2(nv - cv, nu - cu) - Math.atan2(v - cv, u - cu);
            if (ccw) while (sw <= 0) sw += Math.PI * 2;
            else while (sw >= 0) sw -= Math.PI * 2;
            els.push({ arc: true, su: u, sv: v, eu: nu, ev: nv, cu, cv, sweep: sw });
          } else els.push(g7xLine(u, v, nu, nv));
          const rnd = words.get('RND');
          const cn = rnd ?? words.get('CHF') ?? words.get('CHR');
          if (cn && cn.v > 0) corners.push({ at: els.length - 1, kind: rnd ? 'round' : words.has('CHF') ? 'chamferHyp' : 'chamferLeg', size: cn.v * this.scale });
        }
        u = nu;
        v = nv;
      }
      if (end) break;
    }
    return { els, corners, blocks };
  }

  /** 작업 좌표계 이름(G505~G599) */
  protected override wcsLabel(idx: number): string {
    return idx >= 6 ? `G${505 + idx - 6}` : super.wcsLabel(idx);
  }
}

/** 평면 축 a0·a1에서 세 점을 지나는 원: 중심과 방향(시작 → 중간 → 끝이 반시계면 ccw) */
function circle3(s: number[], m: number[], e: number[], a0: number, a1: number): { cu: number; cv: number; ccw: boolean } | null {
  const ax = s[a0]!;
  const ay = s[a1]!;
  const bx = m[a0]!;
  const by = m[a1]!;
  const cx = e[a0]!;
  const cy = e[a1]!;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const scale = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay), 1e-9);
  if (Math.abs(d) < 1e-12 * scale * scale) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const cu = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const cv = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return { cu, cv, ccw: cross > 0 };
}

function isIdentity(m: Affine): boolean {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  for (let k = 0; k < 12; k++) if (Math.abs(m[k]! - id[k]!) > 1e-12) return false;
  return true;
}

/** Siemens Sinumerik 프로그램을 해석한다 */
export function parseSiemens(src: NcSource, opts: GcodeOptions = {}, head: () => string = () => ''): NcProgram {
  const r = new SiemensRunner(src, opts, head);
  r.run();
  return r.finish(opts);
}

registerDialectParser('siemens', parseSiemens);
