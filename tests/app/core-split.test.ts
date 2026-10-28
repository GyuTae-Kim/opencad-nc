/**
 * 3D 뷰어 코어를 문서를 열 때 나눠 받기(app/core.ts): 첫 화면 모듈(src/ — 앱 입구 main.ts에서 닿는 것)은 코어 입구(opencad-viewer3d)와
 * 무거운 모듈(viewer·renderer 등)을 값으로 가져오지 않는다(타입만). 값은 작은 모듈(camera·pointer·viewcube)만, 입구는 core.ts의 import()로만.
 * 이 규칙이 깨지면 번들러가 코어 전체를 첫 화면 JS에 다시 넣는다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
/** 첫 화면에서 바로 가져와도 되는 코어 모듈(작고 다른 코어 모듈을 거의 끌어오지 않는다) */
const SMALL = new Set(['camera', 'pointer', 'viewcube', 'types', 'math', 'bounds']);

describe('코어 나눠 받기', () => {
  it('src/의 값 가져오기는 작은 코어 모듈만, 코어 입구는 core.ts의 import()로만', () => {
    const bad: string[] = [];
    let dynamic = 0;
    for (const f of files(SRC)) {
      // 워커(해석)는 앱 첫 화면과 다른 묶음이다
      if (f.includes('/worker/')) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'opencad-viewer3d(?:\/([\w-]+))?';/gms)) {
        if (m[1]) continue;
        const sub = m[2];
        if (!sub || !SMALL.has(sub)) bad.push(`${relative(SRC, f)}: ${m[0].split('\n')[0]}`);
      }
      // 타입 자리(typeof import(…))는 받지 않는다
      for (const m of text.matchAll(/(?<!typeof )import\(\s*'opencad-viewer3d(?:\/[\w-]+)?'\s*\)/g)) {
        if (!f.endsWith('/app/core.ts')) bad.push(`${relative(SRC, f)}: ${m[0]}`);
        else dynamic++;
      }
    }
    expect(bad).toEqual([]);
    expect(dynamic).toBe(1);
  });

  it('측정 원호 접선(tangent.ts)도 첫 화면에서 값으로 가져오지 않고 core.ts의 import()로만 — 한 번만 받는다', async () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      if (f.includes('/worker/')) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'\.\/tangent';/gms)) if (!m[1]) bad.push(`${relative(SRC, f)}: ${m[0].split('\n')[0]}`);
      for (const m of text.matchAll(/(?<!typeof )import\(\s*'\.\/tangent'\s*\)/g)) if (!f.endsWith('/app/core.ts')) bad.push(`${relative(SRC, f)}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
    const { loadArcTangents } = await import('../../src/app/core');
    const a = loadArcTangents();
    expect(loadArcTangents()).toBe(a);
    expect(typeof (await a).ArcTangents).toBe('function');
  });

  it('코어 입구를 한 번만 받고 같은 모듈을 준다', async () => {
    const { loadViewerCore } = await import('../../src/app/core');
    const a = loadViewerCore();
    expect(loadViewerCore()).toBe(a);
    const m = await a;
    expect(typeof m.Viewer3d).toBe('function');
    // 앱이 바로 가져온 작은 모듈과 코어가 같은 객체를 쓴다(뷰 이름 번역이 코어 그림에도 닿게)
    const { VIEW_LABELS } = await import('opencad-viewer3d/camera');
    expect(m.VIEW_LABELS).toBe(VIEW_LABELS);
  });
});
