/**
 * 측정 안내·결과 글(순수 함수, DOM 없음): 측정 띠(휴대폰·터치, 3D 보기 아래 가운데)·패널 아래 띠·상태 막대가 함께 쓴다.
 * touch(손가락이 주인 기기)면 안내에서 키(Esc) 설명을 빼고 길게 누르기(정밀 조준, aim.ts)를 알린다.
 * 키 설명이 있는 원래 글(넓은 화면·마우스)은 그대로 둔다.
 */
import type { MeasureResult } from 'opencad-viewer3d';
import { fmtNum } from './format';

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
