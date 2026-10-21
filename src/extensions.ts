/**
 * NC 파일 확장자 목록(점 없이, 소문자). 해석기를 부르지 않는 화면 코드(열기 상자 accept 등)도 가져다 쓰도록
 * 해석기 모듈과 따로 둔다 — index.ts가 그대로 다시 내보낸다.
 */

/** G-code로 보는 확장자 */
export const GCODE_EXTENSIONS = ['nc', 'ngc', 'gcode', 'gco', 'gc', 'g', 'tap', 'cnc', 'ncc', 'nc1', 'mpf', 'spf', 'eia', 'iso', 'anc', 'din', 'ptp', 'fnc', 'min', 'hnc', 'ncd', 'xpi', 'cut'];
/** Heidenhain 평문 확장자 */
export const HEIDENHAIN_EXTENSIONS = ['h', 'i'];
/** woodWOP 확장자 */
export const MPR_EXTENSIONS = ['mpr'];
/** NC 뷰어가 여는 모든 확장자(점 없이) */
export const NC_EXTENSIONS = [...GCODE_EXTENSIONS, ...HEIDENHAIN_EXTENSIONS, ...MPR_EXTENSIONS];
