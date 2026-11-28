/**
 * 해석 판단 띠(3D 보기 위 — 선반 자동·소수점 없는 좌표·판별한 방언·선반 G 코드 체계·여러 파일 작업·찾지 못한 프로그램)의 글과 줄 그리기.
 *
 * 216차: 문서가 있을 때만 쓰므로 첫 화면 JS(app.ts renderNotices 몸통·doc.ts noticeViews)에서 옮겼다. 코어처럼 꼭 있어야 하는 조각이라
 * core.ts loadViewerCore가 코어와 함께 받는다(받지 못하면 코어를 받지 못한 것과 같은 길 — 문서를 열지 않고 3D 보기 실패 알림).
 * 문서는 그 약속 뒤에만 생겨(app.ts setDoc) 띠를 그릴 때는 늘 받아 있다 — 받는 중 깃발·받은 뒤 다시 그리기가 없고 그리는 차례는 전과 같다(동기).
 * 받지 못해도 문서를 여는 조각(정보 탭 panel-info·3D 보기 띠 viewer-ui)에 넣지 않은 까닭: 그 조각이 늦거나 받지 못하면 띠가 빠진다
 * (tests/app/core-split.test.ts가 이 모듈이 첫 화면 그래프 밖이고 core.ts의 import() 하나로만 받는지, 옮긴 함수가 첫 화면 모듈로 돌아오지 않는지 본다)
 */
import type { NcDoc, PanelTab } from './doc';
import { h, mixSpan } from './dom';
import { fileText, mix, type Mixed } from './filetext';
import { mixText } from './i18n';
import { icon } from './icons';
import type { NcOpenOptions } from './protocol';

/** 해석 판단 띠 하나: 글과 행동(다른 설정으로 다시 읽기, 또는 패널 탭 열기) */
export interface NoticeView {
  key: string;
  /** 글(주 프로그램·찾지 못한 프로그램 이름은 파일 글) */
  text: Mixed;
  /** opts = 그 설정으로 다시 읽기, tab = 패널 탭 열기, add = 이 작업에 파일 더하기 */
  action?: { label: string; opts?: NcOpenOptions; tab?: PanelTab; add?: boolean };
}

const DIALECT_NOTICE: Record<string, string> = {
  siemens: 'Siemens Sinumerik 프로그램으로 읽었습니다(판별).',
  haas: 'Haas 프로그램으로 읽었습니다(판별) — G73·G83의 K는 최소 절입(반복은 L), G70~G72는 볼트 구멍 패턴, G110~G129는 좌표계로 봅니다.',
  'heidenhain-iso': 'Heidenhain DIN/ISO 프로그램으로 읽었습니다(판별).',
  okuma: 'Okuma OSP 프로그램으로 보입니다 — CALL·VC 변수·NLAP는 읽지 않아 경로가 모자랄 수 있습니다(G15 H 좌표계는 읽음).',
};

const LATHE_SYSTEM_NOTICE: Record<string, string> = {
  B: 'Fanuc 선반 G 코드 B 체계로 읽었습니다(판별) — G77·G78·G79는 단순 사이클, G90·G91은 절대·증분 지령입니다.',
  C: 'Fanuc 선반 G 코드 C 체계로 읽었습니다(판별) — G20·G21·G24는 단순 사이클, G70·G71은 inch·mm, G72~G78은 복합 사이클입니다.',
};

/** 문서의 해석 판단 → 띠(닫은 것은 뺀다) */
export function noticeViews(d: Pick<NcDoc, 'nc' | 'ncOptions' | 'dismissedNotices'> & Partial<Pick<NcDoc, 'job'>>): NoticeView[] {
  const out: NoticeView[] = [];
  const job = d.job;
  if (job && (job.files.length > 1 || job.skipped.length) && !d.dismissedNotices.has('job')) {
    const skipped = job.skipped.length ? ` · 잇지 않은 파일 ${job.skipped.length}개` : '';
    out.push({ key: 'job', text: mix`파일 ${job.files.length}개를 한 작업으로 읽었습니다 — 주 프로그램 ${fileText(job.main)}${skipped}`, action: { label: '작업 파일', tab: 'info' } });
  }
  for (const n of d.nc?.notices ?? []) {
    let v: NoticeView | null = null;
    if (n.kind === 'lathe-auto') v = { key: 'lathe-auto', text: ['선반 프로그램으로 보여 선반 모드(X 지름·선반 사이클·XZ 단면)로 읽었습니다.'], action: { label: '밀링으로 읽기', opts: { ...d.ncOptions, lathe: false } } };
    else if (n.kind === 'integer-units')
      v = { key: 'integer-units', text: ['소수점 없는 큰 좌표가 많습니다 — 최소 입력 단위(0.001 mm·0.0001 inch)로 쓴 Fanuc 프로그램일 수 있습니다.'], action: { label: '최소 단위로 읽기', opts: { ...d.ncOptions, integerUnits: true } } };
    else if (n.kind === 'dialect' && n.dialect && DIALECT_NOTICE[n.dialect]) v = { key: `dialect-${n.dialect}`, text: [DIALECT_NOTICE[n.dialect]!], action: { label: 'G-code 형식 바꾸기', tab: 'info' } };
    else if (n.kind === 'lathe-system' && n.system) {
      const text =
        n.system === 'A'
          ? `Fanuc 선반 G 코드 B·C 체계일 수 있습니다(${(n.hints ?? []).join(' · ')}) — A 체계(G90·G92·G94 단순 사이클)로 읽었습니다.`
          : LATHE_SYSTEM_NOTICE[n.system]!;
      v = { key: `lathe-system-${n.system}`, text: [text], action: { label: '체계 바꾸기', tab: 'info' } };
    }
    else if (n.kind === 'missing-program' && n.programs?.length) {
      // 프로그램 이름(CALL PGM "…"·부프로그램 이름)은 파일 글
      const names = fileText(n.programs.length > 6 ? `${n.programs.slice(0, 6).join(', ')}, …` : n.programs.join(', '));
      v = { key: 'missing-program', text: mix`다른 파일의 프로그램 ${names}을(를) 찾지 못했습니다 — 그 파일을 더하면 이어서 그립니다.`, action: { label: '파일 더하기', add: true } };
    }
    if (v && !d.dismissedNotices.has(v.key)) out.push(v);
  }
  return out;
}

/** 띠를 그리는 앱(app.ts NcViewerApp) */
export interface NoticeHost {
  /** 판단 띠(3D 보기 위 — 줄을 담는다) */
  readonly noticeBar: HTMLElement;
  /** 미리 붙여 둔 알림 영역(198차 — 새로 나온 줄의 글만 넣는다) */
  readonly said: HTMLElement;
  /** 지난번 그린 줄의 열쇠(같은 줄은 다시 그려도 알리지 않는다) */
  saidKeys: string[];
  readonly viewer: { readonly canvas: HTMLElement } | null;
  readonly panel: { show(d: NcDoc): void };
  chooseFile(add?: boolean): void;
  reparse(opts: NcOpenOptions): Promise<void>;
  togglePanel(on?: boolean): void;
  /** 띠를 다시 그린다(✕로 닫은 뒤) */
  renderNotices(keep?: boolean): void;
}

/** 열린 문서 d의 판단 띠를 그린다(app.ts renderNotices가 문서가 있을 때 부른다 — 216차에 그 몸통을 옮김) */
export function renderNotices(host: NoticeHost, d: NcDoc, keep: boolean): void {
  const bar = host.noticeBar;
  // 176차: 줄을 모두 새로 만들어 띠 안 초점(✕·다시 읽은 뒤의 동작 버튼)이 문서로 빠진다 — 그 안이었으면 같은 차례(모자라면 마지막) 줄의 같은 자리 버튼(✕면 ✕, 아니면 첫 버튼),
  // 띠가 숨으면 3D 보기로. 밖이었으면 그대로. keep = false(새 문서 — setDoc이 곧 3D 보기로 둔다)는 되살리지 않는다
  const had = document.activeElement;
  const at = keep && had && bar.contains(had) ? [...bar.children].findIndex((r) => r.contains(had)) : -1;
  bar.replaceChildren();
  const list = noticeViews(d);
  bar.hidden = !list.length;
  // 198차: 띠가 알림 영역(role=status)이면 숨김을 줄과 함께 풀어(열기·다시 읽기는 덮개가 inert를 거둔 같은 차례) 첫 줄을 읽지 않을 수 있었고, 그릴 때마다
  // 줄을 새로 붙여 언어 바꿈·✕에도 남은 줄을 동작 버튼·「이 안내 닫기」 이름까지 다시 읽었다 — 새로 나온 줄(새 문서면 모든 줄)의 글만 미리 붙여 둔 알림 영역에
  const old = keep ? host.saidKeys : [];
  const fresh: (string | Node)[] = [];
  host.saidKeys = list.map((n) => n.key);
  for (const n of list) {
    if (!old.includes(n.key)) fresh.push(mixSpan(n.text), ' ');
    // 좁은 화면은 글을 한두 줄로 줄여 보이고(3D 보기를 덜 가리게), 글을 누르면 펼친다
    // 글에 파일 글(주 프로그램·찾지 못한 프로그램 이름)이 섞인다 — 지금 언어로 옮겨 담는다(54차)
    const text = mixSpan(n.text, 'nt-text');
    text.title = mixText(n.text);
    const row = h('div', { class: 'notice', 'data-notice': n.key }, text);
    text.addEventListener('click', () => row.classList.toggle('open'));
    if (n.action) {
      const act = n.action;
      const b = h('button', { class: 'mb-btn', type: 'button' }, act.label);
      b.addEventListener('click', () => {
        if (act.add) host.chooseFile(true);
        else if (act.opts) void host.reparse(act.opts);
        else if (act.tab) {
          d.panelTab = act.tab;
          host.panel.show(d);
          host.togglePanel(true);
        }
      });
      row.append(b);
    }
    const x = h('button', { class: 'mb-btn icon', type: 'button', title: '이 안내 닫기', 'aria-label': '이 안내 닫기', html: icon('close') });
    x.addEventListener('click', () => {
      d.dismissedNotices.add(n.key);
      host.renderNotices();
    });
    row.append(x);
    bar.append(row);
  }
  if (fresh.length) host.said.replaceChildren(...fresh);
  if (at >= 0) {
    const row = bar.children[Math.min(at, bar.children.length - 1)];
    (row ? row.querySelector<HTMLElement>(had!.matches('.icon') ? '.icon' : 'button') : host.viewer?.canvas)?.focus({ preventScroll: true });
  }
}
