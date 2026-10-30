/**
 * 끌어온 점 바로 고르기 단추(24차 — 3D 뷰어 코어 0.16.0 setMeasureTrackPoints, 측정 도구 조각).
 *
 * 코어는 마우스·펜 커서가 점 붙잡기 위에서 2화소(TRACK_DWELL_PX) 안에 0.5초(TRACK_DWELL_MS) 머물러야 그 점을 끌어온 점으로 기억한다.
 * 휴대폰 정밀 조준 십자선(aim.ts — 코어에는 펜 포인터)도 같아서, 손가락이 떨리면 십자선이 2화소 안에 0.5초 머물기 어렵다.
 * 코어 README는 터치에 머무르기를 두지 않고 "앱이 길게 누르기·단추로 고른 점을 setMeasureTrackPoints로 준다"고 한다 —
 * 길게 누르기는 정밀 조준이 쓰므로 단추로 준다.
 *
 * - 자리: 측정 띠(좁은 화면·손가락 기기에서만 보이는 3D 보기 아래 가운데 띠 — 한 손 엄지가 닿는 아래쪽)의 잠금 단추 옆.
 *   잠금 단추처럼 정밀 조준 중 다른 손가락으로 누르면 click이 오지 않으므로 손가락·펜은 pointerdown에서 받는다.
 *   넓은 화면(마우스)은 측정 띠가 숨으므로 이 단추도 보이지 않고 머무르기 그대로다.
 * - 정밀 조준 중이거나 기억한 점이 있을 때만 보인다. 손가락은 커서가 없어 조준하지 않으면 붙잡은 점이 없으므로(누를 일이 없다) 평소 측정 띠는
 *   예전과 같고(휴대폰 폭에서 안내 글 칸이 좁아지지 않게), 길게 눌러 조준하면 나타나 다른 손가락으로 누른다. 기억한 점이 있으면 수를 보이려고 남는다.
 *   첫 점 전에도 끌어온 축·축끼리의 교차에 붙고, 결과를 보는 동안 기억한 점은 다음 측정의 첫 점까지 남는다(코어).
 * - 누르면 지금 미리 보기(measureHoverSnap)가 점 붙잡기(꼭짓점·끝점·가운데 점·중심·앱 점·교차점·수직 발, 잠근 선 위가 아님 —
 *   코어 머무르기가 기억하는 점과 같다)일 때 그 점을 가장 앞에 더해 준다(최근 셋까지, 같은 점은 앞으로 — 코어 MeasureTracker).
 *   십자선을 멈추지 않아도 된다. 점 붙잡기가 없으면(조준하지 않음·축 위·빈 곳) 띠 위에 맞추는 법을 알린다.
 * - 단추에 기억한 점 수(1~3)를 적는다. 지우기는 측정 띠의 "다시 재기"(코어 clearMeasure가 끌어온 점도 지운다).
 */
import type { MeasureHoverSnap, Viewer3d } from 'opencad-viewer3d';
import { h } from './dom';

type V3 = [number, number, number];

/** 이 모듈이 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type TrackViewer = Pick<Viewer3d, 'measureMode' | 'measureHoverSnap' | 'measureTrackPoints' | 'setMeasureTrackPoints'>;

export interface TrackPickHost {
  viewer(): TrackViewer | null;
  /** 손가락이 주인 기기인지(알림 글) */
  touch(): boolean;
  /** 정밀 조준 중인지(aim.ts TouchAim.aiming — 이때 단추를 보인다) */
  aiming(): boolean;
  /** 측정 띠 위 알림(measure-lock.ts showFlash — kind로 같은 종류를 거둔다) */
  flash(text: string, ms: number, kind: string): void;
  /** 끌어온 점을 바꿨다(측정 띠·상태 줄 다시 그리기) */
  changed(): void;
}

/** 단추 이름(화면 읽기)과 풀이(마우스를 올리면) */
export const TRACK_LABEL = '끌어온 점 기억';
export const TRACK_TITLE = '지금 붙잡은 점을 끌어온 점으로 기억(그 점의 X·Y·Z축에도 붙습니다)';
/** 기억했을 때 띠 위 알림 */
export const TRACKED = '끌어온 점으로 기억했습니다: 그 점의 X·Y·Z축에도 붙습니다';
/** 기억할 점이 없을 때(손가락 기기·마우스) */
export const NO_TRACK_TOUCH = '기억할 점이 없습니다: 길게 눌러 조준하며 끝점·중심 같은 점에 맞춘 뒤 누르세요';
export const NO_TRACK_MOUSE = '기억할 점이 없습니다: 커서를 끝점·중심 같은 점 위에 0.5초 멈추면 기억합니다';

/** 띠 위 알림 종류(같은 종류는 새 알림이 덮는다) */
const FLASH_KIND = 'track';

/** 단추 그림: 점(+)과 그 점에서 뻗는 축 점선(코어가 기억한 점을 작은 +와 축 점선으로 그린다) */
const ICON =
  '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false">' +
  '<path d="M7 3.5v7M3.5 7h7"/><path d="M10.5 13h6.5M7 10.5v6.5" stroke-dasharray="1.4 2"/></svg>';

/**
 * 끌어올 수 있는 점(코어 머무르기와 같은 판정 — 꼭짓점·끝점·가운데 점·중심·앱 점·교차점·수직 발이고 잠근 선 위 점이 아님): 그 점의 복사본, 아니면 null.
 * 축 위 점(첫 점 축·끌어온 축 — 축과 모서리·면이 만나는 점도 'axis')·나란한 방향·붙잡지 않은 점은 끌어오지 않는다.
 * 30차(코어 0.27.0 trackDirs): 끌어온 점에서 모서리에 수직인 선 위 점('perpendicular'에 trackFrom)도 선 위 점이라 끌어오지 않는다(코어 머무르기와 같다 —
 * 끌어온 점이 실린 것은 모두 선 위 점)
 */
export function trackPointOf(hv: Pick<MeasureHoverSnap, 'point' | 'snap' | 'locked' | 'trackFrom'> | null | undefined): V3 | null {
  if (!hv || hv.locked || !hv.snap || hv.snap === 'axis' || hv.snap === 'parallel' || hv.trackFrom) return null;
  const [x, y, z] = hv.point;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x!, y!, z!] : null;
}

export class TrackPick {
  /** 측정 띠의 끌어온 점 단추 */
  readonly button: HTMLButtonElement;
  /** 기억한 점 수 */
  private readonly badge: HTMLSpanElement;

  constructor(private readonly host: TrackPickHost) {
    this.badge = h('span', { class: 'mb-badge', 'aria-hidden': 'true', hidden: true });
    this.button = h('button', { class: 'mb-btn icon mb-track', type: 'button', title: TRACK_TITLE, 'aria-label': TRACK_LABEL, hidden: true, html: ICON }, this.badge);
    let pressedAt = -Infinity;
    // 정밀 조준 중 다른 손가락으로 누르면 click이 오지 않는다(잠금 단추와 같다) — 손가락·펜은 누르는 순간에
    this.button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      pressedAt = performance.now();
      this.pick();
    });
    this.button.addEventListener('click', () => {
      if (performance.now() - pressedAt < 1000) return;
      this.pick();
    });
  }

  /** 지금 붙잡은 점을 끌어온 점으로 기억한다(기억했으면 true). 점 붙잡기가 없으면 맞추는 법을 알린다 */
  pick(): boolean {
    const v = this.host.viewer();
    if (!v || !v.measureMode) return false;
    const p = trackPointOf(v.measureHoverSnap);
    if (!p) {
      this.host.flash(this.host.touch() ? NO_TRACK_TOUCH : NO_TRACK_MOUSE, 3200, FLASH_KIND);
      return false;
    }
    // 코어가 셋까지 두고 같은 점은 앞으로 옮긴다. 끌어온 축을 끈 뷰어면 0
    if (!v.setMeasureTrackPoints([p, ...v.measureTrackPoints])) return false;
    this.host.flash(TRACKED, 2400, FLASH_KIND);
    this.update();
    this.host.changed();
    return true;
  }

  /** 단추를 보일지(측정 중 정밀 조준하거나 기억한 점이 있을 때)와 기억한 점 수(측정 띠를 다시 그릴 때·조준을 시작하고 마칠 때) */
  update(): void {
    const v = this.host.viewer();
    const on = !!v && v.measureMode;
    const n = on ? v!.measureTrackPoints.length : 0;
    this.button.hidden = !(on && (n > 0 || this.host.aiming()));
    this.badge.hidden = !n;
    this.badge.textContent = n ? String(n) : '';
    this.button.classList.toggle('on', n > 0);
  }

  /** 자동 확인용: 기억한 점 수(단추에 적힌 것) */
  get count(): number {
    return Number(this.badge.textContent) || 0;
  }
}
