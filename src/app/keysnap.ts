/**
 * 3D 보기 키보드 붙잡기·고르기(56차 — 3D 뷰어 코어 0.46.0 setKeyboardSnap·0.47.0 pickCycle·messages, 58차 — 0.53.0 pickCycle group·messages 글 함수). 뷰어를 만들 때 코어와 함께 나눠 받는다(viewer-ui.ts — core.ts loadViewerCore·viewerUi).
 *
 * - 켜기: 3D 보기(캔버스)에 초점이 있을 때 Enter가 가상 커서를 켠다(캔버스 가운데). 커서가 켜진 동안 화살표는 커서를 옮기고(Shift면 크게),
 *   Tab·Shift+Tab은 그 자리의 후보를 돌리고, Enter는 측정 점을 찍거나 고르고, Esc는 끈다(측정 점이 있으면 측정 지우기가 먼저 — 코어).
 *   커서가 꺼져 있으면 화살표는 앱 것(측정 방향 잠금·재생 걸음·한 가공씩·줄 이동 — keys.ts keyAction)이고, 앱이 쓰지 않는 화살표도 커서를 켜지 않는다.
 * - 고르기 모드(측정이 아닐 때)의 후보는 판재 보기 누르기와 같은 선택(pickCycle — 판이 있으면 판 너머, 아니면 가장 앞)으로 구하고, 앱 단위로 묶어 돌린다:
 *   공구 경로는 코드 줄(블록 — 원호를 나눈 선분·고정 사이클의 이동이 한 줄), 판재는 가공. 58차: 묶음 열쇠(pickTarget)를 코어 pickCycle group으로 줘
 *   코어가 같은 묶음을 가장 앞의 후보 하나로 센다 — 후보 한도(16)·Tab 차례·알림 수가 묶음 단위다(56·57차는 코어 후보를 기본 도형 단위로 받아
 *   앱이 같은 묶음만큼 합성 Tab을 보내 건너뛰어, 한 줄의 원호 선분이 16개를 채우는 아주 촘촘한 자리에서는 뒤의 줄·가공이 목록에 들지 못했다).
 * - 알림: 화면에 보이지 않는 aria-live 영역에 넣는다(화면 읽기 프로그램이 읽는다). 측정 모드는 코어 글(앱 글 함수 — messages),
 *   고르기 모드는 앱이 묶음 이름(상태 막대의 고른 것과 같은 글 — 줄·이동 종류·공구, 가공 번호·이름)과 코어 알림의 묶음 차례·수로 만든다.
 * - 알림 글 함수(58차 — 코어 0.53.0 messages 함수, keySnapMessageFn): 코어 열쇠와 값을 받아 지금 언어 사전에서 바로 옮긴다.
 *   {N} 자리가 있는 틀은 앱 제 열쇠(머리 KEY_SNAP_DICT_PREFIX + 코어 기본 한국어 틀), 자리가 없는 글(붙잡기 종류 이름·'가상 커서를 껐습니다' 등)은 같은 글 열쇠로 찾는다.
 *   화면 번역층(site-kit translate)은 사전의 {N} 열쇠를 모든 화면 글의 틀로 맞춰 보는데, 제 열쇠는 머리 글이 화면 글에 없어 다른 글의 틀이 되지 못한다
 *   (56·57차는 코어 틀을 그대로 열쇠로 넣어 '옮기기 {0}'·'후보 {0}'·'{0} (후보 하나)' 같은 짧은 틀이 앞으로 더할 화면 글의 틀이 될 수 있었고,
 *   '{0}축'은 '끌어온 축'을 반만 옮겨 넣지 못해 'X축' 번역에서 축 틀을 만들었다 — tests/app/keysnap.test.ts).
 *   한국어 화면·한글이 없는 틀(candidate·order·point·pickItem·hintJoin)·고르기 종류(pick.* — 앱이 묶음 이름으로 대신)·사전에 없는 열쇠는 undefined(코어 기본 틀)
 * - 코어의 값(키 글 함수·기본 틀)은 앱이 받아 둔 코어 입구 모듈을 넘겨받아 쓴다(값으로 가져오면 번들러가 코어 keysnap 모듈을 따로 떼어
 *   첫 화면 조각의 나눠 받기 목록이 길어진다)
 */
import type { KeyboardCursorState, KeyboardSnapAnnouncement, KeySnapMessageFn, KeySnapNumberFn, KeySnapText, Pick3d, Viewer3d } from 'opencad-viewer3d';
import { isPanelKind } from '../extensions';
import { translate } from '../../site/i18n-core.mjs';
import { itemName, lineLabel, moveSummary, mprOps, opLabel, type NcDoc } from './doc';
import { h } from './dom';
import { mix, type Mixed } from './filetext';
import { mixText } from './i18n';

/** 코어 입구 모듈(앱이 core.ts loadViewerCore로 받은 것) */
type Core = typeof import('opencad-viewer3d');

/** {N} 자리가 있는 알림 틀의 앱 사전 열쇠 머리(화면 글에 없는 글 — 그 열쇠가 화면 번역층에서 다른 글의 틀이 되지 않게) */
export const KEY_SNAP_DICT_PREFIX = '[가상 커서 알림] ';

/** 코어 기본 한국어 틀 → 앱 사전 열쇠: {N} 자리가 있으면 머리를 붙인 제 열쇠, 없으면 같은 글 */
export function keySnapDictKey(ko: string): string {
  return /\{\d+\}/.test(ko) ? KEY_SNAP_DICT_PREFIX + ko : ko;
}

/** 사전 열쇠 하나 → 지금 언어 글(없으면 undefined) */
export type DictLookup = (key: string) => string | undefined;

/**
 * 언어 lang의 사전 찾기: 번역기(translate)는 같은 글 열쇠를 먼저 찾는다. 한국어·사전에 없는 열쇠·한글이 남은 글(틀이 반만 옮긴 것)은 undefined.
 * 사전 객체(catalogs)를 바로 가져오지 않는 것은 첫 화면 조각이 다른 조각에 내보내는 이름을 늘리지 않으려는 것(translate는 이미 내보낸다)
 */
export function dictLookup(lang: string): DictLookup {
  return (key) => {
    const t = translate(key, lang);
    return t === key || /[가-힣]/.test(t) ? undefined : t;
  };
}

/**
 * 알림 글 함수(코어 0.53.0 setKeyboardSnap messages): 열쇠의 코어 기본 틀로 지금 언어 사전(lookup)의 글을 찾아 값을 끼운다.
 * 한글이 없는 틀·고르기 종류(pick.*)·사전에 없는 열쇠(한국어 화면 포함)는 undefined(코어가 기본 틀로 만든다)
 */
export function keySnapMessageFn(core: Pick<Core, 'KEY_SNAP_MESSAGES' | 'formatKeySnapMessage'>, lookup: DictLookup): KeySnapMessageFn {
  return (key, values) => {
    const ko: string | undefined = core.KEY_SNAP_MESSAGES[key];
    if (!ko || key.startsWith('pick.') || !/[가-힣]/.test(ko)) return undefined;
    const t = lookup(keySnapDictKey(ko));
    return t === undefined ? undefined : core.formatKeySnapMessage(t, values);
  };
}

/** 고르기 후보의 앱 묶음(열쇠가 같으면 같은 것을 고른다 — 코어 pickCycle group 열쇠)과 이름(상태 막대의 고른 것과 같은 글) */
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

/** 3D 보기 캔버스의 설명(aria-description — 화면 읽기 프로그램이 캔버스 이름 '3D 보기' 뒤에 읽는다, 번역층이 옮긴다) */
export const KEY_HELP = 'Enter로 가상 커서를 켭니다. 화살표로 옮기고 Tab으로 겹친 후보를 돌리고 Enter로 고르거나 찍으며 Esc로 끕니다';

/** 줄 바꿈 없는 빈칸(U+00A0) */
const NBSP = String.fromCharCode(0xa0);

/** 알림의 수 꼴(자리 나눔 쉼표 없이 — 점 글 'X 1, Y 2, Z 3'의 쉼표와 헷갈리지 않게) */
const num = (v: number): string => {
  const r = Number(v.toFixed(3));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
};

/**
 * 측정 모드 알림의 점 좌표·거리 글(61차 — 코어 0.56.0 formatNumber): 코어 기본(장면 크기를 따라 자릿수가 바뀌는 측정 글 자릿수) 대신 제어기 위치 표시처럼
 * 고정 소수 셋째 자리(인치 넷째)로. 고르기 모드는 앱 글(pickSpeech)이 그대로 num을 쓴다. 코어는 formatNumber를 주면 거리에 단위를 붙이지 않아 코어 단위 글을 잇는다
 */
export function keySnapNumber(units: string | undefined): KeySnapNumberFn {
  const digits = units === 'inch' ? 4 : 3;
  const zero = `-${(0).toFixed(digits)}`;
  return (v, core) => {
    if (!Number.isFinite(v)) return core.text;
    const s = v.toFixed(digits);
    const t = s === zero ? s.slice(1) : s;
    return core.kind === 'distance' && core.unit ? `${t} ${core.unit}` : t;
  };
}

/** 앱(app.ts NcViewerApp)이 주는 것 */
export interface KeySnapHost {
  readonly viewer: Viewer3d | null;
  readonly doc: NcDoc | null;
  /** 보기에서 누르면 반투명 판 너머를 고르는지(판재 문서) */
  readonly pickThrough: boolean;
  /** 알림 영역을 넣을 곳(3D 보기) */
  readonly viewEl: HTMLElement;
  /**
   * 키보드로 측정 점을 찍었다(첫 점은 코어 측정 알림이 없다 — 측정 띠·잠금 단추를 맞춘다).
   * 57차: 측정 모드의 가상 커서를 켜고 옮기고 끄고 후보를 돌릴 때도 부른다(포인터 이동이 없다 — 붙잡기 툴팁·방향 잠금 안내를 맞춘다)
   */
  keyMeasured(): void;
}

/** 뷰어 하나의 키보드 붙잡기(켜기·묶음 열쇠·알림) */
export class KeySnap {
  /** 화면에 보이지 않는 알림 영역(번역층은 건너뛴다 — 지금 언어 글을 넣는다) */
  readonly live: HTMLDivElement;
  private through = false;
  /** 지금 언어의 알림 글 함수(sync — 처음은 코어 기본 틀) */
  private msgs: KeySnapText;
  /** 고르기 후보 묶음 열쇠(코어 pickCycle group — 지금 문서의 pickTarget 열쇠, 문서가 없으면 묶지 않는다) */
  private readonly group = (p: Pick3d): string | undefined => {
    const d = this.host.doc;
    return d ? pickTarget(d, p).key : undefined;
  };

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
    const messages = keySnapMessageFn(this.core, dictLookup(lang));
    this.msgs = messages;
    v.setKeyboardSnap({ pickCycle: { throughTranslucent: this.through, group: this.group }, messages, formatNumber: keySnapNumber(this.host.doc?.scene.units), announce: (a) => this.announce(a) });
  }

  /** 가상 커서(켜져 있지 않으면 null — 가짜 뷰어의 값도 null) */
  get cursor(): KeyboardCursorState | null {
    const c = this.host.viewer?.keyboardCursor as unknown;
    return c && typeof c === 'object' && typeof (c as KeyboardCursorState).x === 'number' ? (c as KeyboardCursorState) : null;
  }

  /**
   * 창 키(캡처 단계, 앱 키보다 먼저). 처리해 앱 키가 보지 않아야 하면 true — 58차부터는 늘 false(앱 키가 이어 받는다):
   * 커서가 꺼져 있으면 캔버스 화살표의 기본 동작만 막는다(앱 화살표는 그대로 keys.ts가 받고, 코어는 막은 키로 커서를 켜지 않는다 — Enter로만 켠다).
   * 고르기 모드 Tab은 코어가 묶음 단위로 돌린다(pickCycle group — 56·57차의 합성 Tab을 뺐다). app.ts의 부름 꼴은 56차 그대로 둔다(첫 화면 조각을 main 이하로)
   */
  key(ev: KeyboardEvent, onCanvas: boolean): boolean {
    if (onCanvas && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.defaultPrevented && !this.cursor && ev.key.startsWith('Arrow')) ev.preventDefault();
    return false;
  }

  private announce(a: KeyboardSnapAnnouncement): void {
    if (a.mode === 'measure') this.host.keyMeasured();
    this.say(a.mode === 'pick' && a.reason !== 'end' ? this.pickSpeech(a) : a.text);
  }

  /** 고르기 모드 알림 글: 코어 글 꼴(알림 글 함수) 그대로, 고른 것 이름은 앱 묶음 이름, 차례·수는 코어 알림의 묶음 차례·수(pickCycle group) */
  private pickSpeech(a: Pick<KeyboardSnapAnnouncement, 'reason' | 'pick' | 'index' | 'count'>): string {
    const k = this.core;
    const M = this.msgs;
    const d = this.host.doc;
    if (a.reason === 'commit') return a.pick && d ? k.keySnapText(M, 'picked', [mixText(pickTarget(d, a.pick).label)]) : k.keySnapText(M, 'pickedNothing');
    const body = a.pick && d ? k.orderedText(mixText(pickTarget(d, a.pick).label), a.index, Math.max(1, a.count), k.pointText(a.pick.point, num, M), null, M) : k.keySnapText(M, 'noPick');
    if (a.reason === 'start') {
      const keys = this.host.viewer?.keyboardSnap?.keys;
      return keys ? k.keySnapText(M, 'start', [body, k.keySnapHint(keys, 'pick', true, M)]) : body;
    }
    // 후보가 없는 자리의 Tab은 '고를 것이 없습니다'만(코어도 후보가 하나일 때만 '후보 하나')
    return a.reason === 'cycle' && a.pick && a.count === 1 ? k.keySnapText(M, 'only', [body]) : body;
  }

  /** 알림 영역에 넣는다(같은 글이 이어지면 끝에 줄 바꿈 없는 빈칸 하나를 붙였다 떼어 다시 읽게) */
  private say(text: string): void {
    this.live.textContent = this.live.textContent === text ? text + NBSP : text;
  }
}
