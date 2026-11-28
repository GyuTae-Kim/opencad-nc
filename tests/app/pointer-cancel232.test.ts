// @vitest-environment jsdom
/**
 * 232차(WCAG 2.5.2 포인터 취소): 한 포인터로 하는 기능은 누르는 순간(pointerdown·mousedown·touchstart)에 끝나지 않아야 한다 —
 * ① 결과는 click·pointerup, ② 떼기 전에 밖으로 빼면 취소, ③ 끝난 뒤 되돌릴 수 있음, ④ 꼭 누르는 순간(끌기 시작·누른 채 하는 몸짓). 감사 표는 .runtime/r232/progress.md 표 1과 같은 줄.
 * - 소스 글: src에서 누름 사건을 듣거나 보내는 줄(따옴표 사건 이름·on 속성 꼴 — 주석 줄 뺌)은 모두 PRESS_SITES에 판정과 함께 —
 *   누름 사건 자리가 표 밖에 새로 생기면 판정과 함께 표에 더해야 통과한다(hover-focus226·timing230·status-live231 소스 셈과 같은 꼴).
 * - 고친 것(F1): 측정 띠의 끌어온 점 단추(measure-track.ts)는 손가락·펜으로 누르는 순간에 십자선 아래 점을 기억했고, 기억한 점 하나를 무를 길이 없었다
 *   (다시 누르면 같은 점이 앞으로, 다시 재기는 측정 점까지 모두 지움). 이제 그 누름의 pointerup이 단추 안일 때만 기억한다 — 떼기 전에 밖으로 빼면 기억하지 않는다.
 *   누름의 preventDefault(초점·마우스 흉내 사건 막기)·마우스 click·뒤따르는 click 1초 무시는 그대로.
 * 뷰어는 가짜(끌어온 점 기능만 — 실제 코어 판정과 정밀 조준은 measure-track-pick-core가 본다). jsdom에는 PointerEvent가 없어 MouseEvent에 pointerType·pointerId를 단다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TRACKED, TrackPick, type TrackViewer } from '../../src/app/measure-track';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ───────────────────────── 소스 글: 누름 사건 자리 ─────────────────────────

/** 누름 사건 이름(따옴표 글)과 속성 꼴(onpointerdown 등) */
const PRESS = /(['"`])(pointerdown|mousedown|touchstart)\1|\bon(pointerdown|mousedown|touchstart)\b/gi;
type Judge = '③' | '④' | '셈 밖' | '고침';
interface Site {
  /** progress.md 표 1의 줄 번호 */
  readonly row: number;
  readonly file: string;
  /** 그 코드 줄(앞뒤 빈칸 뺌) */
  readonly line: string;
  readonly what: string;
  readonly judge: Judge;
}
const PRESS_SITES: readonly Site[] = [
  { row: 1, file: 'src/app/aim.ts', line: "const down = type === 'pointerdown' || type === 'pointermove';", what: '보낼 사건의 buttons 가름(듣지 않음)', judge: '셈 밖' },
  { row: 2, file: 'src/app/aim.ts', line: "this.listen('pointerdown', (e) => this.onDown(e));", what: '길게 누르기 타이머·두 손가락 몸짓 시작(측정 점은 떼기에서)', judge: '④' },
  { row: 3, file: 'src/app/aim.ts', line: "this.relay('pointerdown', id, at, AIM_POINTER_TYPE);", what: '떼는 순간 십자선 자리로 코어에 보내는 사건', judge: '셈 밖' },
  { row: 4, file: 'src/app/aim.ts', line: "if (p) this.relay('pointerdown', id, p);", what: '둘째 손가락이 닿을 때 첫 손가락을 코어에 다시 보내는 사건', judge: '셈 밖' },
  { row: 5, file: 'src/app/app.ts', line: "for (const type of ['pointerdown', 'focusin'] as const)", what: '바깥 누름에 펼친 메뉴·단면 상자 닫기(버리는 값 없음 — 다시 열면 됨)', judge: '③' },
  { row: 6, file: 'src/app/app.ts', line: "v.canvas.addEventListener('pointerdown', (e) => {", what: '받지 못한 3D 보기 띠를 조용히 다시 받기(누른 기능의 결과 아님)', judge: '셈 밖' },
  { row: 7, file: 'src/app/measure-lock.ts', line: "this.button.addEventListener('pointerdown', (e) => {", what: '방향 잠금 켜고 끄기(손가락·펜 — 다시 누르면 앞 상태)', judge: '③' },
  { row: 8, file: 'src/app/measure-lock.ts', line: 'c.addEventListener(\'pointerdown\', () => (this.undo = null));', what: 'Shift+Tab 되돌리기 기록 버림(결과 없음)', judge: '셈 밖' },
  { row: 9, file: 'src/app/measure-track.ts', line: "this.button.addEventListener('pointerdown', (e) => {", what: '끌어온 점 단추 — 누름은 막기·기록만, 기억은 단추 안 떼기(232차)', judge: '고침' },
  { row: 10, file: 'src/app/panel.ts', line: "grip.addEventListener('pointerdown', (ev) => {", what: '패널 크기 손잡이 끌기 시작(탭의 다음 크기는 떼기)', judge: '④' },
  { row: 11, file: 'src/app/shortcuts.ts', line: "back.addEventListener('pointerdown', (e) => {", what: '마우스 막 바깥 누름에 도움 창 닫기(값 없음 — 다시 열면 됨), 손가락·펜은 click', judge: '③' },
  { row: 12, file: 'src/app/viewer-ui.ts', line: "el.addEventListener('pointerdown', (ev) => {", what: '단면 손잡이 끌기 시작', judge: '셈 밖' },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}
/** 파일·코드 줄(주석 줄 — //·*·/* 로 시작 — 뺌)마다 누름 사건 글의 수 */
function pressSites(): Map<string, number> {
  const seen = new Map<string, number>();
  for (const f of tsFiles('src')) {
    for (const raw of read(f).split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(raw)) continue;
      const n = [...raw.matchAll(PRESS)].length;
      if (n) seen.set(`${f}\t${raw.trim()}`, (seen.get(`${f}\t${raw.trim()}`) ?? 0) + n);
    }
  }
  return seen;
}

describe('소스 글: 누름 사건 자리', () => {
  it('src의 누름 사건 자리는 모두 감사 표에 판정과 함께 있다(표 밖 새 자리·사라진 자리 0) — 12곳·7파일, 실패는 끌어온 점 단추 하나(고침)', () => {
    const seen = pressSites();
    const want = new Map(PRESS_SITES.map((s) => [`${s.file}\t${s.line}`, 1]));
    const outside = [...seen].filter(([k, n]) => want.get(k) !== n).map(([k, n]) => `${k.replace('\t', ': ')} ×${n}`);
    const stale = [...want.keys()].filter((k) => !seen.has(k)).map((k) => k.replace('\t', ': '));
    expect({ outside, stale }).toEqual({ outside: [], stale: [] });
    expect(new Set(PRESS_SITES.map((s) => s.file)).size).toBe(7);
    const by = (j: Judge): number[] => PRESS_SITES.filter((s) => s.judge === j).map((s) => s.row);
    expect({ out: by('셈 밖'), undo: by('③'), essential: by('④'), fixed: by('고침') }).toEqual({ out: [1, 3, 4, 6, 8, 12], undo: [5, 7, 11], essential: [2, 10], fixed: [9] });
  });
});

// ───────────────────────── 고친 것: 끌어온 점 단추(F1) ─────────────────────────

const P = [10, 0, 0];

function setup() {
  const pts: number[][] = [];
  const v = {
    measureMode: true,
    measureHoverSnap: { point: P, snap: 'endpoint' },
    get measureTrackPoints(): number[][] {
      return pts.map((p) => [...p]);
    },
    setMeasureTrackPoints: vi.fn((next: number[][]): number => {
      pts.splice(0, pts.length, ...next.slice(0, 3));
      return pts.length;
    }),
  };
  const flash = vi.fn();
  const track = new TrackPick({ viewer: () => v as unknown as TrackViewer, touch: () => true, aiming: () => true, flash, changed: () => {} });
  const b = track.button;
  // 측정 띠의 38×38 단추 자리(화면 좌표)
  b.getBoundingClientRect = () => ({ left: 100, top: 200, right: 138, bottom: 238, width: 38, height: 38, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
  document.body.replaceChildren(b);
  const ptr = (type: string, x: number, y: number, pointerType = 'touch', pointerId = 3): MouseEvent => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    Object.defineProperty(e, 'pointerId', { value: pointerId });
    b.dispatchEvent(e);
    return e;
  };
  return { v, flash, track, ptr };
}

describe('끌어온 점 단추 — 누르는 순간이 아니라 단추 안에서 뗄 때(232차)', () => {
  it('손가락·펜: 누르는 순간에는 기억하지 않고(누름의 막기는 그대로), 그 누름을 단추 안에서 떼면 한 번 기억한다 — 뒤따르는 click은 다시 세지 않는다', () => {
    for (const pointerType of ['touch', 'pen']) {
      const { v, flash, track, ptr } = setup();
      const down = ptr('pointerdown', 119, 219, pointerType);
      expect(down.defaultPrevented, pointerType).toBe(true);
      expect(v.setMeasureTrackPoints, pointerType).not.toHaveBeenCalled();
      expect(flash, pointerType).not.toHaveBeenCalled();
      expect(track.count, pointerType).toBe(0);
      ptr('pointerup', 121, 222, pointerType);
      expect(v.setMeasureTrackPoints, pointerType).toHaveBeenCalledTimes(1);
      expect(v.measureTrackPoints, pointerType).toEqual([P]);
      expect(flash.mock.calls.map((c) => c[0]), pointerType).toEqual([TRACKED]);
      expect(track.count, pointerType).toBe(1);
      track.button.click();
      expect(v.setMeasureTrackPoints, pointerType).toHaveBeenCalledTimes(1);
    }
  });

  it('떼기 전에 단추 밖으로 빼면(손가락은 암시적 잡기로 단추가 떼기를 받음) 기억하지 않고 뒤따르는 click도 세지 않는다 — 취소·다른 포인터의 떼기도', () => {
    const { v, flash, track, ptr } = setup();
    ptr('pointerdown', 119, 219);
    ptr('pointerup', 119, 300);
    track.button.click();
    expect(v.setMeasureTrackPoints).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
    // 브라우저가 누름을 취소하면(pointercancel) 그 뒤에 오는 떼기는 이 누름이 아니다
    ptr('pointerdown', 119, 219);
    ptr('pointercancel', 119, 219);
    ptr('pointerup', 119, 219);
    // 다른 포인터(정밀 조준 손가락 등)의 떼기도
    ptr('pointerdown', 119, 219, 'touch', 3);
    ptr('pointerup', 119, 219, 'touch', 4);
    expect(v.setMeasureTrackPoints).not.toHaveBeenCalled();
    ptr('pointerup', 120, 220, 'touch', 3);
    expect(v.setMeasureTrackPoints).toHaveBeenCalledTimes(1);
    expect(track.count).toBe(1);
  });

  it('마우스는 누름·떼기에 하지 않고 click에서(① — 그대로), 키보드 Enter·Space의 click도 그대로', () => {
    const { v, track, ptr } = setup();
    ptr('pointerdown', 119, 219, 'mouse', 1);
    ptr('pointerup', 119, 219, 'mouse', 1);
    expect(v.setMeasureTrackPoints).not.toHaveBeenCalled();
    track.button.click();
    expect(v.setMeasureTrackPoints).toHaveBeenCalledTimes(1);
    expect(track.count).toBe(1);
  });
});
