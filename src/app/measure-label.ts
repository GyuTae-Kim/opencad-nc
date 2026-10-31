/**
 * 3D 보기 위 측정 거리 글상자의 글(32차 — 3D 뷰어 코어 setMeasureFormat, 측정 도구 조각).
 *
 * 코어는 두 점 측정의 미리 보기·결과 글상자를 캔버스에 직접 그린다(기본 "거리 12.345 mm" / "ΔX … ΔY … ΔZ …"). 캔버스 글이라 번역층(i18n.ts —
 * DOM만 옮긴다)이 바꾸지 못해 모든 언어에서 "거리"가 한국어로 남았다. 같은 꼴·같은 수에 이름표만 화면 언어 사전(site/locales)으로 옮긴다.
 * 그림 저장(코어 toBlob)도 같은 글 꼴로 그린다.
 *
 * - 수: 코어 기본과 같은 규칙 — 장면 범위(Scene3d.bounds, 없으면 그물·선분·점 범위) 대각선 d에서 소수 max(0, min(6, 5 − ⌊log10 d⌋))자리(toFixed — 언어와
 *   상관없이 소수점), "-0"은 "0". 한국어 화면은 코어 기본 글과 글자까지 같다(tests/app/measure-label-core.test.ts가 그린 글을 견준다)
 * - 단위: 장면 단위(mm·in·m, 모르면 없음)
 * - 언어: 그릴 때마다 문서 언어(html lang — i18n.ts가 언어를 바꿀 때 먼저 고친다)를 읽는다. 언어를 바꾸면 앱이 이 함수를 다시 넘겨 다시 그리게 한다
 */
import type { MeasureFormat, MeasureResult, Viewer3d } from 'opencad-viewer3d';
import { boxIsEmpty, sceneBounds } from 'opencad-viewer3d/bounds';
import type { Box3, Scene3d } from 'opencad-viewer3d/types';
import { translate } from '../../site/i18n-core.mjs';

/** 장면 단위 → 글상자 단위 글(코어와 같다) */
const UNIT: Record<Scene3d['units'], string> = { mm: 'mm', inch: 'in', m: 'm', unknown: '' };

/** 글상자 수의 소수 자리(코어 규칙): 장면 범위 대각선이 클수록 적게, 0~6자리. 빈 범위면 0자리 */
export function measureDigits(box: Box3): number {
  const d = Math.max(Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 1, 1e-9);
  return Math.max(0, Math.min(6, 5 - Math.floor(Math.log10(d))));
}

/** 소수 digits자리 글("-0.000"은 "0.000") */
export function fixedNum(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
}

/** 측정 글상자 두 줄: 거리(이름표는 tr로 옮긴다)와 축별 길이 */
export function measureLabelLines(m: Pick<MeasureResult, 'distance' | 'dx' | 'dy' | 'dz'> & { units: Scene3d['units'] }, digits: number, tr: (ko: string) => string = (s) => s): string[] {
  const f = (v: number): string => fixedNum(v, digits);
  const u = UNIT[m.units] ?? '';
  return [`${tr('거리')} ${f(m.distance)}${u ? ` ${u}` : ''}`, `ΔX ${f(m.dx)}  ΔY ${f(m.dy)}  ΔZ ${f(m.dz)}`];
}

/** 뷰어가 지금 그리는 장면의 범위(코어와 같은 규칙 — 장면이 준 범위가 먼저) */
function viewBox(s: Scene3d | null | undefined): Box3 {
  if (!s) return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  return s.bounds && !boxIsEmpty(s.bounds) ? s.bounds : sceneBounds(s);
}

/** 코어 setMeasureFormat에 줄 글 꼴: 그릴 때의 장면 범위로 자릿수를, 문서 언어로 이름표를 정한다 */
export function measureLabelFormat(viewer: Pick<Viewer3d, 'scene'>, lang: () => string = () => document.documentElement.lang || 'ko'): MeasureFormat {
  return (m) => {
    const language = lang();
    return measureLabelLines(m, measureDigits(viewBox(viewer.scene)), (ko) => translate(ko, language));
  };
}
