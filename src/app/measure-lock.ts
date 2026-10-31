/**
 * 측정 방향 잠금·붙잡기 툴팁(3D 뷰어 코어 0.10.0 추론 잠금·나란함, 0.12.0 모서리 끝 선분 방향 잠금 — SketchUp의 추론 잠금을 따른다).
 * 코어 측정 모드가 상태와 판정을 가지고(setMeasureSnap({ inference: { lock, parallel } })·setMeasureInferenceLock·measureHoverLock),
 * 이 모듈은 앱 쪽 손잡이만 둔다.
 *
 * - 툴팁: 측정 중 커서 아래 붙잡을 점의 종류(끝점·중심·교차점·X축 방향·나란한 방향 …)를 그 점 오른쪽 아래에, 잠갔으면 "잠금"을 덧붙인다.
 *   코어가 그린 거리 글상자(measureLabelRect)와 겹치거나 3D 보기 밖으로 나가면 왼쪽 아래·오른쪽 위·왼쪽 위 차례로 옮긴다(placeTip).
 *   코어는 미리 보기를 그리기(rAF) 때 구하므로 포인터 이동·키 뒤 다음 프레임에 읽는다. 글은 DOM이라 번역층이 옮긴다.
 * - Shift: 코어가 누르는 순간 잠글 방향(measureHoverLock — 방향 추론(축·나란함·수직), 첫 점을 지나는 선분 위의 점 붙잡기면 그 선분 방향:
 *   모서리 끝에서 그 모서리를 따라 다른 끝을 가리킬 때)을 잠그고 떼면 푼다. 앱은 Shift를 누르고 뗄 때 툴팁·상태 줄만 다시 맞춘다.
 *   상태 줄·측정 띠는 잠글 방향이 있을 때만 "Shift로 X축 방향 잠그기"처럼 알리고, 없으면 화살표만 알린다(lockHint).
 * - 화살표(첫 점을 찍은 뒤, 둘째 점 방향을 잡는 동안): → X · ← Y · ↑ Z축, ↓ 지금 방향(없으면 첫 점 뒤 마지막으로 본 방향 — 코어). 같은 키로 푼다.
 * - 측정 띠 잠금 단추(손가락 기기 — 넓은 화면에서는 띠가 숨는다): 방향을 잡는 동안만 보인다. 정밀 조준 중 다른 손가락으로 누르면 click이
 *   오지 않으므로 손가락·펜은 pointerdown에서 받는다. 잠글 방향이 없으면 띠 위에 알림을 띄우고, 잠금이 걸리면(어느 길로든) 그 알림만 거둔다.
 * - 원호 접선(13차): 첫 점이 원호 이동(G2/G3, 나선 포함)의 시작·끝이고 커서 아래 점이 그 원호 위(다른 끝 포함)면 Shift·↓·잠금 단추가
 *   그 끝의 접선 방향으로 잠근다(host.arcTangent — tangent.ts, 코어 setMeasureInferenceLock({ direction, kind: 'parallel' })).
 *   첫 점이 원호의 가운데 점(앱의 원호 가운데 점 붙잡기)이어도 그 점의 접선으로(14차), 원호 위 다른 자리(현 위 — 코어 모서리 붙잡기)면
 *   원호 위 가장 가까운 자리의 접선으로(15차 — 점은 코어 점 그대로). 판재 윤곽의 호도 같다(15차, 붙잡기 표의 호 요소).
 *   반경 보정 경로(공구 중심)의 호도 같다(19차, 워커가 보낸 보정 조각의 호 — 첫 점 식별자 nc-comp로 그 이동의 보정 조각).
 *   방향은 첫 점에서 원호를 따라 커서 쪽(잠금은 선이라 결과 방향에만 든다).
 *   첫 점이 놓인 원호는 코어 0.16.0이 찍은 점에 싣는 선분 식별자(measurePoints[0].segment·other)로 그 이동·윤곽에서 바로 찾고(18차),
 *   식별자가 없는 점(앱의 가운데 점·중심)이나 이동이 바뀌는 꼭짓점은 예전처럼 좌표로 찾는다(tangent.ts ArcTangents).
 *   코어는 원호를 나눈 현을 선분으로 보므로 첫 현의 끝을 가리키면 그 현 방향으로 잠그려 한다 — 커서 아래 점이 원호 위면 접선이 먼저다.
 *   커서 아래가 방향 추론(축·나란함·수직 발 — 툴팁이 그 이름)이면 코어 판정 그대로다. 잠글 것을 지금 못 보면(커서가 떠남) 코어처럼
 *   첫 점 뒤 마지막으로 본 방향 — 그것이 접선이었으면 접선. Shift는 앱 onKey가 코어보다 먼저 shiftDown을 불러 잠그고(코어는 잠금이 있으면
 *   Shift를 넘긴다) 떼면 shiftUp이 푼다(코어는 제가 잠근 Shift만 푼다). 툴팁·안내·결과는 "접선 방향"이라 적는다.
 * 둘째 점을 찍거나 측정을 지우거나 측정을 끄면 코어가 잠금을 푼다.
 * - 코어 거리 글상자 비키기(코어 0.13.0 setMeasureLabelAvoid): 툴팁이 먼저 서려는 자리(placeTip의 첫 자리 — 점 오른쪽 아래, 코어 글상자와
 *   상관없이 정해진다)를 캔버스 기준으로 넘겨 코어 글상자가 먼저 비키게 하고, 그래도 겹치면 placeTip이 예전처럼 툴팁을 옮긴다(둘이 서로 쫓지 않는다).
 *   휴대폰 정밀 조준 중에는 십자선(커서 둘레 반지름)과 손가락 자리도 넘긴다(setAim — 십자선을 옮기는 같은 처리 안에서, 같은 프레임에).
 *   23차: 측정 중에는 3D 보기 위에 떠서 캔버스 덧그림을 가리는 것(코어 뷰 큐브, 측정 띠·해석 판단 띠·재생 띠 — host.overlays)의 자리도 넘긴다(coverRects).
 *   25차: 뷰 큐브 자리는 DOM에서 찾지 않고 코어 0.23.0 viewCubeRect로 읽는다.
 *   휴대폰은 거리 글상자가 화면 폭의 절반을 넘어 두 점이 오른쪽 위면 뷰 큐브 밑에, 아래면 측정 띠 밑에 그려졌다. 코어는 기본 자리가 넘긴 자리와
 *   겹칠 때만 옮기므로 겹치지 않는 측정의 글상자 자리는 그대로다. 측정을 끄거나 툴팁을 숨기고 조준도 하지 않으며 떠 있는 것도 없으면 null.
 * - 24차: 측정 띠의 끌어온 점 단추(measure-track.ts)는 이 모듈의 띠 위 알림(showFlash)을 함께 쓰고, 끌어온 점 수가 바뀌면(머무르기로 기억함)
 *   host.changed로 알린다.
 */
import type { MeasureHoverSnap, MeasureLabelAvoid, MeasureLabelRect, Viewer3d } from 'opencad-viewer3d';
import { AIM_FINGER_PX, AIM_RETICLE_RADIUS } from './aim';
import { h, toast } from './dom';
import { icon } from './icons';
import { NO_LOCK_MOUSE, NO_LOCK_TOUCH, TANGENT_LABEL, TRACK_PARALLEL_LABEL, TRACK_PERPENDICULAR_LABEL, lockMeet, lockMeetLabel, lockName, snapLabel, trackMark, type LockName } from './measure';
import type { FirstPoint } from './tangent';

type V3 = [number, number, number];

/** 이 모듈이 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type LockViewer = Pick<
  Viewer3d,
  | 'canvas'
  | 'measureMode'
  | 'measurePointCount'
  | 'measurePoints'
  | 'measureHoverSnap'
  | 'measureHoverLock'
  | 'measureInferenceLock'
  | 'measureLabelRect'
  | 'measureTrackPoints'
  | 'setMeasureInferenceLock'
  | 'setMeasureLabelAvoid'
  | 'project'
  | 'viewCubeRect'
>;

export interface MeasureLockHost {
  viewer(): LockViewer | null;
  /** 손가락이 주인 기기인지(알림 글) */
  touch(): boolean;
  /** 툴팁을 붙일 층(3D 보기) */
  layer: HTMLElement;
  /**
   * 잠금·찍은 점 수·Shift로 잠글 방향·끌어온 점 수가 바뀌었다(상태 줄·측정 띠 다시 그리기 — 끌어온 점은 코어 머무르기가 타이머로 기억하므로
   * 그 뒤 포인터 이동에서 알아챈다. 정밀 조준 십자선을 멈춰 기억한 점도 측정 띠의 끌어온 점 단추 수에 들어가게)
   */
  changed(): void;
  /**
   * 첫 측정 점(코어 measurePoints[0] — 0.16.0부터 그 점이 놓인 선분 식별자 segment·other)이 원호(G2/G3 이동·판재 윤곽 호)의
   * 시작·끝·가운데 점이나 그 밖의 원호 위 자리이고 커서 아래 점 p가 그 원호 위면 그 자리의 단위 접선(tangent.ts ArcTangents — 식별자가 있으면
   * 그 이동·윤곽만, 없으면 좌표로), 아니면 null. 원호를 모르는 문서·시험은 두지 않아도 된다
   */
  arcTangent?(first: FirstPoint, p: V3): V3 | null;
  /** 첫 점의 곡선을 찾은 길(자동 확인용 — ArcTangents.by) */
  tangentBy?(): string | null;
  /**
   * 3D 보기 위에 떠서 코어 거리 글상자를 가리는 앱 요소(측정 띠·해석 판단 띠·재생 띠). 숨었거나 크기가 0이면 뺀다.
   * 코어 뷰 큐브 자리는 코어가 알려 준다(viewCubeRect). 없으면 뷰 큐브만
   */
  overlays?(): readonly Element[];
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * 캔버스 위에 떠 있는 요소 자리(화면 좌표 getBoundingClientRect)를 코어 거리 글상자가 비킬 캔버스 기준 사각형으로(23차).
 * 바깥쪽으로 정수에 맞추고(왼쪽·위는 내림, 오른쪽·아래는 올림 — 같은 자리면 같은 값이라 코어에 다시 주지 않는다) 캔버스 밖은 잘라 낸다.
 * 크기가 0인 것(숨긴 요소 — display: none)과 캔버스와 겹치지 않는 것은 뺀다
 */
export function coverRects(canvas: Box, boxes: readonly Box[]): MeasureLabelRect[] {
  const out: MeasureLabelRect[] = [];
  for (const b of boxes) {
    if (!(b.width > 0 && b.height > 0)) continue;
    const x0 = Math.max(0, Math.floor(b.left - canvas.left));
    const y0 = Math.max(0, Math.floor(b.top - canvas.top));
    const x1 = Math.min(Math.ceil(canvas.width), Math.ceil(b.left - canvas.left + b.width));
    const y1 = Math.min(Math.ceil(canvas.height), Math.ceil(b.top - canvas.top + b.height));
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return out;
}

/** 방향 추론 붙잡기(첫 점을 지나는 선 위의 점 — 툴팁이 그 이름): 원호 접선보다 코어 판정이 먼저 */
const INFERRED = new Set(['axis', 'parallel', 'perpendicular']);
/** 같은 방향(부호 무시)으로 볼 단위 벡터 내적 */
const SAME_DIR = 1 - 1e-9;
const sameLine = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) >= SAME_DIR;

/** 측정 띠 알림 종류: 잠글 방향이 없음(잠금이 걸리면 거둔다) */
const NO_LOCK = 'no-lock';
/** 툴팁과 점 사이(가로·세로), 3D 보기 가장자리 여백 */
const TIP_GAP = 12;
const TIP_EDGE = 4;

/**
 * 툴팁 글(붙잡은 종류 이름, 잠갔는지). 붙잡지 않은 점·미리 보기가 없으면 null. 다른 점에서 끌어온 축(코어 0.16.0 — trackFrom이 있고
 * 첫 점에서 그 축 방향이 아님)은 '끌어온 점에서 X축', 첫 점 축 위에서 끌어온 점과 나란한 자리(방향이 있음)는 'X축 방향' 그대로.
 * 0.17.0: 끌어온 축이 선분과 만나는 점(segment)은 '끌어온 점에서 X축 · 모서리 위', 끌어온 축끼리의 교차(trackOther)는 '끌어온 X축과 Y축의 교차'.
 * 0.18.0: 축이 면을 뚫는 점(face)은 '끌어온 점에서 X축 · 면 위'·'X축 · 면 위', 첫 점 축이 선분과 만나는 점(trackFrom 없이 segment)은 'X축 · 모서리 위'.
 * 0.19.0: 잠근 선이 선분과 만나는 점·면을 뚫는 점(locked에 segment·face)은 '잠근 X축 · 모서리 위'·'잠근 나란한 방향 · 면 위'.
 * 0.21.0: 잠근 선이 끌어온 점의 축과 만나는 점(locked에 trackOther)은 '잠근 X축 · 끌어온 점에서 Y축', 잠근 축 위 끌어온 점과 나란한 자리(locked에 trackFrom만)는
 * '잠근 Z축 · 끌어온 점과 나란히'(이름에 잠금이 들어 있어 "잠금"을 다시 붙이지 않는다).
 * 31차(코어 0.29.0 trackDirs { meets }): 끌어온 점에서 모서리와 나란한 선·수직인 선이 다른 것과 만나는 점은 '끌어온 점에서 모서리와 나란히 · X축 위'처럼(trackDirName).
 * 32차(코어 0.30.0 meets { guides }): 다른 끌어온 점의 나란한 선·수직인 선과 만나는 점은 '끌어온 점에서 모서리에 수직 · 끌어온 점 나란한 선 위'처럼
 */
export function snapTip(hv: TrackDirPoint | null | undefined): { name: string; locked: boolean } | null {
  if (!hv?.snap) return null;
  return { name: trackDirName(hv) ?? snapLabel(hv.snap, hv.axis, trackMark(hv)), locked: !!hv.locked };
}

/** 붙잡은 점(미리 보기 measureHoverSnap·찍은 점 measurePoints)에서 이름을 가르는 값 */
type TrackDirPoint = Pick<MeasureHoverSnap, 'snap' | 'axis' | 'locked' | 'trackFrom' | 'trackOther' | 'segment' | 'face' | 'direction' | 'trackGuide'>;

/**
 * 끌어온 점에서 모서리와 나란한 선·수직인 선이 만난 것(31차 — 코어 0.29.0 trackDirs { meets }, 코어 README의 가르는 법): 첫 점 축이면 그 축('x'·'y'·'z' — axis·direction),
 * 다른 끌어온 점의 축이면 't' + 축(trackOther), 선분·윤곽선이면 'edge'(segment), 그물 면이면 'face', 첫 점의 나란함이면 'par'(axis 없이 direction — 그 선 위 점에는 direction이 없다).
 * 32차(코어 0.30.0 meets { guides }): 다른 끌어온 점의 나란한 선이면 'gpar', 수직인 선이면 'gperp'(trackGuide — 그 점의 안내 종류).
 * 끌어온 점 안내가 아니거나(trackMark가 'dir'이 아님) 만난 것이 없으면(그 선 위 점) null
 */
export type TrackDirMeet = 'x' | 'y' | 'z' | 'tx' | 'ty' | 'tz' | 'edge' | 'face' | 'par' | 'gpar' | 'gperp';
export function trackDirMeet(p: TrackDirPoint | null | undefined): TrackDirMeet | null {
  if (!p || trackMark(p) !== 'dir') return null;
  if (p.trackGuide) return p.trackGuide.kind === 'parallel' ? 'gpar' : 'gperp';
  return p.axis ?? (p.trackOther ? (`t${p.trackOther.axis}` as const) : p.segment ? 'edge' : p.face ? 'face' : p.direction ? 'par' : null);
}

/** 만난 것의 이름(trackDirName의 ' · ' 뒤, '위' 앞) */
const MEET_AT: Record<TrackDirMeet, string> = {
  x: 'X축',
  y: 'Y축',
  z: 'Z축',
  tx: '끌어온 점 X축',
  ty: '끌어온 점 Y축',
  tz: '끌어온 점 Z축',
  edge: '모서리',
  face: '면',
  par: '나란한 방향',
  gpar: '끌어온 점 나란한 선',
  gperp: '끌어온 점 수직인 선',
};

/**
 * 만나는 점의 이름(툴팁·측정 결과, 31차): 끌어온 점 안내 이름(TRACK_PARALLEL_LABEL·TRACK_PERPENDICULAR_LABEL) 뒤에 만난 것 —
 * '… · X축 위'(첫 점 축), '… · 나란한 방향 위'(첫 점의 나란함), '… · 끌어온 점 Y축 위'(다른 끌어온 점의 축), '… · 모서리 위', '… · 면 위'(사전에 18개).
 * 32차: 두 끌어온 점의 안내 선끼리 만나는 점은 '… · 끌어온 점 나란한 선 위'·'… · 끌어온 점 수직인 선 위'(나란한 두 선은 만나지 않아
 * '끌어온 점에서 모서리와 나란히 · 끌어온 점 나란한 선 위'는 없다 — 사전에 3개).
 * 만나는 점이 아니면 null(30차 이름 그대로)
 */
export function trackDirName(p: TrackDirPoint | null | undefined): string | null {
  const m = trackDirMeet(p);
  if (!m) return null;
  return `${p!.snap === 'parallel' ? TRACK_PARALLEL_LABEL : TRACK_PERPENDICULAR_LABEL} · ${MEET_AT[m]} 위`;
}

/**
 * 측정 결과 두 점의 만나는 점 이름(31차 — app.ts onMeasure가 찍은 점 measurePoints로 붙이고 첫 화면 snapPair가 그 이름을 그대로 쓴다.
 * 코어 결과 MeasureResult에는 만난 것이 없다). 만나는 점이 아닌 점은 빼고, 둘 다 아니면 빈 객체
 */
export function trackDirNames(points: readonly (TrackDirPoint | null | undefined)[]): { nameA?: string; nameB?: string } {
  const a = trackDirName(points[0]);
  const b = trackDirName(points[1]);
  return { ...(a ? { nameA: a } : {}), ...(b ? { nameB: b } : {}) };
}

/**
 * 툴팁 왼쪽 위 자리(층 기준 CSS 화소): 점(px, py) 오른쪽 아래가 먼저이고, 층(width × height) 밖으로 나가거나 피할 상자(코어 거리 글상자 —
 * 같은 층 기준)와 겹치면 왼쪽 아래·오른쪽 위·왼쪽 위 차례로 본다. 층 안이면서 겹치지 않는 곳이 없으면 층 안인 첫 자리.
 * 31차: 넷 모두 층 밖이면(점 양옆 어느 쪽에도 들어가지 않는 넓은 툴팁 — 휴대폰 폭의 긴 이름) 점 아래·위에서 가로만 층 안으로 민 자리(겹치지 않는 것 먼저),
 * 그것도 층 밖이면 오른쪽 아래
 */
export function placeTip(px: number, py: number, w: number, ht: number, layer: { width: number; height: number }, avoid: MeasureLabelRect | null): { x: number; y: number } {
  const right = px + TIP_GAP;
  const left = px - TIP_GAP - w;
  const below = py + TIP_GAP;
  const above = py - TIP_GAP - ht;
  const spots = [
    { x: right, y: below },
    { x: left, y: below },
    { x: right, y: above },
    { x: left, y: above },
  ];
  const inside = (s: { x: number; y: number }): boolean => s.x >= TIP_EDGE && s.y >= TIP_EDGE && s.x + w <= layer.width - TIP_EDGE && s.y + ht <= layer.height - TIP_EDGE;
  const clear = (s: { x: number; y: number }): boolean => !avoid || s.x >= avoid.x + avoid.width || avoid.x >= s.x + w || s.y >= avoid.y + avoid.height || avoid.y >= s.y + ht;
  const x = Math.max(TIP_EDGE, Math.min(right, layer.width - TIP_EDGE - w));
  const slid = [
    { x, y: below },
    { x, y: above },
  ];
  return spots.find((s) => inside(s) && clear(s)) ?? spots.find(inside) ?? slid.find((s) => inside(s) && clear(s)) ?? slid.find(inside) ?? spots[0]!;
}

export class MeasureLock {
  /** 측정 띠의 잠금 단추 */
  readonly button: HTMLButtonElement;
  /** 측정 띠 위 알림 */
  readonly flash: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private raf = 0;
  /** schedule을 부른 횟수(기다리는 동안 또 불렸는지) */
  private want = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flashKind: string | null = null;
  private lastKey = '';
  /** 앱이 원호 접선으로 잠근 방향(코어 잠금이 이것과 같은 방향의 'api' 잠금이면 접선 잠금) */
  private tangent: V3 | null = null;
  /** 접선 잠금을 Shift로 걸었는지(떼면 푼다) */
  private shiftTangent = false;
  /** 첫 점 뒤 마지막으로 본 잠글 것이 원호 접선이었으면 그 방향(코어 방향을 보면 지운다 — 코어의 "마지막으로 본 방향"과 같은 차례) */
  private seenTangent: V3 | null = null;
  /** seenTangent·접선 결과를 맞춘 첫 점(바뀌면 잊는다) */
  private firstKey = '';
  /** 접선 잠금으로 찍은 둘째 점을 결과에서 알아보려고 남기는 방향(다른 잠금·첫 점이 바뀌면 지운다) */
  private resultTangent: V3 | null = null;
  /** 코어 글상자가 비킬 툴팁 첫 자리(캔버스 기준, 툴팁을 숨겼으면 null) */
  private tipAvoid: MeasureLabelRect | null = null;
  /** 코어 글상자가 비킬 손가락 자리(캔버스 기준, 정밀 조준 중이 아니면 null) */
  private aimAvoid: MeasureLabelRect | null = null;
  /** 코어 글상자가 비킬 떠 있는 것(뷰 큐브·띠 — 캔버스 기준, 측정 중일 때만) */
  private coverAvoid: MeasureLabelRect[] = [];
  /** 코어에 마지막으로 준 비킬 자리(같으면 다시 주지 않는다) */
  private avoidKey = 'null';
  /** 툴팁을 붙인 점(캔버스 기준 화면 좌표 — 크기가 바뀌면 다시 놓는다) */
  private tipAt: { x: number; y: number } | null = null;

  constructor(private readonly host: MeasureLockHost) {
    this.tip = h('div', { class: 'snap-tip', 'aria-hidden': 'true', hidden: true });
    host.layer.append(this.tip);
    // 번역층이 툴팁 글을 바꿔 크기가 달라지면 다시 놓는다(같은 프레임 — 그리기 전에 온다). 크기를 알리지 않는 환경(jsdom)은 update의 자리 그대로
    if (typeof ResizeObserver === 'function')
      new ResizeObserver(() => {
        const v = this.host.viewer();
        if (this.tip.hidden || !v) return;
        this.placeTipNow(v);
        this.pushAvoid();
      }).observe(this.tip);
    this.button = h('button', { class: 'mb-btn icon mb-lock', type: 'button', title: '지금 방향 잠그기(다시 누르면 풀기)', 'aria-label': '방향 잠금', 'aria-pressed': 'false', hidden: true, html: icon('lock') });
    let pressedAt = -Infinity;
    this.button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      pressedAt = performance.now();
      this.toggle();
    });
    this.button.addEventListener('click', () => {
      if (performance.now() - pressedAt < 1000) return;
      this.toggle();
    });
    this.flash = h('div', { class: 'measure-flash', role: 'status', hidden: true });
  }

  /** 뷰어가 생긴 뒤 한 번: 캔버스 포인터를 듣는다(코어 듣기 다음 — 거품 단계) */
  attach(canvas: HTMLCanvasElement): void {
    const parent = canvas.parentElement ?? canvas;
    parent.addEventListener('pointermove', () => this.schedule());
    canvas.addEventListener('pointerleave', () => this.schedule());
    parent.addEventListener('pointerup', () => this.schedule());
  }

  /** 지금 잠근 방향(원호 접선으로 잠갔으면 'tangent') */
  get lock(): LockName | null {
    const l = this.host.viewer()?.measureInferenceLock;
    if (l && this.tangentLocked(l)) return 'tangent';
    return lockName(l);
  }

  /** 잠그지 않았을 때 Shift(·잠금 단추)가 지금 잠글 방향(원호 접선, 아니면 코어 measureHoverLock). 방향을 잡는 중이 아니면 null */
  get hoverLock(): LockName | null {
    const v = this.host.viewer();
    if (!v || !this.directing || v.measureInferenceLock) return null;
    if (this.tangentNow()) return 'tangent';
    return lockName(v.measureHoverLock);
  }

  /**
   * 커서 아래에서 잠글 원호 접선: 방향을 잡는 중이고 잠그지 않았으며, 커서 아래 점이 방향 추론(축·나란함·수직 발)이 아니고
   * 첫 점에 닿는 원호 위에 있으면 그 끝의 접선(host.arcTangent). 아니면 null
   */
  tangentNow(): V3 | null {
    const v = this.host.viewer();
    const at = this.host.arcTangent;
    if (!v || !at || !this.directing || v.measureInferenceLock) return null;
    const hv = v.measureHoverSnap;
    if (!hv || (hv.snap && INFERRED.has(hv.snap))) return null;
    const first = v.measurePoints[0];
    return first ? at.call(this.host, first, hv.point) : null;
  }

  /** 코어 잠금이 앱이 건 원호 접선 잠금인지(같은 방향의 'api' 나란함 잠금) */
  private tangentLocked(l: { kind: string; direction: readonly number[]; source?: string }): boolean {
    return !!this.tangent && l.kind === 'parallel' && l.source === 'api' && sameLine(l.direction, this.tangent);
  }

  /** 측정 결과의 둘째 점을 원호 접선 잠금으로 찍었는지(코어 결과는 나란함 — 이름만 접선 방향으로) */
  tangentResult(m: { lockedB?: boolean; snapB?: string | null; directionB?: readonly number[] } | null | undefined): boolean {
    return !!m?.lockedB && m.snapB === 'parallel' && !!m.directionB && !!this.resultTangent && sameLine(m.directionB, this.resultTangent);
  }

  /** 둘째 점의 방향을 잡는 중인지(첫 점을 찍었고 결과가 없음) */
  get directing(): boolean {
    const v = this.host.viewer();
    return !!v && v.measureMode && v.measurePointCount === 1;
  }

  /**
   * 다음 프레임(코어가 미리 보기를 구한 뒤)에 툴팁·잠금 상태를 맞춘다. 포인터 이동은 프레임에 맞춰 rAF 앞에 오므로 기다리는 동안 또 불리면
   * 그 이동의 미리 보기는 아직이다 — 맞춘 뒤 한 번 더 돈다(마지막 이동을 놓치지 않게)
   */
  schedule(): void {
    this.want++;
    if (this.raf) return;
    const w = this.want;
    this.raf = requestAnimationFrame(() => {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.update();
        if (this.want !== w) this.schedule();
      });
    });
  }

  /** 툴팁·잠금 단추·알림을 지금 상태로(잠금·찍은 점 수·Shift로 잠글 방향이 바뀌었으면 앱에 알린다) */
  update(): void {
    const v = this.host.viewer();
    const on = !!v && v.measureMode;
    this.track();
    const hv = on ? v!.measureHoverSnap : null;
    const snap = on ? snapTip(hv) : null;
    // 잠근 선이 모서리·면과 만나는 점(0.19.0)은 이름이 '잠근 X축 · 모서리 위'라 "잠금"을 다시 붙이지 않는다
    const meet = trackMark(hv);
    // 원호 접선으로 잠근 선 위의 점은 코어 종류(나란함) 대신 접선 방향(모서리·면과 만나면 '잠근 접선 방향 · 모서리 위')
    const tan = !!snap && snap.locked && hv?.snap === 'parallel' && !!v!.measureInferenceLock && this.tangentLocked(v!.measureInferenceLock);
    const tip = tan ? { ...snap!, name: lockMeet(meet) ? lockMeetLabel(TANGENT_LABEL, meet) : TANGENT_LABEL } : snap;
    const sp = tip && hv ? v!.project(hv.point) : null;
    if (!tip || !sp || !sp.onScreen) {
      this.tip.hidden = true;
      this.tipAvoid = null;
    } else {
      this.tip.replaceChildren(h('span', {}, tip.name), ...(tip.locked && !lockMeet(meet) ? [' · ', h('b', { class: 'st-lock' }, '잠금')] : []));
      this.tip.classList.toggle('locked', tip.locked);
      this.tip.hidden = false;
      this.tipAt = { x: sp.x, y: sp.y };
      this.placeTipNow(v!);
    }
    this.coverAvoid = on ? this.covers(v!) : [];
    this.pushAvoid();
    const lock = this.lock;
    if (lock) this.dropFlash(NO_LOCK);
    const directing = this.directing;
    this.button.hidden = !directing;
    this.button.setAttribute('aria-pressed', String(!!lock));
    this.button.classList.toggle('on', !!lock);
    this.button.title = lock ? '방향 잠금 풀기' : '지금 방향 잠그기(다시 누르면 풀기)';
    const key = `${on ? v!.measurePointCount : -1}|${lock ?? ''}|${this.hoverLock ?? ''}|${on ? v!.measureTrackPoints.length : 0}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.host.changed();
    }
  }

  /**
   * 툴팁 크기를 재어 점(tipAt — 캔버스 기준) 둘레에 놓고 코어 글상자가 비킬 자리(tipAvoid)를 맞춘다. 툴팁 글을 바꾼 뒤(update)와
   * 크기가 바뀐 뒤(31차 — 번역층이 글을 다른 언어로 바꾸면 길이가 달라지는데, update는 바꾸기 전 한국어 글의 크기로 놓아 휴대폰 폭에서 3D 보기 밖으로 잘렸다)
   */
  private placeTipNow(v: LockViewer): void {
    const sp = this.tipAt;
    if (!sp) return;
    const c = v.canvas.getBoundingClientRect();
    const l = this.host.layer.getBoundingClientRect();
    const ox = c.left - l.left;
    const oy = c.top - l.top;
    const w = this.tip.offsetWidth || 80;
    const ht = this.tip.offsetHeight || 20;
    // 코어 글상자가 비킬 자리: 툴팁의 첫 자리(점 오른쪽 아래 — 캔버스 기준). 코어 글상자와 상관없이 정해지므로 서로 쫓지 않는다
    this.tipAvoid = { x: Math.round(sp.x + TIP_GAP), y: Math.round(sp.y + TIP_GAP), width: Math.round(w), height: Math.round(ht) };
    // 코어 거리 글상자(캔버스 기준 — 지난 그리기)를 층 기준으로
    const r = v.measureLabelRect;
    const avoid = r ? { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height } : null;
    const at = placeTip(ox + sp.x, oy + sp.y, w, ht, l, avoid);
    this.tip.style.left = `${Math.round(at.x)}px`;
    this.tip.style.top = `${Math.round(at.y)}px`;
  }

  /** 잠금 단추: 잠겼으면 풀고, 아니면 지금 방향(원호 접선이나 코어 — Shift와 같은 판정, 없으면 첫 점 뒤 마지막으로 본 방향)을 잠근다 — 잠글 것이 없으면 맞추는 법을 알린다 */
  toggle(): boolean {
    const v = this.host.viewer();
    if (!v || !this.directing) return false;
    let ok = true;
    if (v.measureInferenceLock) this.unlock();
    else if (!this.lockNow()) {
      ok = false;
      this.noLock();
    }
    this.after();
    return ok;
  }

  /** 화살표: 축(→ X · ← Y · ↑ Z)이나 지금 방향(↓, axis = null). 같은 것으로 이미 잠겼으면 푼다 */
  arrow(axis: 'x' | 'y' | 'z' | null): void {
    const v = this.host.viewer();
    if (!v || !this.directing) return;
    const cur = v.measureInferenceLock;
    if (axis) {
      if (cur?.kind === 'axis' && cur.axis === axis) this.unlock();
      else {
        this.forgetTangent();
        v.setMeasureInferenceLock(axis);
      }
    } else if (cur) this.unlock();
    else if (!this.lockNow()) this.noLock();
    this.after();
  }

  /**
   * Shift 누름(앱 onKey가 코어에 넘기기 전에 — 코어는 잠금이 있으면 Shift를 넘긴다): 커서 아래가 원호 위면 그 접선으로 잠근다.
   * 아니면 아무것도 하지 않는다(코어가 제 판정으로 잠근다)
   */
  shiftDown(): void {
    const t = this.tangentNow();
    if (!t || !this.lockTangent(t)) return;
    this.shiftTangent = true;
    this.after();
  }

  /** Shift 뗌·창 흐려짐: Shift로 건 접선 잠금이면 푼다(둘째 점을 찍어 코어가 이미 풀었으면 그대로) */
  shiftUp(): void {
    if (!this.shiftTangent) return;
    this.shiftTangent = false;
    const v = this.host.viewer();
    const l = v?.measureInferenceLock;
    if (v && l && this.tangentLocked(l)) {
      v.setMeasureInferenceLock(false);
      this.forgetTangent();
    }
    this.after();
  }

  /** 지금 방향 잠그기: 커서 아래 원호 접선, 코어가 볼 방향, 지금 볼 것이 없으면 마지막으로 본 것(접선이었으면 접선, 아니면 코어) */
  private lockNow(): boolean {
    const v = this.host.viewer();
    if (!v) return false;
    const t = this.tangentNow() ?? (v.measureHoverLock ? null : this.seenTangent);
    if (t) return this.lockTangent(t);
    this.forgetTangent();
    return v.setMeasureInferenceLock(true);
  }

  /** 원호 접선으로 잠근다(코어 나란함 잠금 — 축과 나란해도 접선 이름으로) */
  private lockTangent(t: V3): boolean {
    const v = this.host.viewer();
    if (!v || !v.setMeasureInferenceLock({ direction: t, kind: 'parallel' })) return false;
    this.tangent = [...t];
    this.resultTangent = [...t];
    return true;
  }

  private unlock(): void {
    this.host.viewer()?.setMeasureInferenceLock(false);
    this.forgetTangent();
  }

  /** 접선 잠금 기록을 지운다(다른 잠금으로 바꾸거나 풀었다) */
  private forgetTangent(): void {
    this.tangent = null;
    this.resultTangent = null;
    this.shiftTangent = false;
  }

  /**
   * 첫 점 뒤 마지막으로 본 잠글 것(코어 lastLockable과 같은 차례 — 원호 접선을 보면 그것, 코어 방향을 보면 코어)과 첫 점이 바뀌었는지.
   * 새 첫 점(다시 재기·둘째 점 뒤 새로)이면 접선 기록을 잊는다(결과를 보이는 동안은 남긴다)
   */
  private track(): void {
    const v = this.host.viewer();
    const pts = (v && v.measureMode ? v.measurePoints : null) ?? [];
    const key = pts.length ? pts[0]!.point.join(',') : '';
    if (key !== this.firstKey) {
      this.firstKey = key;
      this.seenTangent = null;
      if (pts.length === 1) this.forgetTangent();
    }
    if (!v || !this.directing || v.measureInferenceLock) return;
    const t = this.tangentNow();
    if (t) this.seenTangent = t;
    else if (v.measureHoverLock) this.seenTangent = null;
  }

  /** 측정을 끄거나 문서를 바꿨다: 툴팁·알림·접선 기록·코어 글상자가 비킬 자리를 거둔다 */
  reset(): void {
    this.tip.hidden = true;
    this.tipAvoid = null;
    this.aimAvoid = null;
    this.coverAvoid = [];
    this.pushAvoid();
    this.dropFlash(null);
    this.forgetTangent();
    this.seenTangent = null;
    this.firstKey = '';
    this.schedule();
  }

  /**
   * 정밀 조준 십자선을 옮겼다(손가락 자리 — 화면 좌표, 조준을 마치면 null — aim.ts onMove). 십자선을 옮기는 같은 처리 안에서 코어에
   * 십자선(커서 둘레 반지름)과 손가락 둘레 사각형을 넘겨 코어 거리 글상자가 같은 프레임에 비키게 한다
   */
  setAim(finger: { x: number; y: number } | null): void {
    const v = this.host.viewer();
    if (!finger || !v) this.aimAvoid = null;
    else {
      const c = v.canvas.getBoundingClientRect();
      const half = AIM_FINGER_PX / 2;
      this.aimAvoid = { x: Math.round(finger.x - c.left - half), y: Math.round(finger.y - c.top - half), width: AIM_FINGER_PX, height: AIM_FINGER_PX };
    }
    this.pushAvoid();
  }

  /**
   * 측정 중 캔버스 위에 떠 있는 것(코어 뷰 큐브, host.overlays — 측정 띠·해석 판단 띠·재생 띠)의 캔버스 기준 자리(coverRects).
   * 뷰 큐브는 25차부터 코어가 알려 주는 자리(0.23.0 viewCubeRect — 이미 캔버스 기준, 감췄으면 null)를 쓴다. 앱은 CSS로 큐브를 옮기지 않는다
   */
  private covers(v: LockViewer): MeasureLabelRect[] {
    const els: Element[] = [];
    for (const e of this.host.overlays?.() ?? []) if (!(e as HTMLElement).hidden) els.push(e);
    const cube = v.viewCubeRect;
    if (!cube && !els.length) return [];
    const c = v.canvas.getBoundingClientRect();
    const out = cube ? coverRects({ left: 0, top: 0, width: c.width, height: c.height }, [{ left: cube.x, top: cube.y, width: cube.width, height: cube.height }]) : [];
    return els.length ? [...out, ...coverRects(c, els.map((e) => e.getBoundingClientRect()))] : out;
  }

  /** 코어 글상자가 비킬 자리(손가락·툴팁 첫 자리·떠 있는 것, 조준 중이면 커서 둘레)를 코어에 준다 — 바뀌었을 때만, 모두 없으면 null */
  private pushAvoid(): void {
    const v = this.host.viewer();
    if (!v) return;
    const rects = [this.aimAvoid, this.tipAvoid, ...this.coverAvoid].filter((r): r is MeasureLabelRect => !!r);
    const avoid: MeasureLabelAvoid | null = rects.length || this.aimAvoid ? { rects, ...(this.aimAvoid ? { pointerRadius: AIM_RETICLE_RADIUS } : {}) } : null;
    const key = JSON.stringify(avoid);
    if (key === this.avoidKey) return;
    this.avoidKey = key;
    v.setMeasureLabelAvoid(avoid);
  }

  /** 자동 확인용: 코어에 준 비킬 자리 */
  get labelAvoid(): MeasureLabelAvoid | null {
    return JSON.parse(this.avoidKey) as MeasureLabelAvoid | null;
  }

  private after(): void {
    this.update();
    this.schedule();
  }

  /** 잠글 방향이 없다는 알림: 측정 띠가 보이면 띠 위에, 아니면(넓은 화면 키보드) 알림 상자로 */
  private noLock(): void {
    const touch = this.host.touch();
    const text = touch ? NO_LOCK_TOUCH : NO_LOCK_MOUSE;
    const bar = this.flash.parentElement;
    if (bar && !bar.hidden && getComputedStyle(bar).display !== 'none') this.showFlash(text, 3200, NO_LOCK);
    else toast(text, 'info', 3200);
  }

  /** 측정 띠 위 알림(kind를 붙이면 그 종류로 거둘 수 있다) */
  showFlash(text: string, ms = 1600, kind: string | null = null): void {
    this.flash.textContent = text;
    this.flash.hidden = false;
    this.flashKind = kind;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.dropFlash(null), ms);
  }

  /** 알림 거두기(kind를 주면 그 종류일 때만) */
  dropFlash(kind: string | null): void {
    if (this.flash.hidden || (kind !== null && this.flashKind !== kind)) return;
    this.flash.hidden = true;
    this.flashKind = null;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  /** 자동 확인용: 툴팁 글(숨었으면 null)·자리, 알림, 잠금, Shift로 잠글 방향, 단추, 첫 점 곡선을 찾은 길(식별자·좌표) */
  snapshot(): { tip: string | null; flash: string | null; lock: LockName | null; hoverLock: LockName | null; button: boolean; tipRect: { x: number; y: number } | null; tangentBy: string | null } {
    const hidden = this.tip.hidden;
    return {
      tip: hidden ? null : this.tip.textContent,
      flash: this.flash.hidden ? null : this.flash.textContent,
      lock: this.lock,
      hoverLock: this.hoverLock,
      button: !this.button.hidden,
      tipRect: hidden ? null : { x: parseFloat(this.tip.style.left), y: parseFloat(this.tip.style.top) },
      tangentBy: this.host.tangentBy?.() ?? null,
    };
  }
}
