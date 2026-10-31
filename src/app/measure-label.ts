/**
 * 3D 보기 위 측정 거리 글상자의 글(32차 — 3D 뷰어 코어 setMeasureFormat, 측정 도구 조각).
 *
 * 코어는 두 점 측정의 미리 보기·결과 글상자를 캔버스에 직접 그린다(기본 "거리 12.345 mm" / "ΔX … ΔY … ΔZ …"). 캔버스 글이라 번역층(i18n.ts —
 * DOM만 옮긴다)이 바꾸지 못해 모든 언어에서 "거리"가 한국어로 남았다. 같은 꼴·같은 수에 이름표만 화면 언어 사전(site/locales)으로 옮긴다.
 * 그림 저장(코어 toBlob)도 같은 글 꼴로 그린다.
 *
 * 33차(코어 0.31.0 글 꼴의 둘째 인자 MeasureFormatCore): 수·자릿수·"-0"·단위 글을 앱이 다시 세지 않는다(32차에는 코어 규칙을 복제했다).
 * - 내장 두 점 측정(c.source 'measure'): 첫 줄은 이름표 번역 + 코어 수 꼴(c.num — 장면 범위로 정한 소수 자리, "-0"은 "0") + 코어 단위 글(c.unit — 모르면 없음),
 *   둘째 줄부터(ΔX·ΔY·ΔZ)는 코어 기본 줄(c.lines) 그대로. 한국어 화면은 코어 기본 글과 글자까지 같다(tests/app/measure-label-core.test.ts)
 * - 그 밖의 글상자(글을 주지 않은 거리 덧그림 — 앱은 쓰지 않는다)는 코어 기본 줄 그대로
 * - 언어: 그릴 때마다 문서 언어(html lang — i18n.ts가 언어를 바꿀 때 먼저 고친다)를 읽는다. 언어를 바꾸면 앱이 이 함수를 다시 넘겨 다시 그리게 한다
 */
import type { MeasureFormat } from 'opencad-viewer3d';
import { translate } from '../../site/i18n-core.mjs';

/** 코어 setMeasureFormat에 줄 글 꼴: 문서 언어로 이름표만 옮기고 수·단위·축별 줄은 코어 것 그대로 */
export function measureLabelFormat(lang: () => string = () => document.documentElement.lang || 'ko'): MeasureFormat {
  return (m, c) => (c.source === 'measure' ? [`${translate('거리', lang())} ${c.num(m.distance)}${c.unit ? ` ${c.unit}` : ''}`, ...c.lines.slice(1)] : c.lines);
}
