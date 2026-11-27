// @vitest-environment jsdom
/**
 * 199차(WCAG 3.1.2): 다른 언어 화면에 한국어가 남는 자리 — 처음 화면·코드 목록·공구·가공·변수·정보·깎기 탭·해석 판단 띠·상태 막대·패널 아래 띠·재생 띠를
 * 예제 프로그램 다섯(앱 「예제 열기」와 같은 합성 G-code, Siemens·Heidenhain 짧은 프로그램, 판재 MPR·PGI)으로 네 언어(en·ja·zh-CN·de) 화면에 그려
 * 화면 글(글 마디)과 title·aria-label·aria-description·placeholder·alt에 한글이 없는지 본다.
 * 예제에는 한글이 없으니 파일 글 칸(translate="no"·코드 목록 줄 글) 안의 한글도 앱이 넣은 낱말이다(해석기 기본값 꼴 — 함께 센다).
 * 언어를 lang="ko"로 표시한 칸(언어 메뉴의 「한국어」)만 뺀다. 한국어 화면은 같은 거르개가 한글을 찾는지(거르개가 비지 않음)를 본다.
 * 큰 파일을 읽는 데 1초·1분 넘게 걸린 것처럼 해석 시간을 준다(상태 막대 「읽기 …」·정보 탭 「읽은 시간」). 열기 오류(주소에서 받지 못함·NC 프로그램이 아닌 파일·빈 파일)와
 * 다시 읽기 실패(메모리가 모자람 흉내)의 알림 — 시작 화면 오류 줄·알림 상자 — 도 본다(「이름: 까닭」의 까닭은 앱 글).
 * 지금 고치지 못한 자리는 STILL(「아직 둔 것」 — 목록에 있는데 이제 어느 언어에서도 한글이 없으면 실패).
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView), 깎기 워커는 같은 실행기를 같은 스레드에서(sim.test.ts 꼴).
 * 200차: 199차 걸음 밖이던 화면 셋을 더한다 — 깎기 계산 결과 줄(켜서 끝까지 깎은 뒤 깎기 탭 상태 글·계산 알림 영역 `.sim-live`·결과 묶음, 판재는 가공 하나씩 따라가기의
 * 탭 묶음과 3D 보기 아래 띠), 측정 띠(줄자 안내·방향 잠금·끌어온 점·결과 값 칸 — 아래 띠·상태 막대·툴팁·띠 위 알림 함께)와 가상 커서 알림(Enter 가상 커서·고르기·측정 스냅 알림 `.key-live`).
 * 측정·가상 커서는 실제 코어(가짜 WebGL — keysnap-core.test.ts 꼴)로 연 앱 하나를 한국어 → 네 언어로 언어 메뉴로 바꿔 가며 돈다(앱은 창 키 듣기를 떼지 않아 새로 만들면 앞 앱도 같은 키를 받는다).
 * PGI 예제에 옆면 회전 포켓 넷(앞·뒷·왼쪽·오른쪽면 — 「포켓 … (회전 15°) (앞면)」)을 더한다.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    get scene(): unknown {
      return null;
    }
    getProjection(): string {
      return 'perspective';
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    groups(): unknown[] {
      return [];
    }
  }
  /** 200차: real이면 실제 코어 뷰어(측정·가상 커서 걸음 — 가짜 WebGL), 아니면 가짜 뷰어 */
  return { FakeViewer, mode: { real: false } };
});

vi.mock('opencad-viewer3d', async (importOriginal) => {
  const core = await importOriginal<typeof import('opencad-viewer3d')>();
  // new로 부르면 돌려준 객체가 그 값이 된다(가짜 뷰어의 Proxy와 같은 길)
  function Viewer3d(host: HTMLElement, opts?: ConstructorParameters<typeof core.Viewer3d>[1]): object {
    return fake.mode.real ? new core.Viewer3d(host, opts) : new fake.FakeViewer(host);
  }
  return { ...core, Viewer3d };
});
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  // 큰 파일을 읽는 데 걸린 시간 흉내(ms — 「1분 2초」·「1.5초」 꼴)
  const slow: Record<string, number> = { 'opencad-sample.nc': 61_500, 'panel.mpr': 1_500 };
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      // 다시 읽는 동안 메모리가 모자란 것 흉내(「소수점 없는 값 = 최소 단위」로 다시 읽기 — 알림 「…: 다시 읽지 못했습니다 — 까닭」)
      if ((opts as { integerUnits?: boolean } | undefined)?.integerUnits) throw new RangeError('Array buffer allocation failed');
      const res = parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
      return { ...res, ms: slow[name] ?? res.ms };
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { installLocalization } from '../../src/app/i18n';
import { loadPanelInfo } from '../../src/app/panel';
import { RecentStore } from '../../src/app/recent';
import { SimRunner } from '../../src/sim/runner';
import { ncSampleProgram } from '../../src/view/sample';
import { installCanvasFakes } from './fake-webgl';
import { memoryBackend } from './recent-memory';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  postMessage(msg: Parameters<SimRunner['handle']>[0]): void {
    if (!this.dead) this.runner.handle(msg);
  }
  terminate(): void {
    this.dead = true;
  }
}

// Siemens: 이름 공구(T="…"), 다른 파일의 부프로그램(L9001 — 해석 판단 띠 「찾지 못했습니다」)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
// Heidenhain 대화식: 이름 공구
const HH = ['0 BEGIN PGM PART MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-10', '2 BLK FORM 0.2 X+100 Y+100 Z+0', '3 TOOL CALL "FLAT_D6" Z S3000', '4 L X+10 Y+10 Z+5 R0 FMAX', '5 L Z-1 F200', '6 L X+40', '7 L Z+5 R0 FMAX', '8 END PGM PART MM', ''].join('\n');
// woodWOP MPR: 판 600 × 400 × 19, 윗면 구멍·포켓, 옆면 구멍, 아랫면 구멍(sim.test.ts PANEL_MPR과 같은 꼴), 변수 하나
const MPR = [
  '[H',
  'VERSION="4.0 Alpha"',
  '_BSX=600',
  '_BSY=400',
  '_BSZ=19',
  '',
  '[001',
  'DM="12"',
  'KM="DEPTH"',
  '',
  '<100 \\WerkStck\\',
  'LA="600"',
  'BR="400"',
  'DI="19"',
  '',
  '<102 \\BohrVert\\',
  'XA="100"',
  'YA="100"',
  'TI="DM"',
  'DU="8"',
  '',
  '<112 \\Tasche\\',
  'XA="300"',
  'YA="200"',
  'LA="100"',
  'BR="50"',
  'TI="10"',
  '',
  '<103 \\BohrHoriz\\',
  'XA="0"',
  'YA="100"',
  'ZA="9.5"',
  'DU="8"',
  'TI="30"',
  'BM="XP"',
  '',
  '<131 \\UfluBohr\\',
  'XA="500"',
  'YA="300"',
  'TI="10"',
  'DU="15"',
  '!',
  '',
].join('\n');
// WangShi PGI(tests/wangs.test.ts 표본에서 파일 글의 한글 풀이를 뺀 것): 면마다 구멍, 톱 홈·직선 경로, 포켓(회전·옆면·아랫면), 경로, 원, 읽지 못하는 요소.
// 200차: 옆면 회전 포켓 넷(앞·뒷·왼쪽·오른쪽면 — 이름 「포켓 60 × 8 × 6 (회전 15°) (앞면)」 꼴)
const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <params>
  <param key="L" value="600" description=""/>
  <param key="W" value="400" description=""/>
  <param key="T" value="18" description=""/>
  <param key="E" value="W-37" description="FRONT"/>
 </params>
 <panel length="600" width="400" thickness="18" name="[SETUP] G54 Z- / t_min" frontID="EDGE10001" material="See nesting CSV" quantity="1">
  <outlines>
   <outline x="0" y="400" bulge="0" banding="1"/>
   <outline x="600" y="400" bulge="0" banding="1"/>
   <outline x="600" y="100" bulge="0" banding="0"/>
   <outline x="500" y="100" bulge="0" banding="0"/>
   <outline x="500" y="0" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0.5"/>
   <outline x="0" y="400" bulge="0" banding="0"/>
  </outlines>
  <hole x="32" y="E" z="0" diameter="5" depth="13" direction="z-" no="5" xi="32" yi="0" zi="0" enable="1" order="1"/>
  <hole x="600" y="200" z="9" diameter="8" depth="30" direction="x-" enable="1" order="2"/>
  <hole x="0" y="200" z="5" diameter="8" depth="22" direction="x+" enable="0" order="4"/>
  <hole x="300" y="400" z="12" diameter="6" depth="12" direction="y-" enable="1" order="5"/>
  <hole x="550" y="260" z="0" diameter="10" depth="-12" direction="z+" enable="1" order="7"/>
  <line startX="20" startY="380" startZ="0" endX="480" endY="380" endZ="0" width="4" depth="7" direction="z+" isSaw="1" enable="1" order="8"/>
  <line startX="20" startY="20" startZ="0" endX="200" endY="20" endZ="0" width="8" depth="5" direction="z-" isSaw="0" enable="1" order="9"/>
  <pocket length="80" width="40" depth="10" direction="z-" cornerRadius="5" angle="30" centerX="300+(40)/2" centerY="200" centerZ="0" enable="1" order="10"/>
  <pocket length="60" width="8" depth="6" direction="y-" cornerRadius="0" angle="0" centerX="150" centerY="0" centerZ="9" enable="1" order="11"/>
  <path direction="z-" toolOffset="left" width="8" depth="18" close="0" enable="1" order="13">
   <vertex x="100" y="100" z="0" bulge="0"/>
   <vertex x="200" y="100" z="0" bulge="1"/>
   <vertex x="220" y="120" z="0" bulge="0"/>
  </path>
  <circle centerX="100" centerY="200" centerZ="0" radius="17.5" width="35" toolName="T35" depth="13" direction="z-" empty="1" toolOffset="in" enable="1" order="17"/>
  <circle centerX="420" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="0"/>
  <groove x="10" y="50" z="0" direction="z-" depth="3" enable="1" order="20"/>
  <hole x="40" y="40" diameter="5" depth="10" direction="q+" enable="1" order="21"/>
  <pocket length="60" width="8" depth="6" direction="y+" cornerRadius="0" angle="15" centerX="300" centerY="0" centerZ="9" enable="1" order="22"/>
  <pocket length="60" width="8" depth="6" direction="y-" cornerRadius="0" angle="15" centerX="300" centerY="400" centerZ="9" enable="1" order="23"/>
  <pocket length="60" width="8" depth="6" direction="x+" cornerRadius="0" angle="15" centerX="0" centerY="200" centerZ="9" enable="1" order="24"/>
  <pocket length="60" width="8" depth="6" direction="x-" cornerRadius="0" angle="15" centerX="600" centerY="300" centerZ="9" enable="1" order="25"/>
 </panel>
</pgi>
`;

const HANGUL = /[가-힣]/;
const ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'];
/** 파일 글 칸: 번역하지 않는 칸(translate="no")과 코드 목록의 줄 글 */
const FILE_CELL = '[translate="no"], .code-list .tx';
/** 언어를 한국어로 표시한 칸(문서 뿌리 html의 lang은 화면 언어라 빼지 않는다) */
const koPart = (el: Element): boolean => {
  const l = el.closest('[lang]');
  return !!l && l !== document.documentElement && /^ko\b/.test(l.getAttribute('lang') ?? '');
};
const where = (el: Element): string => {
  const c = el.closest('[class]') ?? el;
  return `${el.closest(FILE_CELL) ? '파일 글 칸 ' : ''}${c.tagName.toLowerCase()}.${[...c.classList].join('.')}`;
};
/** 문서에 남은 한글: [자리, 글] */
function hangulLeft(): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('script, style') || koPart(el) || !HANGUL.test(n.nodeValue ?? '')) continue;
    out.push(`${where(el)}: ${(n.nodeValue ?? '').trim()}`);
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (koPart(el)) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HANGUL.test(v)) out.push(`${where(el)} @${a}: ${v}`);
    }
  }
  return out;
}

/** 아직 둔 것: [남은 글 꼴, 까닭] — 그 언어 화면 글에 맞는다 */
const STILL: [RegExp, string][] = [];

const tick = async (k = 4): Promise<void> => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const enc = new TextEncoder();
/** 200차: 깎기 계산이 목표에 닿았다(시뮬레이션하지 않는 프로그램이면 그 알림) */
const simDone = (): boolean => {
  const s = window.opencadApp!.state.sim;
  return !!s && s.on && !s.computing && (s.at !== null || s.blocked !== null);
};

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(깎기·정보 탭 공구 경로 부분·3D 보기 위 UI)을 미리 받아 둔다(ci-guard 5번)
  await import('../../src/app/sim');
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
  // 200차: 문서를 열 때 기다리지 않고 받는 측정 도구 조각(app.ts ensureMeasureTools — 맨 위 곁효과 없음)
  await import('../../src/app/measure-tools');
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

/** 그 언어 화면을 만들어 처음 화면 → 프로그램 다섯을 차례로 열어 돌며 남은 한글을 모은다(글 → 처음 본 걸음) */
async function tour(lang: string): Promise<Map<string, string>> {
  history.replaceState(null, '', lang === 'ko' ? '/opencad-nc/' : `/opencad-nc/${lang}/`);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const backend = memoryBackend();
  // 처음 화면 최근 문서: 파일 하나·여러 파일 작업 하나
  backend.entries.set('a', { entry: { id: 'a', name: 'part.nc', size: 2048, time: Date.now() - 3_600_000, files: 2 }, data: enc.encode(SIE).buffer as ArrayBuffer });
  const app = new NcViewerApp(root, { recent: new RecentStore(backend) });
  dispose = await installLocalization(root);
  const api = window.opencadApp!;
  const seen = new Map<string, string>();
  const look = async (step: string): Promise<void> => {
    await tick();
    for (const t of hangulLeft()) if (!seen.has(t)) seen.set(t, step);
  };
  await app.renderRecent();
  await look('처음 화면');
  // 처음 화면 열기 오류: 주소에서 받지 못함(HTTP 404), NC 프로그램이 아닌 글 파일 — 「이름: 까닭」(이름은 파일 글)
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }));
  expect(await app.openUrl('/files/part.nc')).toBe(false);
  expect(root.querySelector<HTMLElement>('.start-error')!.hidden).toBe(false);
  await look('처음 화면 주소 열기 오류');
  expect(await app.openBuffer('notes.md', enc.encode('hello world\nsecond line\n').buffer as ArrayBuffer)).toBe(false);
  expect(root.querySelector('.start-error [translate=no]')!.textContent).toBe('notes.md');
  await look('처음 화면 열기 오류');
  const programs: [string, string][] = [
    ['opencad-sample.nc', ncSampleProgram()],
    ['part.MPF', SIE],
    ['part.h', HH],
    ['panel.mpr', MPR],
    ['panel.pgi', PGI],
  ];
  for (const [name, text] of programs) {
    expect(await app.openBuffer(name, enc.encode(text).buffer as ArrayBuffer), name).toBe(true);
    await look(`${name} 열기`);
    api.togglePanel(true);
    const panel = name.startsWith('panel.');
    for (const tab of panel ? ['ops', 'vars', 'code', 'info', 'sim'] : ['code', 'tools', 'info', 'sim']) {
      api.setPanelTab(tab);
      if (tab === 'sim') await until(() => !!root.querySelector('.panel-body table.sim-tools'));
      await look(`${name} ${tab} 탭`);
    }
    // 고른 것: 판재는 가공 탭 첫 줄, 프로그램은 이동을 만드는 줄
    if (panel) {
      api.setPanelTab('ops');
      await tick();
      root.querySelector<HTMLElement>('.panel-body tbody tr')?.click();
    } else api.selectLine(name === 'part.h' ? 4 : name === 'part.MPF' ? 6 : 9);
    await look(`${name} 고른 것`);
    if (!panel) {
      // 재생: 한 이동씩(패널 재생 막대·아래 띠), 패널을 닫으면 재생 띠
      api.seek(0);
      for (let k = 0; k < 3; k++) api.stepMove(1);
      await look(`${name} 재생`);
      api.togglePanel(false);
      await look(`${name} 재생 띠`);
      api.seek(null);
    }
    api.togglePanel(false);
    // 200차: 깎기 계산 결과 줄 — 켜서 끝까지 깎은 뒤 깎기 탭 상태 글·계산 알림 영역(.sim-live)·결과 묶음(급속 경고·시뮬레이션하지 않은 가공),
    // 판재는 가공 하나씩 따라가기(탭 묶음과 패널을 닫은 3D 보기 아래 띠)
    api.togglePanel(true);
    api.setPanelTab('sim');
    await api.setSim(true);
    await until(simDone);
    await look(`${name} 깎기 결과`);
    if (panel && api.state.sim!.panel?.items) {
      await api.setSim(true, { step: 1 });
      await until(simDone);
      await look(`${name} 가공 하나씩 따라가기`);
      api.togglePanel(false);
      await look(`${name} 따라가기 띠`);
      await api.setSim(true, { step: null });
    }
    await api.setSim(false);
    api.togglePanel(false);
    if (name === 'opencad-sample.nc') {
      // 다시 읽기 실패 알림 상자(까닭은 앱 글 — 메모리가 모자람)
      const n = document.querySelectorAll('.toast.error').length;
      await api.reparse({ integerUnits: true });
      expect(document.querySelectorAll('.toast.error').length).toBe(n + 1);
      await look(`${name} 다시 읽기 실패`);
    }
  }
  // 문서가 열린 뒤의 열기 오류(알림 상자): 빈 파일
  const n = document.querySelectorAll('.toast.error').length;
  expect(await app.openBuffer('empty.nc', new ArrayBuffer(0))).toBe(false);
  expect(document.querySelectorAll('.toast.error').length).toBe(n + 1);
  await look('빈 파일 열기 오류');
  return seen;
}

// 200차 측정·가상 커서 걸음(keysnap-core.test.ts와 같은 예제): 가운데 (20,15)를 지나는 줄 4(G1 X40 Y15)와 그 둘레, 판재는 포켓(가공 1) 가운데 구멍(가공 2)
const LINES = ['G21 G90 G17', 'G0 X0 Y15 Z5', 'G1 Z0 F300', 'G1 X40 Y15', 'G1 X40 Y30', 'G1 X0 Y30', 'G0 Z5', 'M2'].join('\n');
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <pocket length="80" width="60" depth="6" direction="z-" cornerRadius="0" angle="0" centerX="100" centerY="150" centerZ="0" enable="1" order="1"/>
  <hole x="100" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="2"/>
  <hole x="300" y="60" z="0" diameter="8" depth="10" direction="z-" enable="1" order="3"/>
 </panel>
</pgi>`;

/**
 * 200차: 측정 띠·가상 커서 알림 걸음(실제 코어 앱 하나 — 지금 화면 언어로). 고르기 가상 커서(Enter 켜기·Tab 후보·Enter 고르기·초점이 떠나 끄기),
 * 측정(켜기 안내 → 가상 커서로 첫 점 → 후보 돌리기 → 측정 띠 끌어온 점 버튼 → 커서를 옮긴 뒤 초점이 떠나 끄기 → 창 화살표 방향 잠금(↓ 잠글 방향 없음 알림, → X축) →
 * 다시 켠 커서로 잠근 선 위 둘째 점과 결과 — 측정 띠·아래 띠·상태 막대·툴팁·띠 위 알림), 판재 고르기(가공 묶음)를 돌며 남은 한글을 모은다.
 * Esc는 보내지 않는다(앞 시험의 가짜 뷰어 앱도 창 키를 받아 Esc를 막는다 — 커서는 초점이 떠나면 코어가 끈다)
 */
async function measureTour(app: NcViewerApp, root: HTMLElement): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const look = async (step: string): Promise<void> => {
    await tick(8);
    for (const t of hangulLeft()) if (!seen.has(t)) seen.set(t, step);
  };
  const open = async (name: string, text: string): Promise<Viewer3d> => {
    if (app.state().measuring) app.toggleMeasure(false);
    app.viewer?.canvas.blur();
    expect(await app.openBuffer(name, enc.encode(text).buffer as ArrayBuffer), name).toBe(true);
    return app.viewer!;
  };
  /** 세계 점 p를 화면 가운데로(위에서 본 보기, 가로 반폭 w — 화면 800 × 600 — keysnap-core center)하고 3D 보기에 초점 */
  const center = (v: Viewer3d, p: readonly number[], w: number): void => {
    v.setView('top', false);
    v.fit(false);
    const a = v.project([p[0]! - w, p[1]! - w * 0.75, p[2]!])!;
    const b = v.project([p[0]! + w, p[1]! + w * 0.75, p[2]!])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
    const s = v.project(p)!;
    expect(Math.abs(s.x - 400)).toBeLessThan(1);
    expect(Math.abs(s.y - 300)).toBeLessThan(1);
    v.canvas.focus();
  };
  /** 캔버스가 받은 키(창 캡처의 앱 키 → 캔버스의 코어 키), 창 키(캔버스 밖 — 앱 화살표 방향 잠금) */
  const key = (v: Viewer3d, k: string, o: KeyboardEventInit = {}): void => void v.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const winKey = (k: string): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  // 연 뒤 두 프레임 뒤의 전체 보기(app.ts setDoc — 처음 맞춤)가 지난 다음에 가운데로 맞춘다(keysnap-core는 그 앞에 키를 보냄)
  let v = await open('a.nc', LINES);
  await look('공구 경로 열기');
  center(v, [20, 15, 0], 25);
  key(v, 'Enter');
  await look('고르기 가상 커서 켜기');
  key(v, 'Tab');
  await look('고르기 후보 돌리기');
  key(v, 'Enter');
  await look('고르기 가상 커서로 고름');
  v.canvas.blur();
  await look('가상 커서 끄기');
  // 측정
  app.toggleMeasure(true);
  await until(() => app.state().measuring);
  await look('측정 켜기');
  center(v, [20, 15, 0], 25);
  key(v, 'Enter');
  expect(v.keyboardCursor).toMatchObject({ mode: 'measure' });
  await look('측정 가상 커서 켜기');
  key(v, 'Enter');
  expect(v.measurePoints).toHaveLength(1);
  await look('측정 첫 점');
  key(v, 'Tab');
  await look('측정 후보 돌리기');
  root.querySelector<HTMLButtonElement>('.measure-bar .mb-track')!.click();
  await look('끌어온 점 기억');
  key(v, 'ArrowUp', { shiftKey: true });
  await look('측정 가상 커서 옮기기');
  v.canvas.blur();
  await look('측정 가상 커서 끄기');
  winKey('ArrowDown');
  await look('방향 잠금 — 잠글 방향 없음');
  winKey('ArrowRight');
  expect(app.state().measureLock?.lock).toBe('x');
  await look('방향 잠금 X축');
  v.canvas.focus();
  key(v, 'Enter');
  for (let i = 0; i < 4; i++) key(v, 'ArrowRight', { shiftKey: true });
  await look('잠근 선 위로 커서 옮기기');
  key(v, 'Enter');
  expect(app.doc!.measure).not.toBeNull();
  await look('측정 결과');
  v.clearMeasure();
  app.toggleMeasure(false);
  v.canvas.blur();
  await look('측정 끄기');
  // 판재: 고르기 가상 커서(가공 묶음)
  v = await open('p.pgi', PANEL);
  await look('판재 열기');
  center(v, [100.6, 150.4, 18], 12);
  key(v, 'Enter');
  await look('판재 고르기 가상 커서 켜기');
  key(v, 'Tab');
  await look('판재 고르기 후보 돌리기');
  key(v, 'Enter');
  await look('판재 가공 고름');
  v.canvas.blur();
  await look('판재 가상 커서 끄기');
  return seen;
}

/** 언어마다 남은 한글(STILL 목록과 견준다) */
const found = new Map<string, string[]>();

describe('다른 언어 화면에 한국어가 남지 않는다(199차)', () => {
  it('한국어 화면: 같은 거르개가 한글을 찾는다(거르개가 비지 않음)', async () => {
    const seen = await tour('ko');
    expect(seen.size).toBeGreaterThan(200);
    // 언어 메뉴의 「한국어」(lang="ko")는 빼고 센다
    expect([...seen.keys()].some((t) => t.includes('한국어'))).toBe(false);
  });

  it.each(['en', 'ja', 'zh-CN', 'de'])('%s: 처음 화면·코드·공구·가공·변수·정보·깎기 탭·판단 띠·상태 막대·아래 띠·재생 띠에 한글 0(아직 둔 것 빼고)', async (lang) => {
    const seen = await tour(lang);
    const all = [...seen.keys()];
    found.set(lang, all);
    expect(all.filter((t) => !STILL.some(([re]) => re.test(t))).map((t) => `${seen.get(t)} · ${t}`)).toEqual([]);
  });

  it('200차: 측정 띠·가상 커서 알림 — 한국어 화면은 거르개가 그 글을 찾고, 언어 메뉴로 바꾼 네 언어에는 한글 0(아직 둔 것 빼고)', async () => {
    const restore = installCanvasFakes(800, 600);
    const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    fake.mode.real = true;
    try {
      history.replaceState(null, '', '/opencad-nc/');
      document.body.innerHTML = '<div id="app"></div>';
      const root = document.getElementById('app')!;
      const app = new NcViewerApp(root, { recent: new RecentStore(memoryBackend()) });
      dispose = await installLocalization(root);
      const left: Record<string, string[]> = {};
      for (const lang of ['ko', 'en', 'ja', 'zh-CN', 'de']) {
        if (lang !== 'ko') {
          document.querySelector<HTMLButtonElement>(`.language-list [data-language="${lang}"]`)!.click();
          await until(() => document.documentElement.lang === lang);
        }
        const seen = await measureTour(app, root);
        const all = [...seen.keys()];
        if (lang === 'ko') {
          // 걸음이 그 글을 냈다: 가상 커서 알림(켜기·고르기·첫 점·둘째 점), 측정 띠 안내·잠금 안내·스냅 짝, 띠 위 알림
          const heads = ['div.key-live: 가상 커서를 켰습니다', 'div.key-live: 골랐습니다', 'div.key-live: 첫 점을 찍었습니다', 'div.key-live: 둘째 점을 찍었습니다', 'span.mb-hint: 측정', 'span.mb-sub.mb-lock-hint: ', 'span.mb-sub.mb-snap: ', 'div.measure-flash: '];
          expect(heads.filter((head) => !all.some((t) => t.startsWith(head)))).toEqual([]);
          continue;
        }
        found.set(lang, [...(found.get(lang) ?? []), ...all]);
        left[lang] = all.filter((t) => !STILL.some(([re]) => re.test(t))).map((t) => `${seen.get(t)} · ${t}`);
      }
      expect(left).toEqual({ en: [], ja: [], 'zh-CN': [], de: [] });
    } finally {
      fake.mode.real = false;
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
      restore();
    }
  });

  it('아직 둔 것: 목록마다 네 언어 가운데 한 곳에는 아직 한글이 남아 있다(이제 없으면 목록에서 지운다)', () => {
    expect(found.size).toBe(4);
    const all = [...found.values()].flat();
    expect(STILL.filter(([re]) => !all.some((t) => re.test(t))).map(([re, why]) => `${re} — ${why}`)).toEqual([]);
  });
});
