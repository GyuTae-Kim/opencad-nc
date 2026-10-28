/**
 * 측정 안내·결과 글(순수 함수, DOM 없음): 측정 띠(휴대폰·터치, 3D 보기 아래 가운데)·패널 아래 띠·상태 막대가 함께 쓴다.
 * touch(손가락이 주인 기기)면 안내에서 키(Esc) 설명을 빼고 길게 누르기(정밀 조준, aim.ts)를 알린다.
 * 키 설명이 있는 원래 글(넓은 화면·마우스)은 그대로 둔다.
 */
import type { MeasureResult } from 'opencad-viewer3d';
import { fmtNum } from './format';

/** 잠근 방향(코어 0.10.0 추론 잠금): 축 셋, 선분과 나란히, 첫 점에서 선분에 내린 수직 */
export type LockName = 'x' | 'y' | 'z' | 'parallel' | 'perpendicular';

/** 잠갔을 때 상태 줄·측정 띠에 적는 글 */
export const LOCK_HINTS: Record<LockName, string> = {
  x: 'X축 방향으로 잠금',
  y: 'Y축 방향으로 잠금',
  z: 'Z축 방향으로 잠금',
  parallel: '나란한 방향으로 잠금',
  perpendicular: '수직 방향으로 잠금',
};

/** 잠그지 않았을 때(키보드 기기) 커서 아래에 Shift로 잠글 방향이 있으면(코어 0.12.0 measureHoverLock): 그 방향 */
export const SHIFT_LOCK_HINTS: Record<LockName, string> = {
  x: 'Shift로 X축 방향 잠그기',
  y: 'Shift로 Y축 방향 잠그기',
  z: 'Shift로 Z축 방향 잠그기',
  parallel: 'Shift로 나란한 방향 잠그기',
  perpendicular: 'Shift로 수직 방향 잠그기',
};

/** 잠그지 않았고 Shift로 잠글 방향도 없을 때(키보드 기기): 화살표(→ X · ← Y · ↑ Z, ↓ 지금 방향) */
export const ARROW_LOCK_HINT = '화살표로 방향 잠금';

/**
 * 측정 추론 붙잡기(코어 setMeasureSnap({ inference })): 교차점·수직 발·축 방향(0.9.0), 나란함·Shift 잠금(0.10.0).
 * Shift는 0.12.0부터 모서리 끝에서 그 모서리를 따라 가리킨 점 붙잡기도 그 모서리 방향으로 잠근다
 */
export const MEASURE_INFERENCE = { intersections: true, perpendicular: true, axes: true, parallel: true, lock: true } as const;

/** 잠금 단추를 눌렀는데 잠글 방향이 없을 때(손가락 기기·마우스) */
export const NO_LOCK_TOUCH = '잠글 방향이 없습니다: 길게 눌러 조준하며 축·나란한 방향에 맞춘 뒤 누르세요';
export const NO_LOCK_MOUSE = '잠글 방향이 없습니다: 커서를 축·나란한 방향에 맞춘 뒤 누르세요';

/** 코어 잠금 상태(measureInferenceLock) → 잠근 방향 이름 */
export function lockName(l: { kind: string; axis?: 'x' | 'y' | 'z' } | null | undefined): LockName | null {
  if (!l) return null;
  if (l.kind === 'axis') return l.axis ?? null;
  return l.kind === 'parallel' ? 'parallel' : l.kind === 'perpendicular' ? 'perpendicular' : null;
}

/**
 * 잠금 안내(첫 점을 찍은 뒤 결과가 없을 때만 — 둘째 점의 방향을 잡는 동안): 잠갔으면 그 방향, 아니면 키보드 기기에만 —
 * 커서 아래에 Shift로 잠글 방향(hover — 코어 measureHoverLock)이 있으면 "Shift로 그 방향 잠그기", 없으면 화살표 안내
 * (손가락 기기는 측정 띠의 잠금 단추). 상태 줄·측정 띠는 안내 글 다음에 따로 둔다(번역이 안내 글을 한 덩어리로 찾게)
 */
export function lockHint(points: number, hasResult: boolean, lock: LockName | null, touch = false, hover: LockName | null = null): string | null {
  if (hasResult || points !== 1) return null;
  if (lock) return LOCK_HINTS[lock];
  if (touch) return null;
  return hover ? SHIFT_LOCK_HINTS[hover] : ARROW_LOCK_HINT;
}

/** 측정 띠 안내(찍은 점 수 0~2, 결과가 있는지) */
export function measureHint(points: number, hasResult: boolean, touch = false): string {
  if (hasResult || points >= 2) return touch ? '측정: 다시 누르면 새로 잽니다' : '측정: 다시 누르면 새로 잽니다 · Esc 지우기';
  if (points === 1) return touch ? '측정: 끝점을 누르십시오' : '측정: 끝점을 누르십시오 · Esc 취소';
  return touch ? '측정: 잴 시작점을 누르십시오 · 길게 누르면 정밀 조준' : '측정: 잴 시작점을 누르십시오';
}

/**
 * 패널 아래 띠의 측정 안내(아직 결과가 없을 때). paths면(공구 경로·판재 윤곽 붙잡기를 켰으면 — app.ts syncMeasureSnap)
 * 원호 중심·가운데 점·교차점과 둘째 점의 수직 발·축 방향에도 붙는다고 알린다. 아니면 코어 기본(꼭짓점·끝점)
 */
export function panelMeasureHint(touch = false, paths = false): string {
  if (paths)
    return touch
      ? '측정: 두 점을 누르십시오(끝점·중심·가운데 점·교차점에 붙고, 둘째 점은 수직 발·축 방향에도 붙습니다) · 길게 누르면 정밀 조준'
      : '측정: 두 점을 누르십시오(끝점·중심·가운데 점·교차점에 붙고, 둘째 점은 수직 발·축 방향에도 붙습니다). Esc = 지우기';
  return touch ? '측정: 두 점을 누르십시오(꼭짓점·끝점 가까우면 그 점에 붙습니다) · 길게 누르면 정밀 조준' : '측정: 두 점을 누르십시오(꼭짓점·끝점 가까우면 그 점에 붙습니다). Esc = 지우기';
}

/** 상태 막대의 측정 안내(아직 결과가 없을 때) */
export function statusMeasureHint(touch = false): string {
  return touch ? '측정: 두 점을 누르십시오' : '측정: 두 점을 누르십시오(Esc = 지우기)';
}

/** 측정 결과 글: 거리(굵게)와 축별 길이(패널 아래 띠와 같은 꼴) */
export function measureLines(m: Pick<MeasureResult, 'distance' | 'dx' | 'dy' | 'dz'>, u: string): { value: string; axes: string } {
  return { value: `${fmtNum(m.distance)}${u ? ` ${u}` : ''}`, axes: `dx ${fmtNum(m.dx)} · dy ${fmtNum(m.dy)} · dz ${fmtNum(m.dz)}` };
}
