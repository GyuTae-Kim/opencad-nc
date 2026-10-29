/**
 * 측정 안내·결과 글(순수 함수, DOM 없음): 측정 띠(휴대폰·터치, 3D 보기 아래 가운데)·패널 아래 띠·상태 막대가 함께 쓴다.
 * touch(손가락이 주인 기기)면 안내에서 키(Esc) 설명을 빼고 길게 누르기(정밀 조준, aim.ts)를 알린다.
 * 키 설명이 있는 원래 글(넓은 화면·마우스)은 그대로 둔다.
 *
 * 측정 도구 자체(measure-lock.ts 잠금·툴팁, snap.ts 붙잡기 점, aim.ts 정밀 조준, tangent.ts 원호 접선)는 문서를 열 때 나눠 받는다
 * (core.ts loadMeasureTools). 앱·패널이 받기 전에도 쓰는 글(붙잡은 종류 이름 snapLabel·snapPair)은 여기 둔다 — snap.ts가 다시 내보낸다.
 */
import type { MeasureResult } from 'opencad-viewer3d';
import type { SnapAxis } from 'opencad-viewer3d/inference';
import type { SnapKind } from 'opencad-viewer3d/types';
import { fmtNum } from './format';

/** 측정 도구 조각을 받기 전에 측정을 켰을 때(받는 동안) 상태 줄 글 */
export const MEASURE_LOADING = '측정 도구를 받는 중…';

/**
 * 끌어온 축 위 점의 종류(trackMark — 코어가 'axis'·axis·trackFrom으로만 주는 것을 가른다): true = 끌어온 축(0.16.0),
 * 'edge' = 끌어온 축이 선분·윤곽선과 만나는 점(0.17.0 — segment가 그 선분), 'x'·'y'·'z' = 끌어온 축끼리의 교차(0.17.0 — 둘째 끌어온 축 trackOther의 축)
 */
export type TrackMark = true | 'edge' | SnapAxis;

/**
 * 측정 점·미리 보기(measurePoints·measureHoverSnap)의 끌어온 축 종류(코어 0.17.0 README의 가르는 법): trackOther가 있으면 축끼리의 교차,
 * trackFrom과 segment면 모서리 위, trackFrom과 direction뿐이면 첫 점 축 위 나란한 자리(첫 점에서 그 축 방향 — false),
 * 그 밖의 trackFrom은 끌어온 축. 끌어온 점이 없으면 false
 */
export function trackMark(p: { trackFrom?: readonly number[]; trackOther?: { axis: SnapAxis }; segment?: unknown; direction?: readonly number[] } | null | undefined): TrackMark | false {
  if (!p?.trackFrom) return false;
  if (p.trackOther) return p.trackOther.axis;
  if (p.segment) return 'edge';
  return !p.direction;
}

/**
 * 붙잡은 종류 → 이름(번역층이 옮긴다). 붙잡지 않은 점(선·면 위 아무 자리)은 '붙잡지 않은 점'. 축 방향은 축을 알면 'X축 방향'처럼,
 * tracked(trackMark — 다른 점에서 끌어온 축, 코어 0.16.0·0.17.0 inference.track)면 '끌어온 점에서 X축', 모서리와 만나면
 * '끌어온 점에서 X축 · 모서리 위', 끌어온 축끼리의 교차면 '끌어온 X축과 Y축의 교차'(사전에 9개 모두 있다)
 */
export function snapLabel(kind: SnapKind | null | undefined, axis?: SnapAxis | null, tracked: TrackMark | boolean = false): string {
  if (kind === 'axis' && tracked && axis) {
    const a = axis.toUpperCase();
    return tracked === true ? `끌어온 점에서 ${a}축` : tracked === 'edge' ? `끌어온 점에서 ${a}축 · 모서리 위` : `끌어온 ${a}축과 ${tracked.toUpperCase()}축의 교차`;
  }
  switch (kind) {
    case 'vertex':
      return '꼭짓점';
    case 'endpoint':
      return '끝점';
    case 'midpoint':
      return '가운데 점';
    case 'center':
      return '중심';
    case 'point':
      return '붙잡은 점';
    case 'intersection':
      return '교차점';
    case 'perpendicular':
      return '수직 발';
    case 'axis':
      return axis === 'x' ? 'X축 방향' : axis === 'y' ? 'Y축 방향' : axis === 'z' ? 'Z축 방향' : '축 방향';
    case 'parallel':
      return '나란한 방향';
    default:
      return '붙잡지 않은 점';
  }
}

/**
 * 측정 결과에 붙일 끌어온 축 표시(app.ts onMeasure — 코어 결과 MeasureResult에는 끌어온 점이 없어 찍은 점 measurePoints로 가른다):
 * 그 점의 trackMark(끌어온 축·모서리 위·축끼리의 교차 — 0.17.0 trackOther도)가 있으면 trackA·trackB
 */
export function trackMarks(points: readonly Parameters<typeof trackMark>[0][]): { trackA?: TrackMark; trackB?: TrackMark } {
  const a = trackMark(points[0]);
  const b = trackMark(points[1]);
  return { ...(a ? { trackA: a } : {}), ...(b ? { trackB: b } : {}) };
}

/** 원호 접선으로 잠근 선 위의 점 이름(측정 툴팁·결과 — 코어 종류는 나란함) */
export const TANGENT_LABEL = '접선 방향';

/**
 * 측정 결과의 두 점 붙잡기 이름(붙잡기를 켠 결과 — snapA·snapB가 있을 때만, 둘 다 붙잡지 않았으면 null).
 * 축 방향은 코어가 준 축(axisA·axisB, 코어 0.9.1 — 축 붙잡기는 첫 점을 찍은 뒤에만이라 지금은 둘째 점만)으로 'Y축 방향'처럼.
 * 셋째 값은 둘째 점을 잠근 선 위에 찍었는지(코어 0.10.0 lockedB — Shift·화살표·잠금 단추).
 * tangentB = 앱이 둘째 점을 원호 접선 잠금으로 찍었다고 표시한 결과(app.ts — 코어 종류는 나란함이라 이름만 접선 방향으로).
 * trackA·trackB = 그 점을 다른 점에서 끌어온 축 위에 찍었다고 표시한 결과(app.ts trackMarks — 코어 결과는 축 붙잡기라 이름만
 * '끌어온 점에서 X축'·'… · 모서리 위'·'끌어온 X축과 Y축의 교차'로)
 */
export function snapPair(m: { snapA?: SnapKind | null; snapB?: SnapKind | null; axisA?: SnapAxis; axisB?: SnapAxis; lockedB?: boolean; tangentB?: boolean; trackA?: TrackMark | boolean; trackB?: TrackMark | boolean }): [string, string, boolean] | null {
  if (m.snapA === undefined && m.snapB === undefined) return null;
  if (!m.snapA && !m.snapB) return null;
  return [snapLabel(m.snapA, m.axisA, m.trackA), m.tangentB && m.lockedB ? TANGENT_LABEL : snapLabel(m.snapB, m.axisB, m.trackB), !!m.lockedB];
}

/**
 * 잠근 방향(코어 0.10.0 추론 잠금): 축 셋, 선분과 나란히, 첫 점에서 선분에 내린 수직,
 * 첫 점이 원호 끝일 때 그 원호의 접선(앱이 코어에 방향으로 주는 나란함 잠금 — tangent.ts·measure-lock.ts)
 */
export type LockName = 'x' | 'y' | 'z' | 'parallel' | 'perpendicular' | 'tangent';

/** 잠갔을 때 상태 줄·측정 띠에 적는 글 */
export const LOCK_HINTS: Record<LockName, string> = {
  x: 'X축 방향으로 잠금',
  y: 'Y축 방향으로 잠금',
  z: 'Z축 방향으로 잠금',
  parallel: '나란한 방향으로 잠금',
  perpendicular: '수직 방향으로 잠금',
  tangent: '접선 방향으로 잠금',
};

/** 잠그지 않았을 때(키보드 기기) 커서 아래에 Shift로 잠글 방향이 있으면(코어 0.12.0 measureHoverLock): 그 방향 */
export const SHIFT_LOCK_HINTS: Record<LockName, string> = {
  x: 'Shift로 X축 방향 잠그기',
  y: 'Shift로 Y축 방향 잠그기',
  z: 'Shift로 Z축 방향 잠그기',
  parallel: 'Shift로 나란한 방향 잠그기',
  perpendicular: 'Shift로 수직 방향 잠그기',
  tangent: 'Shift로 접선 방향 잠그기',
};

/** 잠그지 않았고 Shift로 잠글 방향도 없을 때(키보드 기기): 화살표(→ X · ← Y · ↑ Z, ↓ 지금 방향) */
export const ARROW_LOCK_HINT = '화살표로 방향 잠금';

/**
 * 측정 추론 붙잡기(코어 setMeasureSnap({ inference })): 교차점·수직 발·축 방향(0.9.0), 나란함·Shift 잠금(0.10.0).
 * Shift는 0.12.0부터 모서리 끝에서 그 모서리를 따라 가리킨 점 붙잡기도 그 모서리 방향으로 잠근다.
 * 0.16.0 끌어온 축(track): 마우스·펜이 점 붙잡기 위에 0.5초 머문 점(최근 셋)을 지나는 X·Y·Z축과, 첫 점 축 위에서 그 점과 나란한 자리에도 붙는다.
 * 손가락은 머무르지 않는다 — 길게 누르기는 정밀 조준(aim.ts)이 쓰므로 따로 주지 않고, 조준 십자선(펜 포인터)을 점 위에 멈추면 마우스처럼 기억한다
 */
export const MEASURE_INFERENCE = { intersections: true, perpendicular: true, axes: true, parallel: true, lock: true, track: true } as const;

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
