/**
 * 기계·읽기 설정(앱 전체, localStorage에 기억): 급속 속도·공구 교환 시간·블록 건너뛰기·H/D 번호 확인·도그레그 급속,
 * 작업 원점(G54)의 기계 좌표·G28 기준점·축별 허용 범위, 공구 표시를 실제 크기로. 길이는 모두 mm(inch 프로그램은 해석기가 바꿔 쓴다).
 * 저장소를 못 쓰면(사생활 보호 창 등) 기본값으로 동작하고 이번 창에서만 기억한다.
 */
import type { NcMachineOptions } from '../model';
import type { NcOpenOptions } from './protocol';

export type Xyz = [number | null, number | null, number | null];

export interface NcSettings {
  /** 급속 속도(mm/분, null = 기본 10000 mm/분 · 400 inch/분) */
  rapidFeedMm: number | null;
  /** 공구 교환 한 번에 걸리는 시간(초, null = 0) */
  toolChangeSec: number | null;
  /** '/' 블록 건너뛰기 스위치 켬(그 블록을 실행하지 않음) */
  blockDelete: boolean;
  /** H·D 번호가 공구 번호와 다르면 경고 */
  checkToolNumbers: boolean;
  /** 여러 축 급속을 도그레그(축마다 같은 속도로 함께 가다 짧은 축부터 멈춤)로 그리고 시간 계산 */
  dogleg: boolean;
  /** 첫 작업 좌표계(G54) 원점의 기계 좌표(mm). 세 축 모두 있어야 쓴다 */
  offsetMm: Xyz;
  /** G28 기준점의 기계 좌표(mm, 기계 좌표를 쓸 때. 빈 축은 0) */
  referenceMm: Xyz;
  /** 축별 허용 범위(작업 좌표 mm, 빈 칸 = 제한 없음) */
  limitMin: Xyz;
  limitMax: Xyz;
  /** 재생 중 공구 표시를 실제 공구 지름 크기로(지름을 모르면 화면 크기) */
  toolSize: boolean;
}

export const SETTINGS_KEY = 'opencad-nc.settings';

export function defaultSettings(): NcSettings {
  return {
    rapidFeedMm: null,
    toolChangeSec: null,
    blockDelete: false,
    checkToolNumbers: true,
    dogleg: false,
    offsetMm: [null, null, null],
    referenceMm: [null, null, null],
    limitMin: [null, null, null],
    limitMax: [null, null, null],
    toolSize: false,
  };
}

const num = (v: unknown, positive = false): number | null => (typeof v === 'number' && Number.isFinite(v) && (!positive || v > 0) ? v : null);
const xyz = (v: unknown): Xyz => (Array.isArray(v) ? ([0, 1, 2].map((i) => num(v[i])) as Xyz) : [null, null, null]);

/** 저장된 글 → 설정(모르는 값·깨진 글은 기본값으로) */
export function parseSettings(text: string | null): NcSettings {
  const d = defaultSettings();
  if (!text) return d;
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object') return d;
    o = v as Record<string, unknown>;
  } catch {
    return d;
  }
  return {
    rapidFeedMm: num(o.rapidFeedMm, true),
    toolChangeSec: num(o.toolChangeSec, true),
    blockDelete: o.blockDelete === true,
    checkToolNumbers: o.checkToolNumbers !== false,
    dogleg: o.dogleg === true,
    offsetMm: xyz(o.offsetMm),
    referenceMm: xyz(o.referenceMm),
    limitMin: xyz(o.limitMin),
    limitMax: xyz(o.limitMax),
    toolSize: o.toolSize === true,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): NcSettings {
  try {
    return parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: NcSettings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 저장소를 못 쓰는 환경: 이번 창에서만 */
  }
}

const full = (v: Xyz): [number, number, number] | undefined => (v.every((x) => x !== null) ? (v as [number, number, number]) : undefined);

/** 설정 → 해석 옵션(파일을 열고 다시 읽을 때 화면 고르기에 덧붙인다) */
export function settingsOpenOptions(s: NcSettings): Pick<NcOpenOptions, 'blockDelete' | 'checkToolNumbers' | 'machine'> {
  const m: NcMachineOptions = {};
  if (s.rapidFeedMm) m.rapidFeedMm = s.rapidFeedMm;
  if (s.toolChangeSec) m.toolChangeSec = s.toolChangeSec;
  if (s.dogleg) m.dogleg = true;
  const off = full(s.offsetMm);
  if (off) {
    m.offsetMm = off;
    m.referenceMm = [s.referenceMm[0] ?? 0, s.referenceMm[1] ?? 0, s.referenceMm[2] ?? 0];
  }
  if ([...s.limitMin, ...s.limitMax].some((v) => v !== null)) m.limitsMm = { min: [...s.limitMin], max: [...s.limitMax] };
  return {
    ...(s.blockDelete ? { blockDelete: true } : {}),
    ...(s.checkToolNumbers ? {} : { checkToolNumbers: false }),
    ...(Object.keys(m).length ? { machine: m } : {}),
  };
}

/** 다시 읽어야 하는 바뀜인지: 해석 옵션이 달라질 때만(공구 표시 크기, 세 축을 다 채우지 않은 기계 좌표 등은 아님) */
export function settingsNeedReparse(a: NcSettings, b: NcSettings): boolean {
  return JSON.stringify(settingsOpenOptions(a)) !== JSON.stringify(settingsOpenOptions(b));
}
