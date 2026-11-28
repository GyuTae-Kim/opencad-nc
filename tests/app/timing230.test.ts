// @vitest-environment jsdom
/**
 * 230차(WCAG 2.2.1 시간 조절): 앱이 띄우고 시간이 지나면 저절로 닫는 내용은 (가) 누를 것(동작 버튼)이 들었으면 시간으로 닫지 않거나 올림·초점 동안 멈추고
 * 떠난 뒤 처음 시간 이상을 다시 주고, (나) 읽기만 하는 글은 같은 글이 다른 자리에 남거나 올림·초점 동안 멈춰야 한다(둘 다 아닌 오류·경고는 고칠 거리).
 * (다) 시간을 쓰지 않고 닫는 길(✕)도 본다. 감사 표는 .runtime/r230/progress.md 표 1과 같은 줄.
 * - 소스 글: src의 타이머(setTimeout·setInterval)·알림 상자(toast)·멈춤 도우미(holdOpen)·측정 띠 위 알림(showFlash·host.flash) 자리는 모두 SITES에 —
 *   시간으로 닫는 새 자리가 표 밖에 생기면 판정과 함께 표에 더해야 통과한다(hover-focus226 사건 셈과 같은 꼴 — 주석 줄 뺌).
 * - 고친 것(230차): 측정 띠 위 알림(잠글 방향이 없다·기억할 점이 없다는 경고, 끌어온 점 기억 확인)은 포인터가 위에 있어도 3.2·2.4초에 사라졌고 같은 글이 남는
 *   다른 자리도 없었다. 알림 상자의 157차 멈춤을 dom.ts holdOpen으로 꺼내 함께 쓴다 — 올린 동안 남고, 떠나면 그때부터 처음 시간. 올리지 않으면 전과 같은 시간.
 * 시간은 가짜 시계로만 넘긴다(13번 — 횟수 기다림 없음).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFailed, toast } from '../../src/app/dom';
import { MeasureLock, NO_LOCK_MOUSE } from '../../src/app/measure-lock';
import { NO_TRACK_MOUSE, TRACKED } from '../../src/app/measure-track';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ───────────────────────── 소스 글: 시간으로 닫는 자리 ─────────────────────────

/** 타이머·알림 상자·멈춤 도우미·띠 위 알림 부름(선언 「function 이름(」은 뺌) */
const SITE = /(?<!function )\b(setTimeout|setInterval|toast|holdOpen|showFlash)\(|\bhost\.(flash)\(/g;
type Judge = '지킴' | '고침' | '셈 밖';
interface Site {
  /** progress.md 표 1의 줄 */
  readonly row: string;
  readonly file: string;
  readonly call: string;
  readonly n: number;
  readonly what: string;
  readonly judge: Judge;
}
const SITES: readonly Site[] = [
  { row: '공통', file: 'src/app/dom.ts', call: 'setTimeout', n: 1, what: 'holdOpen의 닫기 — 포인터가 위·초점이 안이면 닫지 않고, 떠나면 그때부터 다시 ms(157차 → 230차 꺼냄)', judge: '고침' },
  { row: '공통', file: 'src/app/dom.ts', call: 'holdOpen', n: 1, what: '알림 상자(toast)가 멈춤 도우미로 닫기를 건다 — 모든 알림에 ✕', judge: '지킴' },
  { row: '1', file: 'src/app/dom.ts', call: 'toast', n: 1, what: 'loadFailed 알림 — 오류 8초, 다시 시도/새로 고침(가: 멈춤·같은 기능 다시 열기)', judge: '지킴' },
  { row: '2~16', file: 'src/app/app.ts', call: 'toast', n: 17, what: '새 버전(60초 새로 고침 — 가)·읽지 않은 파일·최근 문서·다시 읽음·공유 오류·읽기 멈춤·열기 오류·해석/3D 보기 경고·측정 도구·PNG·그림 저장·시뮬레이션·이동 없는 줄(나: 멈춤)', judge: '지킴' },
  { row: '17·18', file: 'src/app/sim.ts', call: 'toast', n: 2, what: '시뮬레이션하지 않음(깎기 탭 줄에도)·탭이 안 보일 때 깎기 오류(탭 상태 글에도) — 나: 멈춤·다른 자리', judge: '지킴' },
  { row: '19', file: 'src/app/measure-lock.ts', call: 'toast', n: 1, what: '측정 띠가 안 보일 때 잠글 방향이 없다는 경고 — 나: 멈춤', judge: '지킴' },
  { row: '20~22', file: 'src/app/measure-lock.ts', call: 'showFlash', n: 2, what: '띠 위 알림 띄우기(선언·잠글 방향 없음 noLock)', judge: '고침' },
  { row: '20~22', file: 'src/app/measure-lock.ts', call: 'holdOpen', n: 2, what: '띠 위 알림 거두기를 멈춤 도우미로 걸고(showFlash) 거둔다(dropFlash)', judge: '고침' },
  { row: '20~22', file: 'src/app/app.ts', call: 'showFlash', n: 1, what: '끌어온 점 버튼이 쓰는 띠 위 알림(measure-track host.flash)', judge: '고침' },
  { row: '21·22', file: 'src/app/measure-track.ts', call: 'host.flash', n: 2, what: '기억할 점이 없다는 경고(3.2초)·끌어온 점으로 기억했다는 확인(2.4초 — 버튼 수 배지에도)', judge: '고침' },
  { row: '23·24', file: 'src/app/shortcuts.ts', call: 'setTimeout', n: 2, what: '단축키 창을 닫은 뒤 숨은 알림 칸에 한 프레임 뒤 넣고 5초 뒤 비움 — 같은 글이 그 글이 나온 앱 알림 영역에 남음(나)', judge: '지킴' },
  { row: '25~27', file: 'src/app/app.ts', call: 'setTimeout', n: 3, what: '기다림 한도(race)·읽는 중 덮개 단계 글 늦춰 넣기(일이 끝나면 닫힘)·내려받기 주소 거두기', judge: '셈 밖' },
  { row: '28', file: 'src/app/panel.ts', call: 'setTimeout', n: 1, what: '코드 찾기 칸 친 글 늦춰 찾기(250ms)', judge: '셈 밖' },
  { row: '29', file: 'src/app/aim.ts', call: 'setTimeout', n: 1, what: '길게 누름 판정(정밀 조준 시작)', judge: '셈 밖' },
  { row: '30·31', file: 'src/app/sim.ts', call: 'setTimeout', n: 3, what: '다시 그린 칸 바꿈 사건 늦춤·장면 다시 올리기 예약(16·400ms)', judge: '셈 밖' },
  { row: '32', file: 'src/sim/runner.ts', call: 'setTimeout', n: 1, what: '일 나누기(0)', judge: '셈 밖' },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}
/** 파일·부름마다 코드 줄(주석 줄 — //·*·/* 로 시작 — 뺌)의 수 */
function sites(): Map<string, number> {
  const seen = new Map<string, number>();
  for (const f of tsFiles('src'))
    for (const line of read(f).split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(SITE)) {
        const k = `${f} ${m[1] ?? `host.${m[2]}`}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
  return seen;
}

describe('230차 저절로 사라지는 알림의 시간 제한(WCAG 2.2.1) 감사 표', () => {
  it('소스 글: src의 타이머·알림 상자·멈춤 도우미·띠 위 알림 자리는 모두 SITES에(새 자리는 판정과 함께 표에), 표 줄의 자리는 모두 있다 — 두 알림은 멈춤 도우미로 닫는다', () => {
    const seen = sites();
    const want = new Map<string, number>();
    for (const s of SITES) want.set(`${s.file} ${s.call}`, (want.get(`${s.file} ${s.call}`) ?? 0) + s.n);
    const outside = [...seen].filter(([k, n]) => want.get(k) !== n).map(([k, n]) => `${k} ×${n}(표 ×${want.get(k) ?? 0})`);
    const stale = [...want].filter(([k]) => !seen.has(k)).map(([k]) => k);
    expect({ outside, stale }).toEqual({ outside: [], stale: [] });
    // 알림 상자는 멈춤 도우미로 지우고, 띠 위 알림은 멈춤 도우미로 거두기를 걸고 거둔다(측정 조각에 타이머 없음)
    expect(read('src/app/dom.ts')).toContain('holdOpen(el, ms, () => el.remove());');
    const lock = read('src/app/measure-lock.ts');
    expect([lock.includes('holdOpen(this.flash, ms, () => this.dropFlash(null));'), lock.includes('holdOpen(this.flash, 0, null);'), /setTimeout\(/.test(lock)]).toEqual([true, true, false]);
  });
});

describe('230차 시간으로 닫는 알림 — 가짜 시계', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 띠 위 알림은 두 프레임 뒤 자리를 맞춘다(measure-lock schedule) — 그 프레임도 가짜 시계로
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  /** 측정 띠와 그 위 알림 칸(뷰어 없음 — 알림 글만 본다) */
  function flashLock(): { lock: MeasureLock; el: HTMLDivElement } {
    const layer = document.createElement('div');
    const bar = document.createElement('div');
    document.body.append(layer, bar);
    const lock = new MeasureLock({ viewer: () => null, touch: () => false, layer, changed: () => {} });
    bar.append(lock.button, lock.flash);
    return { lock, el: lock.flash };
  }

  it('고친 것(표 20·21): 측정 띠 위 경고는 포인터가 위에 있는 동안 남고, 떠나면 그때부터 처음 시간(3.2초) 뒤 거둔다 — 올리지 않으면 전과 같은 시간', () => {
    const { lock, el } = flashLock();
    lock.showFlash(NO_LOCK_MOUSE, 3200, 'no-lock');
    vi.advanceTimersByTime(3000);
    el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(el.textContent).toBe(NO_LOCK_MOUSE);
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(3199);
    expect(el.textContent).toBe(NO_LOCK_MOUSE);
    vi.advanceTimersByTime(1);
    expect(el.textContent).toBe('');
    // 올리지 않으면 제 시간에(117·192차 그대로)
    lock.showFlash(NO_TRACK_MOUSE, 3200, 'track');
    vi.advanceTimersByTime(3199);
    expect(el.textContent).toBe(NO_TRACK_MOUSE);
    vi.advanceTimersByTime(1);
    expect(el.textContent).toBe('');
  });

  it('고친 것(표 21·22): 올린 채 같은 칸에 새 글이 오면 올림이 이어져 남고, 다른 길이 거두면 바로 — 거둔 칸은 떠나도 다시 걸지 않고, 다시 띄우면 처음 시간', () => {
    const { lock, el } = flashLock();
    lock.showFlash(NO_TRACK_MOUSE, 3200, 'track');
    el.dispatchEvent(new Event('pointerenter'));
    lock.showFlash(TRACKED, 2400, 'track');
    vi.advanceTimersByTime(30_000);
    expect(el.textContent).toBe(TRACKED);
    // 잠금이 걸림·측정 끄기 같은 다른 길(dropFlash)은 올려 있어도 바로 거둔다
    lock.dropFlash(null);
    expect(el.textContent).toBe('');
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(30_000);
    expect(el.textContent).toBe('');
    lock.showFlash(NO_LOCK_MOUSE, 3200, 'no-lock');
    vi.advanceTimersByTime(3199);
    expect(el.textContent).toBe(NO_LOCK_MOUSE);
    vi.advanceTimersByTime(1);
    expect(el.textContent).toBe('');
  });

  it('지킴(표 1 — 가·다): 동작 든 알림(받지 못한 조각의 「다시 시도」)은 포인터가 위·초점이 동작 버튼에 있는 동안 남고, 떠나면 그때부터 처음 시간(8초) — ✕는 시간을 쓰지 않고 닫는다', () => {
    let retried = 0;
    loadFailed('단축키', () => retried++);
    const el = document.querySelector<HTMLElement>('.toasts > .toast.error')!;
    const [act] = [...el.querySelectorAll<HTMLButtonElement>('button')];
    expect(act!.textContent).toBe('다시 시도');
    el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(el.isConnected).toBe(true);
    el.dispatchEvent(new Event('pointerleave'));
    act!.focus();
    vi.advanceTimersByTime(60_000);
    expect([el.isConnected, document.activeElement === act]).toEqual([true, true]);
    const out = document.body.appendChild(document.createElement('button'));
    out.focus();
    vi.advanceTimersByTime(7999);
    expect(el.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect([el.isConnected, retried]).toEqual([false, 0]);
    // (다) 읽기만 하는 알림도 ✕로 바로 닫는다
    toast('읽지 않은 파일: a.txt', 'info', 6000);
    const note = document.querySelector<HTMLElement>('.toasts > .toast')!;
    note.querySelector<HTMLElement>('.toast-x')!.click();
    expect(note.isConnected).toBe(false);
  });
});
