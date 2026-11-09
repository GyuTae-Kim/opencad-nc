/**
 * 3D 보기 키보드 붙잡기·고르기(56차 — 3D 뷰어 코어 0.46.0 setKeyboardSnap·0.47.0 pickCycle·messages). 뷰어를 만들 때 코어와 함께 나눠 받는다(viewer-ui.ts — core.ts loadViewerCore·viewerUi).
 *
 * - 켜기: 3D 보기(캔버스)에 초점이 있을 때 Enter가 가상 커서를 켠다(캔버스 가운데). 커서가 켜진 동안 화살표는 커서를 옮기고(Shift면 크게),
 *   Tab·Shift+Tab은 그 자리의 후보를 돌리고, Enter는 측정 점을 찍거나 고르고, Esc는 끈다(측정 점이 있으면 측정 지우기가 먼저 — 코어).
 *   커서가 꺼져 있으면 화살표는 앱 것(측정 방향 잠금·재생 걸음·한 가공씩·줄 이동 — keys.ts keyAction)이고, 앱이 쓰지 않는 화살표도 커서를 켜지 않는다.
 * - 고르기 모드(측정이 아닐 때)의 후보는 판재 보기 누르기와 같은 선택(pickCycle — 판이 있으면 판 너머, 아니면 가장 앞)으로 구하고, 앱 단위로 묶어 돌린다:
 *   공구 경로는 코드 줄(블록 — 원호를 나눈 선분·고정 사이클의 이동이 한 줄), 판재는 가공. Tab은 같은 묶음의 다음 선분을 건너뛰어 다음 묶음의 첫 후보로 간다
 *   (코어 후보는 기본 도형 단위라 촘촘한 공구 경로에서 한 줄의 선분으로 찬다 — 코어 0.47.0 README "남은 한계").
 * - 알림: 화면에 보이지 않는 aria-live 영역에 넣는다(화면 읽기 프로그램이 읽는다). 측정 모드는 코어 글(사전의 같은 열쇠 틀 — messages),
 *   고르기 모드는 앱이 묶음 이름(상태 막대의 고른 것과 같은 글 — 줄·이동 종류·공구, 가공 번호·이름)과 묶음 차례로 만든다.
 * - 알림 틀 사전 열쇠: 코어 기본 한국어 틀을 그대로 열쇠로 쓴다. 다만 '{0}축'(axisKind)은 번역층에서 '축'으로 끝나는 모든 글의 틀이 되어
 *   다른 글을 반만 옮겼다('끌어온 축' → '끌어온  axis') — 'X축'·'Y축'·'Z축' 열쇠의 번역에서 축 글자를 {0}으로 바꿔 틀을 만든다(tests/app/keysnap.test.ts).
 *   한글이 없는 틀(candidate·order·point·pickItem·hintJoin)은 네 언어가 같아 넘기지 않는다
 * - 코어의 값(키 글 함수·기본 틀)은 앱이 받아 둔 코어 입구 모듈을 넘겨받아 쓴다(값으로 가져오면 번들러가 코어 keysnap 모듈을 따로 떼어
 *   첫 화면 조각의 나눠 받기 목록이 길어진다)
 */
import type { KeyboardCursorState, KeyboardSnapAnnouncement, KeySnapMessageKey, KeySnapMessages, Pick3d, Viewer3d } from 'opencad-viewer3d';
import { isPanelKind } from '../extensions';
import { translate } from '../../site/i18n-core.mjs';
import { itemName, lineLabel, moveSummary, mprOps, opLabel, type NcDoc } from './doc';
import { h } from './dom';
import { mix, type Mixed } from './filetext';
import { mixText } from './i18n';

/** 코어 기본 한국어 틀이 그대로 사전 열쇠인 알림 틀(한글이 있는 것 — axisKind는 축 열쇠 셋으로, 고르기 종류 pick.*는 앱이 묶음 이름으로 대신한다) */
export const KEY_SNAP_DICT_KEYS = [
  'start',
  'end',
  'only',
  'candidateDistance',
  'noSnap',
  'noPick',
  'picked',
  'pickedNothing',
  'noPoint',
  'firstPoint',
  'secondPoint',
  'lockedKind',
  'hintMove',
  'hintNext',
  'hintCommit',
  'hintPick',
  'hintExit',
  'snap.vertex',
  'snap.endpoint',
  'snap.midpoint',
  'snap.center',
  'snap.point',
  'snap.intersection',
  'snap.perpendicular',
  'snap.axis',
  'snap.parallel',
  'snap.tangent',
  'snap.none',
] as const satisfies readonly KeySnapMessageKey[];

/** 축 이름 사전 열쇠(axisKind 틀 — 'X축'의 번역에서 X를 {0}으로) */
export const AXIS_KEYS = ['X축', 'Y축', 'Z축'] as const;

/** 코어 입구 모듈(앱이 core.ts loadViewerCore로 받은 것) */
type Core = typeof import('opencad-viewer3d');

/** 지금 화면 언어의 알림 틀(defaults = 코어 KEY_SNAP_MESSAGES, tr = 한국어 열쇠 → 그 언어 글). 한국어면 코어 기본과 같다 */
export function keySnapTemplates(defaults: KeySnapMessages, tr: (ko: string) => string): Partial<Record<KeySnapMessageKey, string>> {
  const out: Partial<Record<KeySnapMessageKey, string>> = {};
  for (const k of KEY_SNAP_DICT_KEYS) out[k] = tr(defaults[k]);
  const x = tr(AXIS_KEYS[0]);
  if (x.split('X').length === 2) out.axisKind = x.replace('X', '{0}');
  return out;
}

/** 고르기 후보의 앱 묶음(열쇠가 같으면 같은 것을 고른다)과 이름(상태 막대의 고른 것과 같은 글) */
export function pickTarget(d: NcDoc, p: Pick3d): { key: string; label: Mixed } {
  const nc = d.nc;
  if (nc && !p.section && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-') && p.index >= 0 && p.index < nc.moves.count) {
    // 공구 경로 선분·구멍: 원본 번호 = 이동 번호 → 그 코드 줄(앱 onPick이 줄을 고른다)
    const line = nc.moves.line[p.index]!;
    return { key: `line:${line}`, label: mix`${lineLabel(d, line)} · ${moveSummary(nc, p.index)}` };
  }
  if (isPanelKind(d.kind) && !p.section) {
    const m = /^mpr-op-(\d+)$/.exec(p.id);
    const i = m ? Number(m[1]) : p.id === 'mpr-hole-centers' || p.id === 'mpr-other-pos' ? p.index : -1;
    const op = i >= 0 ? mprOps(d.scene)[i] : undefined;
    if (op) return { key: `op:${i}`, label: mix`가공 ${op.index + 1} · ${opLabel(d, op)}${op.enabled ? '' : ' · 꺼짐'}` };
  }
  const item = p.kind === 'mesh' || p.kind === 'edge' ? d.scene.meshes.find((x) => x.id === p.id) : p.kind === 'line' ? d.scene.lines.find((x) => x.id === p.id) : d.scene.points?.find((x) => x.id === p.id);
  const name = itemName(d, p.id, item?.name, item?.group);
  return p.section ? { key: `cap:${p.id}`, label: mix`${name} · 단면` } : { key: `${p.kind}:${p.id}`, label: name };
}

/** 후보 목록 → 묶음 열쇠(처음 나온 차례)와 후보마다 묶음 차례 */
export function pickGroups(d: NcDoc, list: readonly Pick3d[]): { keys: string[]; of: number[]; first: number[] } {
  const keys: string[] = [];
  const first: number[] = [];
  const of = list.map((p, i) => {
    const k = pickTarget(d, p).key;
    let g = keys.indexOf(k);
    if (g < 0) {
      g = keys.push(k) - 1;
      first.push(i);
    }
    return g;
  });
  return { keys, of, first };
}

/**
 * 묶음 단위 Tab: 지금 후보(index)에서 다음(back이면 앞) 묶음의 첫 후보까지 코어 후보를 몇 번 돌릴지(앞으로 돌리는 수 — back이면 뒤로).
 * 묶음이 하나면 그 묶음의 첫 후보까지(이미 거기면 0)
 */
export function groupSteps(g: { of: number[]; first: number[] }, index: number, back: boolean): number {
  const n = g.of.length;
  const G = g.first.length;
  if (!n || index < 0 || index >= n) return 0;
  const target = g.first[(g.of[index]! + (back ? -1 : 1) + G) % G]!;
  return back ? (index - target + n) % n : (target - index + n) % n;
}

/** 3D 보기 캔버스의 설명(aria-description — 화면 읽기 프로그램이 캔버스 이름 '3D 보기' 뒤에 읽는다, 번역층이 옮긴다) */
export const KEY_HELP = 'Enter로 가상 커서를 켭니다. 화살표로 옮기고 Tab으로 겹친 후보를 돌리고 Enter로 고르거나 찍으며 Esc로 끕니다';

/** 줄 바꿈 없는 빈칸(U+00A0) */
const NBSP = String.fromCharCode(0xa0);

/** 알림의 수 꼴(자리 나눔 쉼표 없이 — 점 글 'X 1, Y 2, Z 3'의 쉼표와 헷갈리지 않게) */
const num = (v: number): string => {
  const r = Number(v.toFixed(3));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
};

/** 앱(app.ts NcViewerApp)이 주는 것 */
export interface KeySnapHost {
  readonly viewer: Viewer3d | null;
  readonly doc: NcDoc | null;
  /** 보기에서 누르면 반투명 판 너머를 고르는지(판재 문서) */
  readonly pickThrough: boolean;
  /** 알림 영역을 넣을 곳(3D 보기) */
  readonly viewEl: HTMLElement;
  /** 키보드로 측정 점을 찍었다(첫 점은 코어 측정 알림이 없다 — 측정 띠·잠금 단추를 맞춘다) */
  keyMeasured(): void;
}

/** 뷰어 하나의 키보드 붙잡기(켜기·묶음 Tab·알림) */
export class KeySnap {
  /** 화면에 보이지 않는 알림 영역(번역층은 건너뛴다 — 지금 언어 글을 넣는다) */
  readonly live: HTMLDivElement;
  private through = false;
  private msgs: KeySnapMessages;
  /** 묶음 Tab이 코어 후보를 여러 번 돌리는 동안 중간 알림을 버린다 */
  private silent = false;

  constructor(
    private readonly host: KeySnapHost,
    private readonly core: Core,
  ) {
    this.msgs = core.KEY_SNAP_MESSAGES;
    this.live = h('div', { class: 'key-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-i18n-skip': true });
    this.live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    host.viewEl.append(this.live);
    host.viewer?.canvas.setAttribute('aria-description', KEY_HELP);
    this.sync();
  }

  /** 켜고(문서·판 너머·언어가 바뀌면 다시) 코어에 선택을 준다 */
  sync(): void {
    const v = this.host.viewer;
    if (!v) return;
    this.through = this.host.pickThrough;
    const lang = document.documentElement.lang || 'ko';
    const messages = keySnapTemplates(this.core.KEY_SNAP_MESSAGES, (ko) => translate(ko, lang));
    this.msgs = this.core.keySnapMessages(messages);
    v.setKeyboardSnap({ pickCycle: { throughTranslucent: this.through }, messages, announce: (a) => this.announce(a) });
  }

  /** 가상 커서(켜져 있지 않으면 null — 가짜 뷰어의 값도 null) */
  get cursor(): KeyboardCursorState | null {
    const c = this.host.viewer?.keyboardCursor as unknown;
    return c && typeof c === 'object' && typeof (c as KeyboardCursorState).x === 'number' ? (c as KeyboardCursorState) : null;
  }

  /**
   * 창 키(캡처 단계, 앱 키보다 먼저). 처리했으면 true(기본 동작·전파를 막았다 — 앱 키도 보지 않는다).
   * - 커서가 꺼져 있으면 캔버스 화살표의 기본 동작만 막는다(앱 화살표는 그대로 keys.ts가 받고, 코어는 막은 키로 커서를 켜지 않는다 — Enter로만 켠다)
   * - 커서가 켜진 고르기 모드의 Tab·Shift+Tab은 앱 묶음 단위로 돌린다(코어 후보를 같은 묶음만큼 건너뛴다).
   *   후보가 둘 미만이거나 코어 후보와 수가 다르면 코어에 그대로 둔다
   */
  key(ev: KeyboardEvent, onCanvas: boolean): boolean {
    if (!onCanvas || ev.altKey || ev.ctrlKey || ev.metaKey || ev.defaultPrevented) return false;
    const c = this.cursor;
    if (!c && ev.key.startsWith('Arrow')) ev.preventDefault();
    const v = this.host.viewer;
    const d = this.host.doc;
    if (ev.key !== 'Tab' || !c || !v || !d || c.mode !== 'pick' || c.count < 2) return false;
    const list = v.pickCandidates(c.x, c.y, { throughTranslucent: this.through, pointerType: this.core.KEY_POINTER });
    if (list.length !== c.count) return false;
    ev.preventDefault();
    ev.stopPropagation();
    const back = ev.shiftKey;
    const steps = groupSteps(pickGroups(d, list), c.index, back);
    if (!steps) {
      // 묶음이 하나뿐이고 이미 그 첫 후보: 코어를 돌리지 않고 '후보 하나'로 알린다
      this.say(this.pickSpeech({ reason: 'cycle', x: c.x, y: c.y, pick: list[c.index] ?? null }));
      return true;
    }
    for (let s = 0; s < steps; s++) {
      this.silent = s < steps - 1;
      v.handleKey(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: back }));
    }
    this.silent = false;
    return true;
  }

  private announce(a: KeyboardSnapAnnouncement): void {
    if (this.silent) return;
    if (a.mode === 'measure' && a.reason === 'commit') this.host.keyMeasured();
    this.say(a.mode === 'pick' && a.reason !== 'end' ? this.pickSpeech(a) : a.text);
  }

  /** 고르기 모드 알림 글: 코어 글 꼴(사전 틀) 그대로, 고른 것 이름은 앱 묶음 이름, 차례는 묶음 차례 */
  private pickSpeech(a: Pick<KeyboardSnapAnnouncement, 'reason' | 'x' | 'y' | 'pick'>): string {
    const k = this.core;
    const M = this.msgs;
    const d = this.host.doc;
    const v = this.host.viewer;
    if (a.reason === 'commit') return a.pick && d ? k.formatKeySnapMessage(M.picked, [mixText(pickTarget(d, a.pick).label)]) : M.pickedNothing;
    let body = M.noPick;
    let groups = 1;
    if (a.pick && d && v) {
      const g = pickGroups(d, v.pickCandidates(a.x, a.y, { throughTranslucent: this.through, pointerType: k.KEY_POINTER }));
      const t = pickTarget(d, a.pick);
      groups = Math.max(1, g.keys.length);
      body = k.orderedText(mixText(t.label), Math.max(0, g.keys.indexOf(t.key)), groups, k.pointText(a.pick.point, num, M), null, M);
    }
    if (a.reason === 'start') {
      const keys = v?.keyboardSnap?.keys;
      return keys ? k.formatKeySnapMessage(M.start, [body, k.keySnapHint(keys, 'pick', true, M)]) : body;
    }
    // 후보가 없는 자리의 Tab은 '고를 것이 없습니다'만(코어도 후보가 하나일 때만 '후보 하나')
    return a.reason === 'cycle' && a.pick && groups === 1 ? k.formatKeySnapMessage(M.only, [body]) : body;
  }

  /** 알림 영역에 넣는다(같은 글이 이어지면 끝에 줄 바꿈 없는 빈칸 하나를 붙였다 떼어 다시 읽게) */
  private say(text: string): void {
    this.live.textContent = this.live.textContent === text ? text + NBSP : text;
  }
}
