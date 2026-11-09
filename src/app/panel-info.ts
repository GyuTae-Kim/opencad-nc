/**
 * 패널 정보 탭의 공구 경로 부분(G-code·Heidenhain): 해석 설정(방언·선반 G 코드 체계·기본 단위·최소 단위), 보기 선택(보정 경로·선반 공구 표·선반 모드·회전축),
 * 공구 경로 요약, 기계·읽기 설정, 3D 보기 경고(55차 — 코어 장면 알림). 문서를 열 때 3D 뷰어 코어와 함께 받는 조각이다(54차 — 첫 화면 JS에서 뺐다. 문서가 없으면 쓰지 않는다).
 * panel.ts의 NcPanel이 정보 탭을 그릴 때 부른다(받기 전이면 받은 뒤 다시 그린다).
 */
import type { SceneIssue, SceneIssueCode } from 'opencad-viewer3d';
import { NC_DIALECT_NAMES, type NcDialect, type NcLatheSystem } from '../model';
import { formatDuration } from '../view/playback';
import { lineAtLabel, sceneFeatures, unitLabel, type NcDoc } from './doc';
import { h } from './dom';
import { mix } from './filetext';
import { fmtNum } from './format';
import { group, row, type PanelHost } from './panel';
import { cleanLatheTool, defaultSettings, type NcSettings } from './settings';

const G_DIALECTS: NcDialect[] = ['iso', 'fanuc', 'haas', 'linuxcnc', 'grbl', 'mach3'];

/** 다시 읽는 켜고 끄기(선택 기능)의 열쇠 */
export type OptKey = 'comp' | 'lathe' | 'rotary' | 'mprDisabled' | 'integerUnits';

/** 정보 탭을 그리는 패널(panel.ts NcPanel) */
export interface InfoPanel {
  readonly host: PanelHost;
  readonly body: HTMLElement;
  optToggle(d: NcDoc, key: OptKey, label: string, hint: string): HTMLElement;
}

/** 정보 탭의 공구 경로 부분(d.nc가 있을 때) */
export function ncInfo(p: InfoPanel, d: NcDoc): void {
  const nc = d.nc!;
  const st = nc.stats;
  const u = unitLabel(d.scene.units);
  const f = sceneFeatures(d.scene);
  if (nc.kind === 'gcode') {
    const dialect = h('select', { class: 'select', 'aria-label': 'G-code 방언' });
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
      group(
        '해석 설정',
        h('label', { class: 'prop-row edit' }, h('span', { class: 'k' }, '방언'), dialect),
        f.lathe && nc.latheSystem ? latheSystemRow(p.host, d, nc.latheSystem) : null,
        h('label', { class: 'prop-row edit', title: 'G20/G21이 없을 때 쓰는 단위' }, h('span', { class: 'k' }, '기본 단위'), units),
        p.optToggle(d, 'integerUnits', '소수점 없는 값 = 최소 단위', 'Fanuc 매개변수 DPI = 0 꼴: X12500을 12.5 mm(inch는 X12500 = 1.25)로 읽습니다. A·B·C는 0.001도.'),
        h('p', { class: 'hint' }, '바꾸면 파일을 다시 읽습니다.'),
      ),
    );
  }
  // 선택 기능: 반경 보정 경로·선반·회전축
  const opts: HTMLElement[] = [];
  if (f.compRunCount > 0 || d.ncOptions.comp) {
    opts.push(
      p.optToggle(
        d,
        'comp',
        '보정 경로 보기',
        f.lathe
          ? `선반 공구 끝 R 보정(G41/G42) 구간 ${f.compRunCount}곳의 경로를 묶음 "보정 경로"(분홍 실선)로 그립니다. 공구 방향(1~8)이 있으면 가상 공구 끝, 없거나 9면 노즈 반지름 중심 경로입니다. 프로그램 경로는 그대로입니다.`
          : `반경 보정(${nc.kind === 'heidenhain' ? 'RL/RR' : 'G41/G42'}) 구간 ${f.compRunCount}곳의 공구 중심 경로를 묶음 "보정 경로"(분홍 실선)로 그립니다. 프로그램 경로는 그대로입니다.`,
      ),
    );
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
        opts.push(el);
        // 선반: 공구 방향(값과 출처를 따로 — 출처 글이 따로 옮겨지게)
        if (r.tool !== undefined)
          opts.push(
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
    if (f.lathe && f.compRuns) opts.push(...latheToolRows(p.host, f.compRuns));
  }
  if (nc.kind === 'gcode') {
    opts.push(p.optToggle(d, 'lathe', '선반 모드', 'G18 평면, X를 지름으로(LinuxCNC는 G7부터), U·W 증분, G90/G94·G70~G76 선반 사이클로 읽고 XZ 단면(회전축 Z)으로 그립니다.'));
    if (f.rotaryAxes || d.ncOptions.rotary) opts.push(p.optToggle(d, 'rotary', '회전축 감기', 'A·B·C 각을 X·Y·Z축 둘레로 감아 공작물 기준 공구 끝 경로를 그립니다(회전 중심 = 원점, G43.4 동안은 감지 않음).'));
  }
  if (opts.length) p.body.append(group('보기 선택', ...opts));
  p.body.append(
    group(
      '공구 경로',
      row('방언 · 단위', `${nc.kind === 'heidenhain' ? 'Heidenhain 평문' : NC_DIALECT_NAMES[nc.dialect]}${f.lathe ? ' · 선반' : ''} · ${nc.units}`),
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

/** 기계·읽기 설정(앱 전체, 이 브라우저에 기억): 바꾸면 지금 프로그램을 다시 읽는다 */
function settingsGroup(host: PanelHost): HTMLElement {
  const s = host.settings;
  const set = (patch: Partial<NcSettings>): void => host.setSettings({ ...host.settings, ...patch });
  const numIn = (v: number | null, label: string, onSet: (n: number | null) => void, placeholder = ''): HTMLInputElement => {
    const el = h('input', { type: 'number', step: 'any', inputmode: 'decimal', class: 'num-input', 'aria-label': label, placeholder });
    el.value = v === null ? '' : String(v);
    el.addEventListener('change', () => {
      const t = el.value.trim();
      const n = t === '' ? null : Number(t);
      onSet(n === null || Number.isFinite(n) ? n : null);
    });
    return el;
  };
  const one = (label: string, hint: string, v: number | null, onSet: (n: number | null) => void, placeholder: string): HTMLElement =>
    h('label', { class: 'prop-row edit', title: hint }, h('span', { class: 'k' }, label), numIn(v, label, onSet, placeholder));
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
  return group(
    '기계·읽기 설정',
    one('급속 속도(mm/분)', '시간 계산에 쓰는 급속 속도. 비우면 10000 mm/분(inch 프로그램은 400 inch/분).', s.rapidFeedMm, (n) => set({ rapidFeedMm: n && n > 0 ? n : null }), '10000'),
    one('공구 교환 시간(초)', '공구를 한 번 바꿀 때마다 예상 시간에 더합니다.', s.toolChangeSec, (n) => set({ toolChangeSec: n && n > 0 ? n : null }), '0'),
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
    const r = h('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', class: 'num-input', 'aria-label': `T${key} 노즈 반지름(mm)`, placeholder: 'R' });
    r.value = cur?.radiusMm != null ? String(cur.radiusMm) : '';
    const q = h('select', { class: 'select', 'aria-label': `T${key} 공구 방향` });
    q.append(h('option', { value: '' }, '—'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('option', { value: String(n) }, String(n))));
    q.value = cur?.orientation != null ? String(cur.orientation) : '';
    const apply = (): void => {
      const n = r.value.trim() === '' ? null : Number(r.value);
      save(key, n !== null && Number.isFinite(n) && n > 0 ? n : null, q.value ? Number(q.value) : null);
    };
    r.addEventListener('change', apply);
    q.addEventListener('change', apply);
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
