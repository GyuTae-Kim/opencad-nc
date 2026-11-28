// @vitest-environment jsdom
/**
 * 210차(성능 — 동작 그대로): 패널의 코드 탭 밖 탭 몸통(공구·가공·변수·정보)을 첫 화면 panel.ts에서 문서를 열 때 받는 정보 탭 조각(panel-info.ts renderTab)으로 옮겼다.
 * - 조각을 받기 전에 그 탭을 그리면 몸통은 「불러오는 중…」(211차 — 전에는 비어 있음)이고, 받으면 지금 탭을 다시 그린다(받는 중 깃발 — 54차 정보 탭 공구 경로 부분과 같은 꼴).
 *   앱에서는 ensureViewer가 이 조각을 기다린 뒤 문서를 열어 보통은 이미 받았다 — 이 시험은 그 앞 길만 본다(beforeAll로 미리 받지 않는다).
 * - 받은 뒤에는 전과 같이 바로(같은 차례에) 그리고, 옮긴 함수의 누름(탭 바꿈·다시 읽는 켜고 끄기)은 패널·앱 기능으로 그대로 이어진다.
 * 탭 몸통 함수가 첫 화면 panel.ts로 돌아오면(첫 화면 JS가 다시 커짐) 첫 시험의 「받기 전 불러오는 중…」(211차 — 전에는 빈 몸통)이 깨진다(tests/app/core-split.test.ts 210차 시험도 본다).
 */
import { describe, expect, it, vi } from 'vitest';
import type { NcDoc } from '../../src/app/doc';
import { NcPanel, loadPanelInfo, type PanelHost } from '../../src/app/panel';

const reparse = vi.fn();
const host = {
  measuring: false,
  touch: false,
  isPlaying: false,
  speed: 1,
  playbackInfo: () => null,
  groups: () => [{ name: '구멍', visible: true, count: 3 }],
  setGroupVisible: vi.fn(),
  reparse,
  sceneIssues: () => [],
} as unknown as PanelHost;

/** 판재(MPR) 문서 — 변수 둘, 꺼진 가공 하나(정보 탭 「보기 선택」의 다시 읽는 켜고 끄기가 보인다) */
function mprDoc(tab: 'vars' | 'info'): NcDoc {
  return {
    name: 'part.mpr',
    kind: 'mpr',
    size: 1234,
    ms: 5,
    job: null,
    nc: null,
    mpr: null,
    scene: {
      units: 'mm',
      meshes: [],
      lines: [],
      meta: {
        variables: [
          { name: 'L', value: 800, expr: '800' },
          { name: 'B', value: 400, expr: 'L/2', comment: '폭' },
        ],
        stats: { holes: 3, drillOps: 1, contourOps: 0, grooves: 0, pockets: 0, disabled: 1 },
      },
    },
    panelTab: tab,
    selLine: -1,
    selKey: '',
    pick: null,
    measure: null,
    hiddenGroups: new Set<string>(),
    highlight: [],
    ncOptions: {},
  } as unknown as NcDoc;
}

function makePanel(): NcPanel {
  const workspace = document.createElement('div');
  document.body.append(workspace);
  return new NcPanel(host, workspace);
}

const varRows = (p: NcPanel): string[][] => [...p.body.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));

describe('코드 탭 밖 탭 몸통은 정보 탭 조각에서 그린다(210차)', () => {
  it('받기 전에 변수 탭을 그리면 몸통이 「불러오는 중…」이었다가(211차 — 전에는 빈 몸통), 조각을 받으면 다시 그린다', async () => {
    const p = makePanel();
    p.show(mprDoc('vars'));
    // 틀·탭 줄은 첫 화면 조각이 바로 그린다
    expect([...p.el.querySelectorAll<HTMLElement>('.panel-tab')].map((b) => b.dataset.tab)).toEqual(['ops', 'vars', 'code', 'info', 'sim']);
    expect(p.body.getAttribute('aria-labelledby')).toBe('panel-tab-vars');
    // 211차: 받는 동안은 깎기 탭과 같은 「불러오는 중…」 한 줄(전에는 빈 몸통 — panel.ts waitTab). 탭 몸통 함수가 panel.ts로 돌아오면 바로 표를 그려 이 줄이 깨진다
    expect(p.body.textContent).toBe('불러오는 중…');
    await vi.waitFor(() => expect(p.body.querySelector('table')).not.toBeNull(), { timeout: 10_000 });
    expect(varRows(p).map((r) => [r[0], r[2], r[3]])).toEqual([
      ['L', '', ''],
      ['B', 'L/2', '폭'],
    ]);
  });

  it('받은 뒤에는 바로 그리고, 정보 탭의 묶음·보기 선택 누름이 앱 기능으로 이어진다', async () => {
    await loadPanelInfo();
    const p = makePanel();
    const d = mprDoc('vars');
    p.show(d);
    expect(varRows(p)).toHaveLength(2);
    p.el.querySelector<HTMLButtonElement>('.panel-tab[data-tab="info"]')!.click();
    expect(d.panelTab).toBe('info');
    expect([...p.body.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['문서', '가공 요약', '보기 선택', '묶음(켜고 끄기)', '해석 경고']);
    expect(p.body.querySelector('#panel-groups-title')?.textContent).toBe('묶음(켜고 끄기)');
    expect([...p.body.querySelectorAll('.groups .group-item .name')].map((x) => x.textContent)).toEqual(['구멍']);
    const opt = p.body.querySelector<HTMLInputElement>('label.group-item.opt input')!;
    expect(opt.checked).toBe(false);
    opt.click();
    expect(reparse).toHaveBeenCalledWith({ mprDisabled: true });
  });
});
