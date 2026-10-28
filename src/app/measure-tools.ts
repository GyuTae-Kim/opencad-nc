/**
 * 측정 도구 조각의 입구(문서를 열 때 core.ts loadMeasureTools가 import()로 받는다 — 첫 화면 JS에서 뺀 측정 코드를 한 조각으로 묶는다).
 *
 * - measure-lock.ts: 방향 잠금(Shift·화살표·잠금 단추)·붙잡기 툴팁
 * - snap.ts: 붙잡기 점(원호 중심·이동 가운데 점·보정 경로·판재 윤곽)
 * - aim.ts: 터치 길게 누르기 정밀 조준
 * - tangent.ts: 원호(G2/G3·판재 윤곽 호) 끝·가운데 점·원호 위 아무 점의 접선 잠금
 *
 * 앱이 받기 전에도 쓰는 글(안내·잠금 이름·붙잡은 종류 이름)은 measure.ts(첫 화면)에 있다. 이 모듈들은 첫 화면 모듈에서 값으로 가져오지 않는다
 * (tests/app/core-split.test.ts가 본다).
 */
export { MeasureLock } from './measure-lock';
export { arcCenters, moveSnapPoints, panelCenters, panelSnapPoints } from './snap';
export { TouchAim } from './aim';
export { ArcTangents } from './tangent';
