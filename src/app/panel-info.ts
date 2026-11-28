/**
 * 패널의 코드 탭 밖 탭 몸통(210차 — panel.ts에서 옮김): 공구 탭(G-code·Heidenhain), 가공·변수 탭(판재 MPR·PGI·XML), 정보 탭 — 문서·작업 파일·절삭 범위·가공 요약·
 * 묶음 켜고 끄기·해석 경고와 공구 경로 부분(해석 설정(방언·선반 G 코드 체계·기본 단위·최소 단위), 보기 선택(보정 경로·선반 공구 표·선반 모드·회전축),
 * 공구 경로 요약, 기계·읽기 설정), 3D 보기 경고(55차 — 코어 장면 알림). 문서를 열 때 3D 뷰어 코어와 함께 받는 조각이다(54차 — 첫 화면 JS에서 뺐다. 문서가 없으면 쓰지 않는다).
 * panel.ts의 NcPanel이 그 탭을 그릴 때 renderTab을 부른다(받기 전이면 받은 뒤 다시 그린다 — 문서는 app.ts ensureViewer가 이 조각을 기다린 뒤 열린다).
 * 210차: 이 탭들은 시작 화면(문서를 열기 전)에서 그리지 않아 첫 화면 JS에서 뺐다 — 남은 panel.ts는 틀·탭 줄·재생 막대·코드 탭·아래 띠
 * (tests/app/core-split.test.ts가 이 모듈이 첫 화면 그래프 밖이고 탭 몸통 함수가 panel.ts로 돌아오지 않는지 본다)
 */
import type { Scene3d, SceneIssue, SceneIssueCode } from 'opencad-viewer3d';
import { isPanelKind } from '../extensions';
import { NC_DIALECT_NAMES, type NcDialect, type NcLatheSystem } from '../model';
import { formatDuration } from '../view/playback';
import { MPR_KIND, docLabel, lineAtLabel, lineMoveList, lineNumberText, mprOps, sceneCounts, sceneFeatures, unitLabel, type NcDoc } from './doc';
import { h, mixSpan } from './dom';
import { fileText, mix, type Mixed } from './filetext';
import { fmtNum, fmtPt, formatBytes, formatMs, rgbCss } from './format';
import { mixText } from './i18n';
import { icon } from './icons';
import type { PanelHost } from './panel';
import type { NcJobInfo, NcPayload } from './protocol';
import { cleanLatheTool, defaultSettings, type NcSettings } from './settings';

// 216차: 아래 여섯(절삭 범위 글·판재 변수·공구 줄 고르기·공구 묶음·공구 항목)은 이 탭 몸통만 써 doc.ts(첫 화면 조각)에서 옮겼다 — 시험은 이 모듈에서 가져온다

/** 절삭 범위 글 "X 0 ~ 50 · Y -10 ~ 10 · Z -5 ~ 2 mm" */
export function cutRangeText(min: readonly number[], max: readonly number[], unit: string): string {
  return `X ${fmtNum(min[0])} ~ ${fmtNum(max[0])} · Y ${fmtNum(min[1])} ~ ${fmtNum(max[1])} · Z ${fmtNum(min[2])} ~ ${fmtNum(max[2])}${unit ? ` ${unit}` : ''}`;
}

/** 판재 가공 변수(scene.meta.variables) */
export interface MprVarRow {
  name: string;
  value?: number;
  expr: string;
  comment?: string;
}

export function mprVars(scene: Scene3d): MprVarRow[] {
  const v = (scene.meta as { variables?: unknown } | undefined)?.variables;
  return Array.isArray(v) ? (v as MprVarRow[]) : [];
}

/** 공구가 만든 첫 이동의 줄(이동이 없으면 -1) */
export function toolFirstMoveLine(nc: Pick<NcPayload, 'moves'>, tool: number): number {
  const m = nc.moves;
  for (let i = 0; i < m.count; i++) if (m.tool[i] === tool) return m.line[i]!;
  return -1;
}

/**
 * 공구 줄을 눌렀을 때 고를 코드 줄: 공구가 처음 나온 줄이 그 공구의 이동을 만들면 그 줄,
 * 아니면(공구 교환 줄 등) 그 공구의 첫 이동 줄.
 */
export function toolSelectLine(nc: Pick<NcPayload, 'moves' | 'lineMoves'>, tool: number, firstLine: number): number {
  if (firstLine >= 0 && lineMoveList(nc, firstLine).some((i) => nc.moves.tool[i] === tool)) return firstLine;
  const l = toolFirstMoveLine(nc, tool);
  return l >= 0 ? l : firstLine;
}

/** 공구 번호 → 장면 묶음 이름(선분 묶음 nc-cut-·nc-drill-에서 찾는다) */
export function toolGroup(scene: Scene3d, tool: number): string | null {
  const key = tool < 0 ? 'none' : String(tool);
  const l = scene.lines.find((x) => x.id === `nc-cut-${key}` || x.id === `nc-drill-${key}`);
  return l?.group ?? null;
}

/** 공구 번호 → 장면 항목 id들 */
export function toolItems(scene: Scene3d, tool: number): string[] {
  const key = tool < 0 ? 'none' : String(tool);
  return scene.lines.filter((x) => x.id === `nc-cut-${key}` || x.id === `nc-drill-${key}`).map((x) => x.id);
}

const G_DIALECTS: NcDialect[] = ['iso', 'fanuc', 'haas', 'linuxcnc', 'grbl', 'mach3'];

/** 다시 읽는 켜고 끄기(선택 기능)의 열쇠 */
export type OptKey = 'comp' | 'lathe' | 'rotary' | 'mprDisabled' | 'integerUnits';

/** 코드 탭 밖 탭 몸통을 그리는 패널(panel.ts NcPanel) */
export interface InfoPanel {
  readonly host: PanelHost;
  readonly body: HTMLElement;
  /** 지금 문서(누른 때 읽는다) */
  readonly doc: NcDoc | null;
  /** 탭 줄·몸통을 다시 그린다(d.panelTab을 바꾼 뒤면 그 탭으로) */
  render(): void;
  /** 경고의 줄로(다시 누르면 같은 경고가 난 다음 줄로) — 코드 탭을 연다 */
  gotoWarning(it: { text: string; line: number; lines: number[] }): void;
}

/** 이름·값 줄(이름이 섞은 글이면 지금 언어로 옮겨 담고, file이면 값은 파일 글 — 번역하지 않는다) */
const row = (k: string | Mixed, v: string, file = false): HTMLElement =>
  h('div', { class: 'prop-row' }, typeof k === 'string' ? h('span', { class: 'k' }, k) : mixSpan(k, 'k'), h('span', { class: 'v', title: v, translate: file ? 'no' : null }, v));
const group = (title: string, ...children: (Node | null)[]): HTMLElement => h('section', { class: 'prop-group' }, h('h3', {}, title), ...children);

/** 코드 탭 밖 탭 몸통(공구·가공·변수·정보 — 깎기 탭은 앱이 그린다). panel.ts render가 몸통을 비운 뒤 부른다 */
export function renderTab(p: InfoPanel, d: NcDoc): void {
  if (d.panelTab === 'tools') renderTools(p, d);
  else if (d.panelTab === 'ops') renderOps(p, d);
  else if (d.panelTab === 'vars') renderVars(p, d);
  else renderInfo(p, d);
}

// ───────────────────────── 공구(G-code·Heidenhain) ─────────────────────────

function renderTools(p: InfoPanel, d: NcDoc): void {
  const nc = d.nc;
  if (!nc) return;
  type ToolRow = (typeof nc.tools)[number] & { color?: number[] };
  const meta = d.scene.meta as { tools?: ToolRow[] } | undefined;
  const tools: ToolRow[] = meta?.tools ?? nc.tools;
  if (!tools.length) {
    p.body.append(h('p', { class: 'empty' }, '공구 정보가 없습니다.'));
    return;
  }
  const u = unitLabel(d.scene.units);
  const tbody = h('tbody');
  for (const t of tools) {
    const g = toolGroup(d.scene, t.number);
    const visible = g ? !d.hiddenGroups.has(g) : true;
    // 이름만 있는 공구(Heidenhain TOOL CALL "이름"·Siemens T="이름")는 번호 칸을 비우고 이름 칸에 보인다
    const label = t.number >= 100000 ? '—' : t.number >= 0 ? `T${t.number}` : '공구 없음';
    // 단추 이름: 이름만 있는 공구는 그 이름(파일 글 — 자리를 지켜 옮겨 넣고 번역층은 건너뛴다)
    const who = t.number >= 100000 && t.name !== undefined ? fileText(t.name) : label;
    // data-key(137차): 이름은 누를 때 「숨기기 ↔ 보이기」로 바뀌어 다시 그린 몸통의 같은 버튼을 공구 번호로 찾는다(render)
    const eye = h('button', { class: `toggle${visible ? '' : ' off'}`, type: 'button', title: visible ? '숨기기' : '보이기', 'aria-label': mixText(mix`${who} ${visible ? '숨기기' : '보이기'}`), 'data-i18n-keep': 'aria-label', 'data-key': `eye${t.number}`, 'aria-pressed': String(visible), html: icon(visible ? 'eye' : 'eyeOff') });
    eye.disabled = !g;
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!g) return;
      p.host.setGroupVisible(g, d.hiddenGroups.has(g));
      p.render();
    });
    const items = toolItems(d.scene, t.number);
    const cur = items.length > 0 && d.highlight.length === items.length && items.every((id) => d.highlight.includes(id));
    // 174차(WCAG 4.1.2): 강조한 공구 줄은 바탕으로만 보여 화면 읽기가 몰랐다 — 표 줄의 aria-selected는 격자 안에서만 뜻이 있어 클래스와 같은 자리에서 aria-current(한 표에 하나)
    const tr = h(
      'tr',
      { class: `clickable${cur ? ' current' : ''}${visible ? '' : ' off'}`, 'aria-current': cur ? 'true' : null, title: `처음 나온 줄 ${lineNumberText(d, t.firstLine)}` },
      h('td', {}, eye),
      h('td', {}, h('span', { class: 'swatch', style: `background:${rgbCss(t.color ?? [0.5, 0.5, 0.5])}` })),
      h('td', {}, label),
      h('td', { class: 'wrap', translate: 'no' }, t.name ?? ''),
      h('td', { class: 'num' }, t.diameter ? `Ø${fmtNum(t.diameter)}` : ''),
      minZCell(p, t),
      h('td', { class: 'num' }, formatDuration(t.time)),
      h('td', { class: 'num' }, `${fmtNum(t.feedLength, 1)}${u}`),
    );
    if (t.cutMin && t.cutMax) tr.title = `${tr.title} · ${cutRangeText(t.cutMin, t.cutMax, u)}`;
    const selLine = toolSelectLine(nc, t.number, t.firstLine);
    tr.addEventListener('click', (ev) => {
      if (ev.detail >= 2) {
        // 두 번 누르기: 강조를 켠 채 그 공구 경로에 맞춰 보기
        p.host.setHighlight(items);
        p.host.selectLine(selLine);
        p.host.fitItems(items);
        p.render();
        return;
      }
      p.host.setHighlight(cur ? [] : items);
      // 코드 보기는 그 공구의 첫 이동 줄로(공구가 처음 나온 줄이 이동을 만들지 않으면 첫 이동 줄)
      if (!cur) p.host.selectLine(selLine);
      p.render();
    });
    tbody.append(tr);
  }
  p.body.append(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'grid tools' },
        h('thead', {}, h('tr', {}, h('th', { 'aria-label': '보이기' }, ''), h('th', {}, '색'), h('th', {}, '번호'), h('th', {}, '이름'), h('th', { class: 'num' }, '지름'), h('th', { class: 'num', title: '이 공구의 절삭(이송·호·드릴) 가운데 가장 낮은 Z' }, 'Z 최저'), h('th', { class: 'num' }, '시간'), h('th', { class: 'num' }, '이송 길이'))),
        tbody,
      ),
    ),
    h('p', { class: 'hint' }, '줄을 누르면 그 공구의 경로를 강조하고 첫 이동 줄로 갑니다. 두 번 누르면 그 경로에 맞춰 봅니다. 눈 버튼으로 켜고 끕니다. Z 최저를 누르면 가장 깊은 절삭 줄로 갑니다(줄에 마우스를 올리면 절삭 범위).'),
  );
}

/** 공구 표의 "Z 최저" 칸: 누르면 그 줄로 */
function minZCell(p: InfoPanel, t: { cutMin?: number[]; minZLine?: number }): HTMLElement {
  if (!t.cutMin) return h('td', { class: 'num faint' }, '');
  const b = h('button', { class: 'linkish', type: 'button', title: '가장 깊은 절삭 줄로' }, fmtNum(t.cutMin[2]!));
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (t.minZLine !== undefined && t.minZLine >= 0) {
      p.host.selectLine(t.minZLine);
      const d = p.doc;
      if (d) {
        d.panelTab = 'code';
        p.render();
      }
    }
  });
  return h('td', { class: 'num' }, b);
}

// ───────────────────────── 판재 가공(MPR·PGI·XML) ─────────────────────────

function renderOps(p: InfoPanel, d: NcDoc): void {
  const meta = (d.scene.meta ?? {}) as { workpiece?: { length: number; width: number; thickness: number } };
  const u = unitLabel(d.scene.units);
  const wp = meta.workpiece;
  if (wp) p.body.append(group('공작물', row('크기(L × W × T)', `${fmtNum(wp.length)} × ${fmtNum(wp.width)} × ${fmtNum(wp.thickness)} ${u}`)));
  const ops = mprOps(d.scene);
  if (!ops.length) {
    p.body.append(h('p', { class: 'empty' }, '가공이 없습니다.'));
    return;
  }
  const tbody = h('tbody');
  for (const o of ops) {
    const sel = d.selKey === String(o.index);
    const detail = [
      o.diameter ? `Ø${fmtNum(o.diameter)}` : '',
      o.depth !== undefined ? `깊이 ${fmtNum(o.depth)}` : '',
      o.thickness !== undefined ? `두께 ${fmtNum(o.thickness)}` : '',
      o.holeCount ? `${o.holeCount}개` : '',
      o.tool !== undefined ? `T${o.tool}` : '',
    ].filter(Boolean);
    // 값 조각("깊이 13")은 한 덩어리로 두고 " · "에서만 줄을 바꾼다(긴 가공 이름 옆에서 글자 하나 폭으로 접히지 않게)
    const detailCell = h('td', { class: 'wrap' }, ...detail.flatMap((t, i) => [i ? ' · ' : null, h('span', { class: 'nb' }, t)]));
    // 174차: 고른 가공 줄도 공구 표와 같은 규칙(aria-current — 한 표에 하나)
    const tr = h(
      'tr',
      { class: `clickable${sel ? ' current' : ''}${o.enabled ? '' : ' off'}`, 'aria-current': sel ? 'true' : null, title: o.line != null ? `줄 ${o.line + 1}` : '' },
      h('td', { class: 'num faint' }, String(o.index + 1)),
      // MPR 가공 이름(MNM·주석·매크로 이름)은 파일 글, PGI·XML은 앱이 지은 이름(옮긴다)
      h('td', { class: 'wrap', translate: o.label && d.kind === 'mpr' ? 'no' : null }, o.label || MPR_KIND[o.kind] || o.kind),
      h('td', {}, MPR_KIND[o.kind] ?? o.kind),
      detailCell,
      h('td', {}, o.enabled ? h('span', { class: 'chip' }, '켜짐') : h('span', { class: 'chip warn' }, '꺼짐')),
    );
    tr.addEventListener('click', () => p.host.selectMprOp(o.index));
    tbody.append(tr);
  }
  p.body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, '가공'), h('th', {}, '종류'), h('th', {}, '값'), h('th', {}, '상태'))), tbody)));
}

function renderVars(p: InfoPanel, d: NcDoc): void {
  const vars = mprVars(d.scene);
  if (!vars.length) {
    p.body.append(h('p', { class: 'empty' }, '변수가 없습니다.'));
    return;
  }
  const tbody = h('tbody');
  for (const v of vars)
    tbody.append(
      h(
        'tr',
        {},
        h('td', { class: 'mono', translate: 'no' }, v.name),
        h('td', { class: 'num mono' }, v.value !== undefined ? fmtNum(v.value) : '—'),
        h('td', { class: 'mono dim wrap', translate: 'no' }, v.expr !== String(v.value) ? v.expr : ''),
        h('td', { class: 'dim wrap', translate: 'no' }, v.comment ?? ''),
      ),
    );
  p.body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', { class: 'num' }, '값'), h('th', {}, '식'), h('th', {}, '설명'))), tbody)));
}

// ───────────────────────── 정보 ─────────────────────────

function groupList(p: InfoPanel, d: NcDoc): HTMLElement {
  const groups = p.host.groups();
  if (!groups.length) return group('묶음', h('p', { class: 'hint' }, '묶음이 없습니다.'));
  // 164차: 상자 이름은 「급속 이송 120」뿐이라 Tab으로 상자에 가면 켜고 끄는(보이기) 상자인지 몰랐다 — 목록을 role=group으로 묶고 이름은 보이는 묶음 제목(h3)을 잇는다
  // (WCAG 1.3.1·4.1.2, 새 글 없음 — 제목 글을 번역층이 옮기면 이름도 따름). 패널은 앱에 하나이고 정보 탭은 몸통을 비운 뒤 한 번 그려 id도 하나
  const list = h('div', { class: 'groups', role: 'group', 'aria-labelledby': 'panel-groups-title' });
  // 묶음 이름은 앱 낱말(급속 이송·구멍·공구 없음 등 — 다른 언어로 옮긴다). 이름 붙은 공구(Siemens T="…")의 묶음은 파일 자료라 그대로 둔다
  const toolNames = new Set((d.nc?.tools ?? []).map((t) => t.name).filter((n): n is string => !!n));
  for (const g of groups) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !d.hiddenGroups.has(g.name);
    cb.addEventListener('change', () => p.host.setGroupVisible(g.name, cb.checked));
    list.append(h('label', { class: 'group-item' }, cb, h('span', { class: 'name', translate: toolNames.has(g.name) ? 'no' : null }, g.name), h('span', { class: 'chip' }, String(g.count))));
  }
  const sec = group('묶음(켜고 끄기)', list);
  sec.firstElementChild!.id = 'panel-groups-title';
  return sec;
}

function renderInfo(p: InfoPanel, d: NcDoc): void {
  const s = d.scene;
  const u = unitLabel(s.units);
  const c = sceneCounts(s);
  const b = s.bounds;
  const rows: HTMLElement[] = [row('파일', d.name, true), row('형식', docLabel(d)), row('크기', formatBytes(d.size)), row('단위', u || '모름'), row('읽은 시간', formatMs(d.ms))];
  if (b) {
    // 장면 범위 = 급속·공작물 포함(기계 좌표 쪽 추정 이동은 뺌). 절삭만의 범위는 아래 "절삭 범위"
    rows.push(row('범위 크기(급속 포함)', `${fmtNum(b.max[0] - b.min[0])} × ${fmtNum(b.max[1] - b.min[1])} × ${fmtNum(b.max[2] - b.min[2])} ${u}`));
    rows.push(row('최소', fmtPt(b.min)), row('최대', fmtPt(b.max)));
  }
  if (c.segments) rows.push(row('선분', c.segments.toLocaleString('ko-KR')));
  if (c.triangles) rows.push(row('삼각형', c.triangles.toLocaleString('ko-KR')));
  p.body.append(group('문서', ...rows));
  if (d.job) p.body.append(jobGroup(p, d, d.job));

  const cb = d.nc?.cutBounds;
  if (cb)
    p.body.append(
      group(
        '절삭 범위(이송·호·드릴)',
        row('크기', `${fmtNum(cb.max[0] - cb.min[0])} × ${fmtNum(cb.max[1] - cb.min[1])} × ${fmtNum(cb.max[2] - cb.min[2])} ${u}`),
        row('최소', fmtPt(cb.min)),
        row('최대', fmtPt(cb.max)),
        row('가장 깊은 Z', `${fmtNum(cb.min[2])} ${u}`),
      ),
    );
  // 공구 경로 부분(아래 ncInfo — 54차부터 이 조각)
  if (d.nc) ncInfo(p, d);
  if (isPanelKind(d.kind)) {
    const st = (s.meta as { stats?: Record<string, number> } | undefined)?.stats;
    if (st)
      p.body.append(
        group(
          '가공 요약',
          row('구멍', `${st.holes ?? 0}개 (드릴 가공 ${st.drillOps ?? 0})`),
          row('윤곽 가공', String(st.contourOps ?? 0)),
          row('홈 · 포켓', `${st.grooves ?? 0} · ${st.pockets ?? 0}`),
          st.edges ? row('엣지 밴딩', String(st.edges)) : null,
          row('꺼진 가공', String(st.disabled ?? 0)),
        ),
      );
    if ((st?.disabled ?? 0) > 0 || d.ncOptions.mprDisabled) {
      // 145차: 풀이는 손가락 기기 안내 줄로도 상자 바로 밑에(127차 withTips와 같은 줄 — 이 묶음은 withTips를 거치지 않는다)
      const tip = d.kind === 'mpr' ? '조건(??)이 0이거나 EN=0인 가공을 묶음 "꺼진 가공"으로 그립니다.' : 'enable(Enable)이 0인 가공을 묶음 "꺼진 가공"으로 그립니다.';
      p.body.append(group('보기 선택', optToggle(p, d, 'mprDisabled', '꺼진 가공도 그리기', tip), h('p', { class: 'hint coarse-only' }, tip)));
    }
  }
  p.body.append(groupList(p, d));
  const warns = s.warnings ?? [];
  const items = d.nc?.warnItems ?? d.mpr?.warnItems ?? [];
  // NC·판재 파일(MPR·PGI·XML): 경고마다 단추(줄 번호·글·횟수 따로 — 조각마다 번역되고, 누르면 그 줄로, 다시 누르면 같은 경고가 난 다음 줄로). 그 밖(장면 경고)은 글
  const lis: HTMLElement[] = items.slice(0, 300).map((it) => {
    if (it.line < 0) return h('li', {}, it.text);
    const btn = h(
      'button',
      { class: 'warn-item', type: 'button', title: it.lines.length > 1 ? '누르면 그 줄로(다시 누르면 같은 경고가 난 다음 줄로)' : '누르면 그 줄로' },
      mixSpan(lineAtLabel(d, it.line), 'ln'),
      h('span', { class: 'msg' }, it.text),
      it.count > 1 ? h('span', { class: 'cnt' }, `모두 ${it.count}번`) : null,
    );
    btn.addEventListener('click', () => p.gotoWarning(it));
    return h('li', {}, btn);
  });
  for (const w of warns.slice(items.length, 300)) lis.push(h('li', {}, w));
  p.body.append(
    warns.length
      ? group(`해석 경고 ${warns.length.toLocaleString('ko-KR')}개`, h('ul', { class: 'warn-list' }, ...lis), warns.length > 300 ? h('p', { class: 'hint' }, `처음 300개만 보입니다.`) : null)
      : group('해석 경고', h('p', { class: 'hint' }, '경고가 없습니다.')),
  );
  // 3D 보기 코어가 장면 입력에서 빼거나 고친 것(55차 — 코어 0.50.0). 있을 때만(아래 sceneIssueGroup)
  const issues = p.host.sceneIssues?.() ?? [];
  if (issues.length) p.body.append(sceneIssueGroup(issues));
}

/**
 * 작업 파일(여러 파일을 한 작업으로 열었을 때): 주 프로그램 고르기(바꾸면 다시 잇는다), 파일마다 코드 탭의 시작 줄로 가기,
 * 파일 더하기, 잇지 않은 파일과 찾지 못한 부르기
 */
function jobGroup(p: InfoPanel, d: NcDoc, job: NcJobInfo): HTMLElement {
  // 142차: 풀이는 감싼 label과 고르기 자신에 함께(optToggle과 같은 까닭 — 고르기에 초점을 두면 설명으로 읽힘)
  const tip = '부르는 쪽(M98·G65 P, CALL PGM, Siemens 이름 부르기)을 처음부터 실행할 파일';
  const main = h('select', { class: 'select', 'aria-label': '주 프로그램', title: tip });
  for (const f of job.files) main.append(h('option', { value: f, translate: 'no' }, f));
  main.value = job.main;
  main.addEventListener('change', () => p.host.reparse({ ...d.ncOptions, jobMain: main.value }));
  const list = h('ul', { class: 'warn-list job-files' });
  job.files.forEach((f, k) => {
    const line = job.starts[k] ?? -1;
    const b = h(
      'button',
      { class: 'warn-item', type: 'button', title: '누르면 코드 탭에서 이 파일이 시작하는 줄로', disabled: line < 0 },
      h('span', { class: 'ln' }, k === 0 ? '주 프로그램' : '함께 연 파일'),
      h('span', { class: 'msg', translate: 'no' }, f),
    );
    b.addEventListener('click', () => {
      d.panelTab = 'code';
      p.render();
      p.host.selectLine(line, undefined, true);
    });
    list.append(h('li', {}, b));
  });
  const add = h('button', { class: 'btn small', type: 'button', title: '부프로그램 파일을 골라 이 작업에 더합니다(같은 이름은 바꿉니다)' }, '파일 더하기');
  add.addEventListener('click', () => p.host.chooseFile(true));
  const missing = d.nc?.notices?.find((n) => n.kind === 'missing-program')?.programs ?? [];
  return group(
    `작업 파일 ${job.files.length}개`,
    h('label', { class: 'prop-row edit', title: tip }, h('span', { class: 'k' }, '주 프로그램'), main),
    // 145차: 손가락 기기 안내 줄(풍선 글은 휴대폰·태블릿에서 볼 수 없다 — 127차 withTips와 같은 줄)
    h('p', { class: 'hint coarse-only' }, tip),
    list,
    // 파일·프로그램 이름은 파일 글
    job.skipped.length ? h('p', { class: 'hint' }, mixSpan(mix`잇지 않은 파일(형식이 다르거나 NC 프로그램이 아님): ${fileText(job.skipped.join(', '))}`)) : null,
    missing.length ? h('p', { class: 'hint' }, mixSpan(mix`찾지 못한 프로그램: ${fileText(missing.join(', '))} — 해석 경고에서 그 줄로 갑니다.`)) : null,
    add,
  );
}

/** 다시 읽는 켜고 끄기(선택 기능 — 판재 「꺼진 가공도 그리기」와 아래 공구 경로 부분) */
function optToggle(p: InfoPanel, d: NcDoc, key: OptKey, label: string, hint: string): HTMLElement {
  // 142차: 풀이는 감싼 label(마우스 풍선 글)과 상자 자신에 함께 — 화면 읽기의 설명은 상자 자신의 title 차례(HTML-AAM), 감싼 label의 title은 쓰지 않는다
  const cb = h('input', { type: 'checkbox', title: hint });
  // 선반 모드는 고르지 않았으면 글로 판별한다 — 실제로 읽은 모드를 보인다
  cb.checked = key === 'lathe' ? sceneFeatures(d.scene).lathe : !!d.ncOptions[key];
  cb.addEventListener('change', () => p.host.reparse({ ...d.ncOptions, [key]: cb.checked }));
  return h('label', { class: 'group-item opt', title: hint }, cb, h('span', { class: 'name' }, label), h('span', { class: 'hint inline' }, '다시 읽음'));
}

/**
 * 127차: 묶음 g의 바로 아래 칸 가운데 풀이(title)가 있는 칸마다 같은 글의 손가락 기기 안내 줄을 그 칸 바로 밑에 둔다.
 * 풀이는 마우스를 올려야 뜨는 풍선 글이라 휴대폰·태블릿에서는 볼 수 없었다(HTML 표준 title 절 — 풍선 글에 포인터 기기가 필요해 손가락만 쓰는 사용자가 빠진다).
 * 안내 줄은 styles.css coarse-only(마우스 기기는 감춘다 — 시작 화면 손가락 안내와 같은 길)라 마우스 기기의 보이는 것은 같고, 풍선 글도 그대로다.
 * 글은 풍선 글과 같아 같은 사전 항목으로 옮겨진다. 값 칸(.v — 잘린 값의 온 글)은 칸 안이라 닿지 않는다.
 * 142차: 그 칸 안의 상자·숫자 칸·고르기 자신에도 같은 title을 둔다 — 화면 읽기의 설명은 aria-describedby → 칸 자신의 title 차례이고(HTML-AAM 설명 계산)
 * 감싼 label·div의 title은 쓰이지 않아 칸에 초점을 두면 풀이를 듣지 못했다. 칸 이름은 aria-label·감싼 label 글이 따로 있어 title은 설명이 된다(풍선 글은 같은 글)
 */
function withTips(g: HTMLElement): HTMLElement {
  for (const el of g.querySelectorAll<HTMLElement>(':scope > [title]')) {
    el.after(h('p', { class: 'hint coarse-only' }, el.title));
    for (const c of el.querySelectorAll('input, select')) c.setAttribute('title', el.title);
  }
  return g;
}

/** 정보 탭의 공구 경로 부분(d.nc가 있을 때) */
export function ncInfo(p: InfoPanel, d: NcDoc): void {
  const nc = d.nc!;
  const st = nc.stats;
  const u = unitLabel(d.scene.units);
  const f = sceneFeatures(d.scene);
  if (nc.kind === 'gcode') {
    const dialect = h('select', { class: 'select', 'aria-label': 'G-code 형식' });
    dialect.append(h('option', { value: 'auto' }, `자동 (${NC_DIALECT_NAMES[nc.dialect]})`));
    for (const k of G_DIALECTS) dialect.append(h('option', { value: k }, NC_DIALECT_NAMES[k]));
    dialect.value = d.ncOptions.dialect ?? 'auto';
    const units = h('select', { class: 'select', 'aria-label': '기본 단위' });
    units.append(h('option', { value: 'mm' }, 'mm'), h('option', { value: 'inch' }, 'inch'));
    units.value = d.ncOptions.units ?? 'mm';
    const apply = () => p.host.reparse({ ...d.ncOptions, dialect: dialect.value as NcDialect | 'auto', units: units.value as 'mm' | 'inch' });
    dialect.addEventListener('change', apply);
    units.addEventListener('change', apply);
    p.body.append(
      withTips(
        group(
          '해석 설정',
          h('label', { class: 'prop-row edit' }, h('span', { class: 'k' }, 'G-code 형식'), dialect),
          f.lathe && nc.latheSystem ? latheSystemRow(p.host, d, nc.latheSystem) : null,
          h('label', { class: 'prop-row edit', title: 'G20/G21이 없을 때 쓰는 단위' }, h('span', { class: 'k' }, '기본 단위'), units),
          optToggle(p, d, 'integerUnits', '소수점 없는 값 = 최소 단위', 'Fanuc 매개변수 DPI = 0 꼴: X12500을 12.5 mm(inch는 X12500 = 1.25)로 읽습니다. A·B·C는 0.001도.'),
          h('p', { class: 'hint' }, '바꾸면 파일을 다시 읽습니다.'),
        ),
      ),
    );
  }
  // 선택 기능: 반경 보정 경로·선반·회전축
  const opts: HTMLElement[] = [];
  if (f.compRunCount > 0 || d.ncOptions.comp) {
    opts.push(
      optToggle(
        p,
        d,
        'comp',
        '보정 경로 보기',
        f.lathe
          ? `선반 공구 끝 R 보정(G41/G42) 구간 ${f.compRunCount}곳의 경로를 묶음 "보정 경로"(분홍 실선)로 그립니다. 공구 방향(1~8)이 있으면 가상 공구 끝, 없거나 9면 노즈 반지름 중심 경로입니다. 프로그램 경로는 그대로입니다.`
          : `반경 보정(${nc.kind === 'heidenhain' ? 'RL/RR' : 'G41/G42'}) 구간 ${f.compRunCount}곳의 공구 중심 경로를 묶음 "보정 경로"(분홍 실선)로 그립니다. 프로그램 경로는 그대로입니다.`,
      ),
    );
    // 148차: 구간마다 그 줄(선반이면 바로 밑 공구 방향 줄과 함께)을 role=listitem 칸에 담아 role=list로 묶는다 — 화면 읽기 프로그램이 몇 구간인지·몇째인지 듣게(135차 감사 표 3).
    // div에 WAI-ARIA list·listitem을 두어 ul·li의 들여쓰기·글머리표를 지울 스타일시트가 들지 않는다(SKP 156차와 같은 길). 묶음에 상자·안내 줄·선반 공구 표가 섞여 묶음 자신을
    // 목록으로 할 수 없어 감싼다. 감싼 칸은 블록 div이고 묶음(section)·정보 탭 몸통은 블록, 묶음·줄을 자식·형제 결합자로 꾸미는 규칙이 없고 줄은 바깥 여백이 없어 모양은 그대로다
    const runs: HTMLElement[] = [];
    if (f.compRuns)
      for (const r of f.compRuns.slice(0, 20)) {
        const v = r.computed ? `반지름 ${fmtNum(r.radius)} ${u}${r.source ? ` (${r.source})` : ''}` : Number.isFinite(r.radius) ? '이동 없음' : '반지름 모름 — 그리지 않음';
        // 줄 이름(작업 파일 이름은 파일 글)
        const el = row(mix`${lineAtLabel(d, r.line)} ${r.side === 1 ? '왼쪽' : '오른쪽'}`, v);
        // 출처(G10 T1 반지름·선반 공구 표 T1 등)는 따로 옮겨지게 조각으로 — 보이는 글은 같다. 풍선 글(title)은 통째로 옮겨져 출처가 한국어로 남으므로 뺀다(30차)
        if (r.computed && r.source) {
          const ve = el.querySelector('.v')!;
          ve.replaceChildren(`반지름 ${fmtNum(r.radius)} ${u}`, ' (', h('span', {}, r.source), ')');
          ve.removeAttribute('title');
        }
        const item = h('div', { role: 'listitem' }, el);
        runs.push(item);
        // 선반: 공구 방향(값과 출처를 따로 — 출처 글이 따로 옮겨지게)
        if (r.tool !== undefined)
          item.append(
            h(
              'div',
              { class: 'prop-row' },
              h('span', { class: 'k' }, '공구 방향'),
              r.orientation !== undefined && r.orientation > 0
                ? h('span', { class: 'v' }, String(r.orientation), ' · ', h('span', {}, r.orientationSource ?? ''))
                : h('span', { class: 'v' }, '모름 — 노즈 중심'),
            ),
          );
      }
    if (runs.length) opts.push(h('div', { role: 'list' }, ...runs));
    if (f.lathe && f.compRuns) opts.push(...latheToolRows(p.host, f.compRuns));
  }
  if (nc.kind === 'gcode') {
    opts.push(optToggle(p, d, 'lathe', '선반 모드', 'G18 평면, X를 지름으로(LinuxCNC는 G7부터), U·W 증분, G90/G94·G70~G76 선반 사이클로 읽고 XZ 단면(회전축 Z)으로 그립니다.'));
    if (f.rotaryAxes || d.ncOptions.rotary) opts.push(optToggle(p, d, 'rotary', '회전축 감기', 'A·B·C 각을 X·Y·Z축 둘레로 감아 공작물 기준 공구 끝 경로를 그립니다(회전 중심 = 원점, G43.4 동안은 감지 않음).'));
  }
  if (opts.length) p.body.append(withTips(group('보기 선택', ...opts)));
  p.body.append(
    group(
      '공구 경로',
      row('G-code 형식 · 단위', `${nc.kind === 'heidenhain' ? 'Heidenhain 대화식' : NC_DIALECT_NAMES[nc.dialect]}${f.lathe ? ' · 선반' : ''} · ${nc.units}`),
      row('줄 · 실행 블록', `${nc.source.lineCount.toLocaleString('ko-KR')} · ${st.blocks.toLocaleString('ko-KR')}`),
      row('이동', st.moveCount.toLocaleString('ko-KR')),
      row('이송 길이', `${fmtNum(st.feedLength, 1)} ${u}`),
      row('급속 길이', `${fmtNum(st.rapidLength, 1)} ${u}`),
      row('예상 시간', formatDuration(st.time)),
      row('이송 · 급속 · 휴지', `${formatDuration(st.feedTime)} · ${formatDuration(st.rapidTime)} · ${formatDuration(st.dwellTime)}`),
      row('급속 속도(계산용)', `${fmtNum(st.rapidFeed, 0)} ${u}/분`),
      row('공구 교환 · 원호 · 구멍', `${st.toolChanges} · ${st.arcCount.toLocaleString('ko-KR')} · ${st.holeCount.toLocaleString('ko-KR')}`),
      st.toolChangeTime > 0 ? row('공구 교환 시간', formatDuration(st.toolChangeTime)) : null,
    ),
  );
  p.body.append(settingsGroup(p.host));
}

/**
 * 숫자 칸 값: 빈 칸 null, 받는 수(유한하고 ok)면 그 수, 읽지 못한 글(validity.badInput — 쉼표 소수 등, 브라우저가 빈 값으로 돌림)·받지 않는 수는 undefined(걸지 않음).
 * 168차: 전에는 그런 값을 빈 칸처럼 null로 걸어 기억한 값을 말없이 지우고 다시 읽었다(WCAG 3.3.1) — 이제 칸에 aria-invalid="true"(받는 값·빈 칸이면 거둠)를 두고
 * 칸 글은 친 그대로 둔다. 받는 꼴은 142차가 칸 자신의 title로 둔 풀이가 설명이라 aria-describedby는 두지 않는다
 */
function readNum(el: HTMLInputElement, ok: (n: number) => boolean = () => true): number | null | undefined {
  const t = el.value.trim();
  const n = t === '' ? null : Number(t);
  const bad = el.validity.badInput || (n !== null && !(Number.isFinite(n) && ok(n)));
  if (bad) el.setAttribute('aria-invalid', 'true');
  else el.removeAttribute('aria-invalid');
  return bad ? undefined : n;
}

/** 기계·읽기 설정(앱 전체, 이 브라우저에 기억): 바꾸면 지금 프로그램을 다시 읽는다 */
function settingsGroup(host: PanelHost): HTMLElement {
  const s = host.settings;
  const set = (patch: Partial<NcSettings>): void => host.setSettings({ ...host.settings, ...patch });
  // signed(119차 — 기계 좌표·허용 범위): 음수를 쳐 넣으므로 소수 자판(inputmode="decimal" — 음수 기호를 약속하지 않음)을 두지 않고
  // type="number"에 맞춰 브라우저가 자판을 고르게 한다. 0보다 큰 값만 쓰는 칸은 소수 자판 그대로. ok = 받는 수(168차 readNum)
  const numIn = (v: number | null, label: string, onSet: (n: number | null) => void, placeholder = '', signed = false, ok?: (n: number) => boolean): HTMLInputElement => {
    const el = h('input', { type: 'number', step: 'any', inputmode: signed ? null : 'decimal', class: 'num-input', 'aria-label': label, placeholder });
    el.value = v === null ? '' : String(v);
    el.addEventListener('change', () => {
      const n = readNum(el, ok);
      if (n !== undefined) onSet(n);
    });
    return el;
  };
  const one = (label: string, hint: string, v: number | null, onSet: (n: number | null) => void, placeholder: string, ok: (n: number) => boolean): HTMLElement =>
    h('label', { class: 'prop-row edit', title: hint }, h('span', { class: 'k' }, label), numIn(v, label, onSet, placeholder, false, ok));
  const tri = (label: string, hint: string, key: 'offsetMm' | 'referenceMm' | 'limitMin' | 'limitMax'): HTMLElement =>
    h(
      'div',
      { class: 'prop-row edit', title: hint },
      h('span', { class: 'k' }, label),
      h(
        'span',
        { class: 'xyz-input' },
        ...[0, 1, 2].map((a) =>
          numIn(
            s[key][a]!,
            `${label} — ${'XYZ'[a]}`,
            (n) => {
              const v = [...host.settings[key]] as NcSettings[typeof key];
              v[a] = n;
              set({ [key]: v });
            },
            'XYZ'[a]!,
            true,
          ),
        ),
      ),
    );
  const check = (label: string, hint: string, key: 'blockDelete' | 'checkToolNumbers' | 'dogleg' | 'toolSize'): HTMLElement => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = s[key];
    cb.addEventListener('change', () => set({ [key]: cb.checked }));
    return h('label', { class: 'group-item opt', title: hint }, cb, h('span', { class: 'name' }, label));
  };
  const reset = h('button', { type: 'button', class: 'btn small' }, '기본값으로');
  reset.addEventListener('click', () => host.setSettings(defaultSettings()));
  return withTips(
    group(
      '기계·읽기 설정',
      one('급속 속도(mm/분)', '시간 계산에 쓰는 급속 속도. 비우면 10000 mm/분(inch 프로그램은 400 inch/분).', s.rapidFeedMm, (n) => set({ rapidFeedMm: n && n > 0 ? n : null }), '10000', (n) => n > 0),
      one('공구 교환 시간(초)', '공구를 한 번 바꿀 때마다 예상 시간에 더합니다.', s.toolChangeSec, (n) => set({ toolChangeSec: n && n > 0 ? n : null }), '0', (n) => n >= 0),
      check('블록 건너뛰기(/) 켬', '"/"로 시작하는 블록을 실행하지 않습니다(기계의 블록 건너뛰기 스위치를 켠 것과 같음).', 'blockDelete'),
      check('H·D 번호 확인', '공구 길이 보정 H·반경 보정 D 번호가 공구 번호와 다르면 경고합니다.', 'checkToolNumbers'),
      check('도그레그 급속', '여러 축 급속을 축마다 같은 속도로 함께 가다 짧은 축부터 멈추는 꺾인 길로 그리고, 가장 긴 축 이동으로 시간을 셉니다.', 'dogleg'),
      tri('G54 원점의 기계 좌표(mm)', '세 축을 모두 넣으면 G53·M91 값과 G28·G30 기준점을 실제 위치로 그립니다(없으면 공구 축만 안전 높이로 추정).', 'offsetMm'),
      tri('G28 기준점 기계 좌표(mm)', 'G54 원점의 기계 좌표와 함께 씁니다. 빈 칸은 0.', 'referenceMm'),
      tri('허용 범위 최소(mm)', '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.', 'limitMin'),
      tri('허용 범위 최대(mm)', '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.', 'limitMax'),
      check('공구를 실제 크기로 표시', '재생 중 공구 표시를 주석·공구 정의에서 읽은 지름 크기로 그립니다(모양은 공구 이름: 볼·드릴·엔드밀).', 'toolSize'),
      h('p', { class: 'hint' }, '바꾸면 파일을 다시 읽습니다. 이 브라우저에 기억합니다.'),
      reset,
    ),
  );
}

/**
 * 선반 공구 표(보정 구간이 쓰는 공구마다 노즈 반지름 mm·LinuxCNC 공구 방향) — 파일에 값이 없을 때 쓴다.
 * 기계·읽기 설정에 기억하고, 바꾸면 다시 읽는다
 */
function latheToolRows(host: PanelHost, runs: readonly { tool?: number }[]): HTMLElement[] {
  const keys = [...new Set(runs.map((r) => r.tool).filter((t): t is number => t !== undefined && t >= 0))].sort((a, b) => a - b).slice(0, 12);
  if (!keys.length) return [];
  const save = (key: number, radiusMm: number | null, orientation: number | null): void => {
    const all = { ...host.settings.latheTools };
    const c = cleanLatheTool({ radiusMm, orientation });
    if (c) all[key] = c;
    else delete all[key];
    host.setSettings({ ...host.settings, latheTools: all });
  };
  const rows = keys.map((key) => {
    const cur = host.settings.latheTools[key];
    // 183차(WCAG 2.5.3): 이름은 보이는 줄 이름의 앞 조각 그대로(「노즈 반지름」이면 보이는 「R」을 품지 않아 음성 입력으로 부를 수 없었다)
    const r = h('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', class: 'num-input', 'aria-label': `T${key} 노즈 R(mm)`, placeholder: 'R' });
    r.value = cur?.radiusMm != null ? String(cur.radiusMm) : '';
    const q = h('select', { class: 'select', 'aria-label': `T${key} 공구 방향` });
    q.append(h('option', { value: '' }, '—'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('option', { value: String(n) }, String(n))));
    q.value = cur?.orientation != null ? String(cur.orientation) : '';
    // 168차: 노즈 R의 0·음수·읽지 못한 글은 기억한 반지름을 지우지 않고 칸에 aria-invalid(readNum). 그런 칸인 채 방향을 고르면 반지름은 기억한 값으로
    const apply = (fromRadius: boolean): void => {
      const n = readNum(r, (x) => x > 0);
      if (n === undefined && fromRadius) return;
      save(key, n === undefined ? (host.settings.latheTools[key]?.radiusMm ?? null) : n, q.value ? Number(q.value) : null);
    };
    r.addEventListener('change', () => apply(true));
    q.addEventListener('change', () => apply(false));
    return h('div', { class: 'prop-row edit' }, h('span', { class: 'k' }, `T${key} 노즈 R(mm) · 방향`), h('span', { class: 'sim-pair' }, r, q));
  });
  return [
    ...rows,
    h('p', { class: 'hint' }, '선반 공구 표: 파일에 노즈 반지름(G10 L1 R·G41.1 D)이나 공구 방향(G10 L1 Q·G41.1 L)이 없을 때 씁니다. 방향은 LinuxCNC 설명서의 공구 방향 번호입니다(1~8 가상 공구 끝, 9 노즈 중심). 이 브라우저에 기억합니다.'),
  ];
}

/** Fanuc 선반 G 코드 체계 고르기(자동 = 글로 판별, 정할 수 없으면 A) — 바꾸면 다시 읽는다 */
function latheSystemRow(host: PanelHost, d: NcDoc, read: NcLatheSystem): HTMLElement {
  const sel = h('select', { class: 'select', 'aria-label': '선반 G 코드 체계' });
  sel.append(h('option', { value: 'auto' }, `자동 (${read} 체계)`));
  for (const k of ['A', 'B', 'C'] as const) sel.append(h('option', { value: k }, `${k} 체계`));
  sel.value = d.ncOptions.latheSystem ?? 'auto';
  sel.addEventListener('change', () => {
    const { latheSystem: _, ...rest } = d.ncOptions;
    void host.reparse(sel.value === 'auto' ? rest : { ...rest, latheSystem: sel.value as NcLatheSystem });
  });
  return h(
    'label',
    { class: 'prop-row edit', title: 'Fanuc 선반 G 코드 체계 — A: G90·G92·G94 단순 사이클·U/W 증분, B: G77·G78·G79 단순 사이클·G90/G91 절대/증분, C: G20·G21·G24 단순 사이클·G70/G71 inch/mm' },
    h('span', { class: 'k' }, '선반 G 코드'),
    sel,
  );
}

/**
 * 3D 보기 코어 장면 알림의 앱 글(55차 — 코어 0.50.0 SceneIssue.code마다, {0} = 개수). 코어 기본 글(sceneIssueText)은 한국어 하나이고 항목 id·필드 이름을 쓰므로
 * 앱 말로 옮겨 쓴다(화면 번역층이 사전 열쇠로 옮긴다). 좌표는 항목 종류로 나눈다(공구 경로 선분·구멍 점·그물 꼭짓점·그물 윤곽선)
 */
const ISSUE_TEXT: Record<Exclude<SceneIssueCode, 'positions'>, string> = {
  bounds: '장면 범위가 맞지 않아 그린 것에서 다시 셌습니다.',
  placement: '놓을 자리를 알 수 없는 묶음을 그리지 않았습니다.',
  billboard: '마주 보는 그림의 기준점이 수가 아니어서 놓인 그대로 그렸습니다.',
  indices: '없는 꼭짓점을 가리키는 삼각형 {0}개를 그리지 않았습니다.',
  length: '배열 길이가 맞지 않아 남는 값 {0}개를 쓰지 않았습니다.',
  normals: '법선 수가 꼭짓점 수와 맞지 않아 평면 음영으로 그렸습니다.',
  colors: '꼭짓점 색이 모자라거나 수가 아니어서 한 색으로 칠했습니다.',
  uvs: '무늬 좌표 수가 맞지 않아 무늬 없이 칠했습니다.',
  color: '색이 수가 아니어서 기본색으로 칠했습니다.',
  material: '재질 값이 수가 아니어서 기본값을 썼습니다.',
  width: '선 굵기가 수가 아니어서 1로 그렸습니다.',
  size: '점 크기가 수가 아니어서 4로 그렸습니다.',
  ids: '선분·점 번호가 {0}개 모자라 뒤쪽은 배열 안 번호로 고릅니다.',
  'duplicate-id': '같은 이름의 묶음이 또 있어 이름으로 찾는 기능은 하나만 봅니다.',
};
const POSITIONS_TEXT = {
  line: '공구 경로 선분 {0}개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
  point: '점 {0}개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
  mesh: '면 꼭짓점 {0}개는 좌표가 수가 아니거나 너무 커서 그 꼭짓점이 든 면을 그리지 않았습니다.',
  edges: '윤곽선 {0}개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
} as const;

/** 장면 알림 하나의 앱 글(개수는 ko-KR 꼴 — 다른 경고 글과 같다) */
export function sceneIssueText(i: SceneIssue): string {
  const t = i.code === 'positions' ? (i.kind === 'mesh' ? (i.field === 'edges' ? POSITIONS_TEXT.edges : POSITIONS_TEXT.mesh) : i.kind === 'point' ? POSITIONS_TEXT.point : POSITIONS_TEXT.line) : ISSUE_TEXT[i.code];
  return t.replace('{0}', i.count.toLocaleString('ko-KR'));
}

/** 정보 탭 "3D 보기 경고" 묶음(해석 경고 다음 — 알림이 있을 때만 부른다) */
export function sceneIssueGroup(list: readonly SceneIssue[]): HTMLElement {
  return group(
    `3D 보기 경고 ${list.length.toLocaleString('ko-KR')}개`,
    h('ul', { class: 'warn-list' }, ...list.slice(0, 300).map((i) => h('li', {}, sceneIssueText(i)))),
    h('p', { class: 'hint' }, '그릴 수 없는 값은 3D 보기가 빼거나 기본값으로 바꿔 그렸습니다. 해석한 이동과 코드는 그대로입니다.'),
  );
}
