/**
 * 깎기 시뮬레이션의 공구(3축 — 공구 방향은 늘 +Z): 평 엔드밀·볼 엔드밀·불 노즈(모서리 R)·드릴(원뿔 끝, V 날도 같은 꼴).
 *
 * 공구 끝(프로그램이 움직이는 점)에서 옆으로 d만큼 떨어진 곳의 날 아랫면 높이를 "끝에서 위로 profile(d)"로 본다(d ≤ 반지름).
 * 파일이 알려 주는 것(공구 주석·공구 정의의 지름과 이름, 주석의 CR=)을 먼저 쓰고, 모르는 것은 사용자가 공구 번호별로 정한 표
 * (이 브라우저에 기억), 그것도 없으면 기본값(평 엔드밀, 지름 6 mm·0.25 inch)을 쓴다. DOM에 기대지 않는다(워커·시험).
 */
import type { NcTool } from '../model';

export type SimToolKind = 'flat' | 'ball' | 'bull' | 'drill';

export const SIM_TOOL_KINDS: readonly SimToolKind[] = ['flat', 'ball', 'bull', 'drill'];

/** 공구 하나(길이 단위 = 프로그램 표시 단위) */
export interface SimTool {
  kind: SimToolKind;
  diameter: number;
  /** 불 노즈 모서리 반지름(볼은 반지름과 같고 평 엔드밀·드릴은 0) */
  corner: number;
  /** 드릴·V 날의 끝 각(도, 전체 각 — 드릴 118, 센터·모따기 90) */
  angle: number;
}

/** 값마다 어디서 왔는지: 파일 · 사용자 표 · 기본값 */
export type SimToolSource = 'file' | 'user' | 'default';

export interface SimToolRow {
  number: number;
  tool: SimTool;
  /** 지름의 출처 */
  diameterFrom: SimToolSource;
  /** 종류(모서리 R 포함)의 출처 */
  kindFrom: SimToolSource;
  /** 파일이 알려 준 값(사용자 표가 덮었을 때 비교용) */
  file: Partial<SimTool>;
}

/** 사용자 표(공구 번호 → 바꾼 값만) */
export type SimToolTable = Record<string, Partial<SimTool>>;

/** 그리드가 쓰는 꼴(종류 번호와 미리 계산한 값) */
export interface PreparedTool {
  /** 0 평, 1 볼, 2 불 노즈, 3 원뿔(드릴) */
  code: 0 | 1 | 2 | 3;
  /** 반지름 */
  r: number;
  /** 모서리 반지름(볼 = r) */
  rc: number;
  /** 평평한 가운데 반지름(불 노즈 r - rc) */
  flat: number;
  /** 원뿔 기울기: 반지름 1당 높이(cot(끝 각/2)) */
  slope: number;
}

const DRILL_RE = /DRILL|SPOT|CENT(?:ER|RE)|CHAMF|C'?SINK|COUNTERSINK|\bTAP\b|BOHR|ZENTRIER|FASE|SENK|REAM|V-?BIT|ENGRAV|드릴|센터|모따기|탭|리머/i;
const POINT90_RE = /SPOT|CENT(?:ER|RE)|CHAMF|C'?SINK|COUNTERSINK|ZENTRIER|FASE|SENK|V-?BIT|ENGRAV|센터|모따기/i;
const BALL_RE = /BALL|\bBN\b|KUGEL|SPHER|볼/i;
const BULL_RE = /BULL|TOR(?:US|IC|O)|CORNER\s*RAD|RADIUS\s*(?:END\s*)?MILL|불\s*노즈/i;

/** 기본 지름(지름을 모를 때) */
export function defaultDiameter(units: 'mm' | 'inch'): number {
  return units === 'inch' ? 0.25 : 6;
}

/** 공구 이름·주석 글 → 종류와 끝 각(모르면 kind 없음) */
export function toolKindFromText(text: string | undefined): { kind?: SimToolKind; angle?: number } {
  if (!text) return {};
  if (BALL_RE.test(text)) return { kind: 'ball' };
  if (DRILL_RE.test(text)) return { kind: 'drill', angle: POINT90_RE.test(text) ? 90 : 118 };
  if (BULL_RE.test(text)) return { kind: 'bull' };
  return {};
}

/** 주석 안의 모서리 반지름(CR=1.5 · CRAD 1.5 · CORNER RAD 1.5) */
export function cornerFromText(text: string): number | undefined {
  const m = /(?:^|[^A-Z])(?:CR|CRAD|CORNER\s*RAD(?:IUS)?|R\s*CORNER)\s*[=:]?\s*(\d+(?:\.\d*)?|\.\d+)/i.exec(text);
  if (!m) return undefined;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** 줄 글에서 주석 부분만(괄호 주석과 ; 뒤) */
function commentsOf(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\(([^()]*)\)/g)) out.push(m[1]!);
  const semi = line.indexOf(';');
  if (semi >= 0) out.push(line.slice(semi + 1));
  return out;
}

/**
 * 파일 주석에서 공구마다 모서리 반지름·종류 낱말을 찾는다(해석기는 이름에서 CR= 같은 값을 뺀다).
 * 머리(처음 300줄)의 "T1 D=6. CR=0.5 …" 꼴 공구 목록과, 공구가 처음 나온 줄 둘레(앞 두 줄 ~ 뒤 한 줄)의 주석을 본다
 */
export function toolHintsFromSource(lineAt: (i: number) => string, lineCount: number, tools: readonly Pick<NcTool, 'number' | 'firstLine'>[]): Map<number, { corner?: number; text: string }> {
  const out = new Map<number, { corner?: number; text: string }>();
  const put = (n: number, c: string): void => {
    const cur = out.get(n) ?? { text: '' };
    const corner = cornerFromText(c);
    if (cur.corner === undefined && corner !== undefined) cur.corner = corner;
    cur.text = cur.text ? `${cur.text} ${c}` : c;
    out.set(n, cur);
  };
  const head = Math.min(lineCount, 300);
  for (let i = 0; i < head; i++) {
    for (const c of commentsOf(lineAt(i))) {
      const m = /(?:^|[^A-Z0-9])T\s*(\d{1,6})(?![\d.])/i.exec(c);
      if (m) put(Number(m[1]), c);
    }
  }
  for (const t of tools) {
    if (t.number < 0 || out.has(t.number)) continue;
    for (let i = Math.max(0, t.firstLine - 2); i <= Math.min(lineCount - 1, t.firstLine + 1); i++) for (const c of commentsOf(lineAt(i))) put(t.number, c);
  }
  return out;
}

/** 파일이 알려 주는 공구 값(NcTool 이름·지름 + 주석 힌트) */
export function fileTool(t: Pick<NcTool, 'diameter' | 'name'>, hint?: { corner?: number; text: string }): Partial<SimTool> {
  const out: Partial<SimTool> = {};
  if (t.diameter && t.diameter > 0) out.diameter = t.diameter;
  const byName = toolKindFromText(t.name);
  const byHint = toolKindFromText(hint?.text);
  const k = byName.kind ? byName : byHint;
  if (k.kind) out.kind = k.kind;
  if (k.angle) out.angle = k.angle;
  const corner = hint?.corner;
  if (corner !== undefined && out.kind !== 'drill') {
    const r = out.diameter ? out.diameter / 2 : undefined;
    if (r !== undefined && corner >= r - 1e-6) out.kind = 'ball';
    else if (corner > 0) {
      out.kind = 'bull';
      out.corner = corner;
    } else if (!out.kind) out.kind = 'flat';
  }
  return out;
}

/** 값 하나를 쓸 만한 수로(아니면 undefined) */
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * 공구 번호 하나의 최종 값: 사용자 표 → 파일 → 기본값 차례로 고른다(사용자가 바꾼 값은 파일 값보다 먼저).
 * 볼은 모서리 = 반지름, 불 노즈 모서리는 반지름 안으로(모르면 반지름의 1/4), 드릴 끝 각은 1~179도
 */
export function resolveTool(number: number, file: Partial<SimTool>, user: Partial<SimTool> | undefined, units: 'mm' | 'inch'): SimToolRow {
  const u = user ?? {};
  const userD = pos(u.diameter);
  const diameter = userD ?? pos(file.diameter) ?? defaultDiameter(units);
  const diameterFrom: SimToolSource = userD ? 'user' : pos(file.diameter) ? 'file' : 'default';
  const userKind = u.kind && SIM_TOOL_KINDS.includes(u.kind) ? u.kind : undefined;
  const kind: SimToolKind = userKind ?? file.kind ?? 'flat';
  const kindFrom: SimToolSource = userKind || u.corner !== undefined || u.angle !== undefined ? 'user' : file.kind ? 'file' : 'default';
  const r = diameter / 2;
  let corner = 0;
  if (kind === 'ball') corner = r;
  else if (kind === 'bull') corner = Math.min(r, pos(u.corner) ?? pos(file.corner) ?? r / 4);
  const angleIn = pos(u.angle) ?? pos(file.angle) ?? 118;
  const angle = Math.max(1, Math.min(179, angleIn));
  return { number, tool: { kind, diameter, corner, angle }, diameterFrom, kindFrom, file };
}

/** 그리드용 꼴 */
export function prepareTool(t: SimTool): PreparedTool {
  const r = Math.max(1e-9, t.diameter / 2);
  switch (t.kind) {
    case 'ball':
      return { code: 1, r, rc: r, flat: 0, slope: 0 };
    case 'bull': {
      const rc = Math.max(0, Math.min(r, t.corner));
      if (rc <= 1e-12) return { code: 0, r, rc: 0, flat: r, slope: 0 };
      if (rc >= r - 1e-12) return { code: 1, r, rc: r, flat: 0, slope: 0 };
      return { code: 2, r, rc, flat: r - rc, slope: 0 };
    }
    case 'drill':
      return { code: 3, r, rc: 0, flat: 0, slope: 1 / Math.tan(((Math.max(1, Math.min(179, t.angle)) / 2) * Math.PI) / 180) };
    default:
      return { code: 0, r, rc: 0, flat: r, slope: 0 };
  }
}

/** 공구 끝에서 옆으로 d(0 ≤ d ≤ r) 떨어진 곳의 날 높이(끝 위로) */
export function profileAt(t: PreparedTool, d: number): number {
  switch (t.code) {
    case 0:
      return 0;
    case 1: {
      const q = t.r * t.r - d * d;
      return t.r - (q > 0 ? Math.sqrt(q) : 0);
    }
    case 2: {
      if (d <= t.flat) return 0;
      const e = d - t.flat;
      const q = t.rc * t.rc - e * e;
      return t.rc - (q > 0 ? Math.sqrt(q) : 0);
    }
    default:
      return d * t.slope;
  }
}
