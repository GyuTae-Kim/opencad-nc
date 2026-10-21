import { describe, expect, it } from 'vitest';
import { toolMarker, toolShape } from '../../src/app/doc';
import { parseForView, parseOptions } from '../../src/app/payload';
import type { NcPayload } from '../../src/app/protocol';
import { defaultSettings, parseSettings, settingsNeedReparse, settingsOpenOptions } from '../../src/app/settings';

describe('기계·읽기 설정', () => {
  it('저장된 글을 읽고 모르는 값·깨진 글은 기본값으로', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('{oops')).toEqual(defaultSettings());
    const s = parseSettings(JSON.stringify({ rapidFeedMm: 8000, toolChangeSec: -1, blockDelete: true, checkToolNumbers: false, offsetMm: [1, 'x', 3], limitMin: [null, null, -50], toolSize: true }));
    expect(s.rapidFeedMm).toBe(8000);
    expect(s.toolChangeSec).toBeNull();
    expect(s.blockDelete).toBe(true);
    expect(s.checkToolNumbers).toBe(false);
    expect(s.offsetMm).toEqual([1, null, 3]);
    expect(s.limitMin).toEqual([null, null, -50]);
    expect(s.toolSize).toBe(true);
  });

  it('해석 옵션으로: 기계 좌표는 세 축이 다 있어야, 공구 표시 크기만 바뀌면 다시 읽지 않는다', () => {
    const d = defaultSettings();
    expect(settingsOpenOptions(d)).toEqual({});
    const s = { ...d, rapidFeedMm: 12000, dogleg: true, blockDelete: true, checkToolNumbers: false, offsetMm: [10, null, 30] as [number, null, number] };
    expect(settingsOpenOptions(s)).toEqual({ blockDelete: true, checkToolNumbers: false, machine: { rapidFeedMm: 12000, dogleg: true } });
    const full = { ...s, offsetMm: [10, 20, 30] as [number, number, number], limitMax: [null, null, 100] as [null, null, number] };
    expect(settingsOpenOptions(full).machine).toEqual({ rapidFeedMm: 12000, dogleg: true, offsetMm: [10, 20, 30], referenceMm: [0, 0, 0], limitsMm: { min: [null, null, null], max: [null, null, 100] } });
    expect(settingsNeedReparse(d, { ...d, toolSize: true })).toBe(false);
    expect(settingsNeedReparse(d, { ...d, offsetMm: [1, null, null] })).toBe(false);
    expect(settingsNeedReparse(d, { ...d, toolChangeSec: 5 })).toBe(true);
  });

  it('워커 해석 옵션에 넘기고(블록 건너뛰기·H/D 확인·기계 설정), 결과에 반영된다', () => {
    const o = parseOptions('gcode', { blockDelete: true, checkToolNumbers: false, machine: { toolChangeSec: 4 } });
    expect(o.gcode).toMatchObject({ blockDelete: true, checkToolNumbers: false, machine: { toolChangeSec: 4 } });
    expect(o.heidenhain).toEqual({ machine: { toolChangeSec: 4 } });
    const text = new TextEncoder().encode(`G21 G90 G54\nT1 M06\nG0 X0 Y0 Z5\n/G0 X50\nG1 Z-1 F100\nM30\n`);
    const plain = parseForView('a.nc', text.slice());
    const set = parseForView('a.nc', text.slice(), { blockDelete: true, machine: { toolChangeSec: 4 } });
    const nc = (r: typeof plain): NcPayload => r.nc!;
    expect(nc(set).moves.count).toBe(nc(plain).moves.count - 1);
    expect(nc(set).stats.toolChangeTime).toBe(4);
  });
});

describe('공구 표시 모양·크기', () => {
  it('이름으로 모양, 실제 크기면 반지름 = 지름/2', () => {
    expect(toolShape('6MM BALL ENDMILL')).toBe('ball');
    expect(toolShape('SPOT DRILL 90DEG')).toBe('cone');
    expect(toolShape('10MM FLAT ENDMILL')).toBe('cylinder');
    expect(toolShape('FRAESER D10')).toBe('cylinder');
    expect(toolShape('PROBE')).toBeNull();
    expect(toolShape(undefined)).toBeNull();
    const nc = {
      moves: { count: 2, tool: new Int32Array([1, 2]), kind: new Uint8Array([1, 1]) },
      tools: [
        { number: 1, name: '10MM FLAT ENDMILL', diameter: 10 },
        { number: 2, name: 'T2' },
      ],
    } as unknown as Pick<NcPayload, 'moves' | 'tools'>;
    expect(toolMarker(nc, 0, false)).toEqual({ kind: 'cylinder' });
    expect(toolMarker(nc, 0, true)).toEqual({ kind: 'cylinder', radius: 5 });
    expect(toolMarker(nc, 1, true)).toEqual({ kind: 'cone' });
  });
});
