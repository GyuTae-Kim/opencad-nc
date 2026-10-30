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
 * 축 위 점의 종류(trackMark — 코어가 'axis'·axis에 trackFrom·trackOther·segment·face를 실어 주는 것을 가른다): true = 끌어온 축(0.16.0),
 * 'edge' = 끌어온 축이 선분·윤곽선과 만나는 점(0.17.0 — segment가 그 선분), 'x'·'y'·'z' = 끌어온 축끼리의 교차(0.17.0 — 둘째 끌어온 축 trackOther의 축).
 * 0.18.0: 'face' = 끌어온 축이 그물 면을 뚫는 점, 'axisEdge'·'axisFace' = 첫 점 축이 선분·윤곽선과 만나는 점·그물 면을 뚫는 점.
 * 0.19.0: 'lockEdge'·'lockFace' = 잠근 선(축·나란함·수직·원호 접선)이 선분·윤곽선과 만나는 점·그물 면을 뚫는 점(inference.lockEdges·lockFaces)
 * 0.21.0(inference.lockTracks): 'lockX'·'lockY'·'lockZ' = 잠근 선이 끌어온 점의 그 축과 만나는 점(trackOther), 'lockFrom' = 축으로 잠근 선 위에서 끌어온 점과 나란한 자리(trackFrom)
 */
export type TrackMark = true | 'edge' | 'face' | 'axisEdge' | 'axisFace' | LockMeet | SnapAxis;

/** 잠근 선 위의 점 종류(0.19.0 모서리·면, 0.21.0 끌어온 축·끌어온 점과 나란한 자리) */
export type LockMeet = 'lockEdge' | 'lockFace' | 'lockX' | 'lockY' | 'lockZ' | 'lockFrom';
const LOCK_MEETS: ReadonlySet<unknown> = new Set(['lockEdge', 'lockFace', 'lockX', 'lockY', 'lockZ', 'lockFrom']);

/** 잠근 선 위의 교차인지(0.19.0·0.21.0 — 이름이 이미 "잠근 …"이라 툴팁·결과에 "잠금"을 다시 붙이지 않는다) */
export const lockMeet = (t: TrackMark | boolean | undefined): t is LockMeet => LOCK_MEETS.has(t);

/**
 * 잠근 선 위 교차의 이름: 잠근 방향(X축·나란한 방향·수직 방향·접선 방향) 다음에 모서리 위·면 위 — '잠근 X축 · 모서리 위',
 * 끌어온 축이면 '잠근 X축 · 끌어온 점에서 Y축', 끌어온 점과 나란한 자리면 '잠근 X축 · 끌어온 점과 나란히'
 */
export const lockMeetLabel = (base: string, t: LockMeet): string =>
  t === 'lockEdge' || t === 'lockFace' ? `잠근 ${base} · ${t === 'lockEdge' ? '모서리' : '면'} 위` : t === 'lockFrom' ? `잠근 ${base} · 끌어온 점과 나란히` : `잠근 ${base} · 끌어온 점에서 ${t.slice(4)}축`;

/**
 * 측정 점·미리 보기(measurePoints·measureHoverSnap)의 축 위 점 종류(코어 0.17.0·0.18.0·0.19.0 README의 가르는 법): trackOther가 있으면 축끼리의 교차,
 * trackFrom과 face면 면 위, trackFrom과 segment면 모서리 위, trackFrom과 direction뿐이면 첫 점 축 위 나란한 자리(첫 점에서 그 축 방향 — false),
 * 그 밖의 trackFrom은 끌어온 축. 잠근 선 위 점(locked)에 segment·face가 있으면 잠근 선이 모서리와 만나는 점·면을 뚫는 점(0.19.0 — from은 없다).
 * 끌어온 점이 없는 축 붙잡기(snap 'axis')는 face면 첫 점 축 · 면 위, segment면 첫 점 축 · 모서리 위, 아니면 false.
 * 0.21.0(lockTracks): 잠근 선 위 점에 trackOther가 있으면(trackFrom 없이) 잠근 선이 끌어온 점의 그 축과 만나는 점, trackFrom만 있으면(trackOther·선분·면 없이)
 * 잠근 축 위 끌어온 점과 나란한 자리(잠그지 않은 점의 trackFrom은 0.16.0 그대로 — 잠근 동안 끌어온 축은 이 선택으로만 온다)
 */
export function trackMark(p: { snap?: SnapKind | null; trackFrom?: readonly number[]; trackOther?: { axis: SnapAxis }; segment?: unknown; face?: unknown; direction?: readonly number[]; locked?: boolean } | null | undefined): TrackMark | false {
  if (p?.locked && !p.trackFrom && (p.face || p.segment)) return p.face ? 'lockFace' : 'lockEdge';
  if (p?.locked && p.trackOther && !p.trackFrom) return `lock${p.trackOther.axis.toUpperCase() as 'X' | 'Y' | 'Z'}`;
  if (p?.locked && p.trackFrom && !p.trackOther && !p.segment && !p.face) return 'lockFrom';
  if (!p?.trackFrom) return p?.snap !== 'axis' ? false : p.face ? 'axisFace' : p.segment ? 'axisEdge' : false;
  if (p.trackOther) return p.trackOther.axis;
  if (p.face) return 'face';
  if (p.segment) return 'edge';
  return !p.direction;
}

/**
 * 붙잡은 종류 → 이름(번역층이 옮긴다). 붙잡지 않은 점(선·면 위 아무 자리)은 '붙잡지 않은 점'. 축 방향은 축을 알면 'X축 방향'처럼,
 * tracked(trackMark — 다른 점에서 끌어온 축, 코어 0.16.0·0.17.0 inference.track)면 '끌어온 점에서 X축', 모서리와 만나면
 * '끌어온 점에서 X축 · 모서리 위', 끌어온 축끼리의 교차면 '끌어온 X축과 Y축의 교차'(사전에 9개 모두 있다).
 * 0.18.0: 면을 뚫으면 '끌어온 점에서 X축 · 면 위', 첫 점 축이 모서리·면과 만나면 'X축 · 모서리 위'·'X축 · 면 위'(사전에 9개 더).
 * 0.19.0: 잠근 선이 모서리·면과 만나면 '잠근 X축 · 모서리 위'·'잠근 나란한 방향 · 면 위'처럼(축 셋·나란함·수직·접선·모르는 방향 × 둘 — 사전에 14개).
 * 0.21.0: 잠근 선이 끌어온 점의 축과 만나면 '잠근 X축 · 끌어온 점에서 Y축'(잠근 축과 나란한 축은 오지 않아 축 잠금 6 + 나란함·수직·접선·모르는 방향 × 축 셋 12),
 * 축으로 잠근 선 위 끌어온 점과 나란한 자리면 '잠근 X축 · 끌어온 점과 나란히'(축 셋) — 사전에 21개
 */
export function snapLabel(kind: SnapKind | null | undefined, axis?: SnapAxis | null, tracked: TrackMark | boolean = false): string {
  if (lockMeet(tracked)) return lockMeetLabel(kind === 'axis' && axis ? `${axis.toUpperCase()}축` : kind === 'parallel' ? '나란한 방향' : kind === 'perpendicular' ? '수직 방향' : '방향', tracked);
  if (kind === 'axis' && tracked && axis) {
    const a = `${axis.toUpperCase()}축`;
    if (tracked === 'axisEdge' || tracked === 'axisFace') return `${a} · ${tracked === 'axisEdge' ? '모서리' : '면'} 위`;
    return tracked === true ? `끌어온 점에서 ${a}` : tracked === 'edge' || tracked === 'face' ? `끌어온 점에서 ${a} · ${tracked === 'edge' ? '모서리' : '면'} 위` : `끌어온 ${a}과 ${tracked.toUpperCase()}축의 교차`;
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
 * 측정 결과에 붙일 축 위 점 표시(app.ts onMeasure — 코어 결과 MeasureResult에는 끌어온 점·선분·면이 없어 찍은 점 measurePoints로 가른다):
 * 그 점의 trackMark(끌어온 축·모서리 위·축끼리의 교차 — 0.17.0 trackOther도, 0.18.0 면 위·첫 점 축의 모서리 위·면 위,
 * 0.19.0 잠근 선의 모서리 위·면 위)가 있으면 trackA·trackB
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
 * trackA·trackB = 그 점을 다른 점에서 끌어온 축 위나 첫 점 축이 모서리·면과 만나는 점에 찍었다고 표시한 결과(app.ts trackMarks —
 * 코어 결과는 축 붙잡기라 이름만 '끌어온 점에서 X축'·'… · 모서리 위'·'… · 면 위'·'끌어온 X축과 Y축의 교차'·'X축 · 모서리 위'·'X축 · 면 위'로,
 * 0.19.0 잠근 선 위 교차는 '잠근 X축 · 모서리 위'·'잠근 접선 방향 · 면 위'처럼 — 이름에 잠금이 들어 있어 셋째 값은 false)
 */
export function snapPair(m: { snapA?: SnapKind | null; snapB?: SnapKind | null; axisA?: SnapAxis; axisB?: SnapAxis; lockedB?: boolean; tangentB?: boolean; trackA?: TrackMark | boolean; trackB?: TrackMark | boolean }): [string, string, boolean] | null {
  if (m.snapA === undefined && m.snapB === undefined) return null;
  if (!m.snapA && !m.snapB) return null;
  // 0.19.0 잠근 선 위 교차는 이름이 "잠근 …"이라 셋째 값(잠금 표시)을 끈다. 원호 접선으로 잠근 선이면 '잠근 접선 방향 · 모서리 위'
  const meet = lockMeet(m.trackB);
  const b = m.tangentB && m.lockedB ? (meet ? lockMeetLabel(TANGENT_LABEL, m.trackB as LockMeet) : TANGENT_LABEL) : snapLabel(m.snapB, m.axisB, m.trackB);
  return [snapLabel(m.snapA, m.axisA, m.trackA), b, !!m.lockedB && !meet];
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
 * 손가락은 머무르지 않는다 — 길게 누르기는 정밀 조준(aim.ts)이 쓰므로 따로 주지 않고, 조준 십자선(펜 포인터)을 점 위에 멈추면 마우스처럼 기억한다.
 * 0.18.0 axisEdges: 첫 점 X·Y·Z축이 공구 경로·판재 윤곽·모서리선과 만나는 점(원호·스플라인이면 refine.ts가 곡선 위로 — 'axisEdge').
 * axisFaces: 첫 점 축·끌어온 축이 소재(Heidenhain BLK FORM 공작물·판·포켓·홈·구멍·깎기 시뮬레이션 소재) 그물 면을 뚫는 점
 * (판재 구멍 벽·둥근 포켓 벽·판 외곽선 둥근 모서리 같은 원기둥 벽은 refine.ts가 원기둥 위로 — refineFace 'axisFace', 그 밖의 곡면은 나눈 삼각형 위 점).
 * 0.19.0 lockEdges·lockFaces: 잠근 동안(Shift·화살표·잠금 단추) 잠근 선이 공구 경로·윤곽선과 만나는 점·소재 면을 뚫는 점(잠근 축이면 같은 다듬기로 곡선·원기둥 위).
 * 0.20.0: 나란함·수직·접선으로 잠근 선도 같은 다듬기로 곡선·원기둥 위, 축·잠근 선이 꺾은선 토막과 만나지 않고 그 활꼴만 지나면(다른 깊이의 원호·나선·스플라인을
 * 뚫는 축 등) 열린 후보로 곡선 위 교차(refine.ts — 새 선택 없이 refine을 준 앱이면 코어가 부른다)
 * 0.21.0 lockTracks: 잠근 동안 잠근 선이 끌어온 점(track — 머문 점)의 X·Y·Z축과 만나는 점, 축으로 잠갔으면 잠근 축 위 끌어온 점과 나란한 자리에도 붙는다
 * (잠근 동안 끌어온 축은 이 선택으로만 온다 — 끄면 22차까지처럼 잠근 선 위 커서 자리).
 * 0.22.0: 축·잠근 선이 원기둥 벽 삼각형을 비켜 가며 원기둥만 뚫는 자리도 refineFace('axisFace', open)로 곡면 위 교차(새 선택 없음).
 * 0.21.0 refineFace 'onFace'(붙잡지 않은 면 위 점 — 커서 광선)와 0.23.0 반투명 판 너머 고르기(throughTranslucent)는 refine.ts의 붙잡기 선택이 켠다
 */
export const MEASURE_INFERENCE = { intersections: true, perpendicular: true, axes: true, parallel: true, lock: true, track: true, axisEdges: true, axisFaces: true, lockEdges: true, lockFaces: true, lockTracks: true } as const;

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
