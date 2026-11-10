// @vitest-environment jsdom
/**
 * 키보드 붙잡기 알림 글 함수(58차 keysnap.ts keySnapMessageFn — 코어 0.53.0 setKeyboardSnap messages 함수)의 순수 부분
 * (고르기 묶음 단위 Tab은 58차부터 코어 pickCycle group — keysnap-core.test.ts).
 * - {N} 자리가 있는 코어 틀은 앱 제 열쇠('[가상 커서 알림] ' + 코어 기본 한국어 틀), 자리가 없는 글은 같은 글 열쇠로 네 언어 사전에 있다.
 *   56·57차가 코어 틀을 그대로 넣은 열쇠('옮기기 {0}' 등)와 축 틀 우회 열쇠('X축'·'Y축'·'Z축')는 사전에 없다
 * - 네 언어 알림 글이 56·57차(코어 틀 열쇠 + 'X축' 번역에서 만든 축 틀)와 같다 — 대표 글을 네 언어로 적어 둔다
 *   (모든 열쇠·붙잡기 종류·축·잠금·차례·거리·키 안내 꼴 3,795가지를 다섯 언어로 견준 것은 58차 확인 — 다른 글 0)
 * - 화면 번역층(site-kit translate)은 사전의 {N} 열쇠를 모든 화면 글의 틀로 맞춰 본다: 제 열쇠는 머리 글이 앱 소스·사전 어디에도 없어 다른 글의 틀이 되지 못하고,
 *   앱 소스의 한글 글·사전 열쇠(값을 채운 꼴)를 알림 열쇠를 뺀 사전과 넣은 사전으로 옮겨도 네 언어 모두 같다.
 *   코어 틀을 그대로 열쇠로 넣으면 '{0}축'은 '끌어온 축'을, '후보 {0}'은 '후보 목록' 같은 글을 반만 옮긴다(56차 우회의 까닭)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as core from 'opencad-viewer3d';
import { KEY_SNAP_KEYS, KEY_SNAP_MESSAGES, candidateText, keySnapHint, keySnapText, type KeySnapMessageKey } from 'opencad-viewer3d';
import { catalogs, registerCatalog, translate } from '../../site/i18n.mjs';
import { KEY_HELP, KEY_SNAP_DICT_PREFIX, dictLookup, keySnapDictKey, keySnapMessageFn } from '../../src/app/keysnap';

const ROOT = resolve(__dirname, '../..');
const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const HANGUL = /[가-힣]/;
const slots = (s: string): string[] => (s.match(/\{\d+\}/g) ?? []).sort();
/** 글 함수가 옮기는 코어 열쇠(한글이 있는 틀 — 고르기 종류 pick.*는 앱이 묶음 이름으로 대신한다) */
const MSG_KEYS = (Object.keys(KEY_SNAP_MESSAGES) as KeySnapMessageKey[]).filter((k) => HANGUL.test(KEY_SNAP_MESSAGES[k]) && !k.startsWith('pick.'));
/** 키보드 붙잡기가 쓰는 사전 열쇠(알림 글·캔버스 설명) */
const ADDED = new Set<string>([...MSG_KEYS.map((k) => keySnapDictKey(KEY_SNAP_MESSAGES[k])), KEY_HELP]);

const saved = Object.fromEntries(LANGS.map((l) => [l, catalogs[l]]));
afterEach(() => {
  for (const l of LANGS) registerCatalog(l, saved[l]);
});

describe('키보드 붙잡기 알림 글 함수(58차 — 코어 0.53.0 messages 함수)', () => {
  it('{N} 틀은 머리를 붙인 제 열쇠, 자리가 없는 글은 같은 글 열쇠로 네 언어 사전에 같은 자리로 있고, 56차 틀 열쇠·축 열쇠는 없다', () => {
    expect(MSG_KEYS).toHaveLength(29);
    const own = MSG_KEYS.filter((k) => /\{\d+\}/.test(KEY_SNAP_MESSAGES[k]));
    expect(own.sort()).toEqual(['axisKind', 'candidateDistance', 'firstPoint', 'hintCommit', 'hintExit', 'hintMove', 'hintNext', 'hintPick', 'lockedKind', 'only', 'picked', 'secondPoint', 'start']);
    for (const k of own) expect(keySnapDictKey(KEY_SNAP_MESSAGES[k])).toBe(KEY_SNAP_DICT_PREFIX + KEY_SNAP_MESSAGES[k]);
    for (const l of LANGS) {
      for (const key of ADDED) {
        const v = catalogs[l][key];
        expect(v, `${l}: ${key}`).toBeTruthy();
        expect(slots(v!), `${l}: ${key}`).toEqual(slots(key));
        expect(HANGUL.test(v!), `${l}: ${key}`).toBe(false);
      }
      for (const k of own) expect(catalogs[l][KEY_SNAP_MESSAGES[k]], `${l}: ${k}`).toBeUndefined();
      for (const a of ['X축', 'Y축', 'Z축']) expect(catalogs[l][a], `${l}: ${a}`).toBeUndefined();
    }
  });

  it('한국어 화면·한글이 없는 틀·고르기 종류는 코어 기본 틀(함수가 undefined), 네 언어 대표 알림 글은 56·57차와 같다', () => {
    const ko = keySnapMessageFn(core, dictLookup('ko'));
    for (const k of Object.keys(KEY_SNAP_MESSAGES) as KeySnapMessageKey[]) expect(ko(k, ['a', 'b', 'c', 'd']), k).toBeUndefined();
    const en = keySnapMessageFn(core, dictLookup('en'));
    for (const k of ['candidate', 'order', 'point', 'pickItem', 'hintJoin', 'pick.line', 'pick.point'] as const) expect(en(k, ['a', 'b', 'c']), k).toBeUndefined();
    // 사전에 없는 열쇠도 코어 기본: 빈 사전, 사전에서 열쇠를 뺐을 때(번역기 틀이 반만 옮긴 글 — 한글이 남는다 — 도 쓰지 않는다)
    expect(keySnapMessageFn(core, () => undefined)('start', ['a', 'b'])).toBeUndefined();
    const lack = KEY_SNAP_DICT_PREFIX + KEY_SNAP_MESSAGES.hintMove;
    registerCatalog('en', Object.fromEntries(Object.entries(saved.en!).filter(([k]) => k !== lack)));
    expect(translate(lack, 'en')).not.toBe('Move {0}');
    expect(dictLookup('en')(lack)).toBeUndefined();
    expect(keySnapMessageFn(core, dictLookup('en'))('hintMove', ['←'])).toBeUndefined();
    registerCatalog('en', saved.en!);
    expect(keySnapMessageFn(core, dictLookup('en'))('hintMove', ['←'])).toBe('Move ←');
    const num = (v: number): string => String(v);
    const say = (l: (typeof LANGS)[number]) => {
      const M = keySnapMessageFn(core, dictLookup(l));
      return [
        keySnapText(M, 'start', [candidateText({ kind: 'endpoint', point: [40, 15, 0] }, 0, 2, num, 5, 'mm', M), keySnapHint(KEY_SNAP_KEYS, 'measure', true, M)]),
        candidateText({ kind: 'axis', axis: 'z', locked: true, point: [0, 0, 1] }, 0, 1, num, null, 'mm', M),
        keySnapText(M, 'secondPoint', ['12 mm', '3', '4', '0']),
        keySnapHint(KEY_SNAP_KEYS, 'pick', true, M),
        keySnapText(M, 'only', ['A']),
        keySnapText(M, 'end'),
      ];
    };
    expect(say('en')).toEqual([
      'Virtual cursor on. Endpoint 1/2: X 40, Y 15, Z 0, distance 5 mm. Move ←→↑↓ · Next candidate Tab · Pick point Enter · Turn off Esc',
      'Z axis on the locked line: X 0, Y 0, Z 1',
      'Second point picked. Distance 12 mm, X difference 3, Y difference 4, Z difference 0',
      'Move ←→↑↓ · Next candidate Tab · Select Enter · Turn off Esc',
      'A (only candidate)',
      'Virtual cursor off',
    ]);
    expect(say('ja')).toEqual([
      '仮想カーソルをオンにしました。端点 1/2: X 40, Y 15, Z 0、距離 5 mm。移動 ←→↑↓ · 次の候補 Tab · 点を打つ Enter · オフ Esc',
      'ロックした線上のZ軸: X 0, Y 0, Z 1',
      '2点目を打ちました。距離 12 mm、X差 3、Y差 4、Z差 0',
      '移動 ←→↑↓ · 次の候補 Tab · 選ぶ Enter · オフ Esc',
      'A（候補は1つだけ）',
      '仮想カーソルをオフにしました',
    ]);
    expect(say('zh-CN')).toEqual([
      '已打开虚拟光标。端点 1/2：X 40, Y 15, Z 0，距离 5 mm。移动 ←→↑↓ · 下一个候选 Tab · 选点 Enter · 关闭 Esc',
      '锁定线上的Z 轴: X 0, Y 0, Z 1',
      '已选第二个点。距离 12 mm，X 差 3，Y 差 4，Z 差 0',
      '移动 ←→↑↓ · 下一个候选 Tab · 选择 Enter · 关闭 Esc',
      'A（只有一个候选）',
      '已关闭虚拟光标',
    ]);
    expect(say('de')).toEqual([
      'Virtueller Cursor eingeschaltet. Endpunkt 1/2: X 40, Y 15, Z 0, Abstand 5 mm. Bewegen ←→↑↓ · Nächster Kandidat Tab · Punkt setzen Enter · Ausschalten Esc',
      'Z-Achse auf der gesperrten Linie: X 0, Y 0, Z 1',
      'Zweiter Punkt gesetzt. Abstand 12 mm, X-Differenz 3, Y-Differenz 4, Z-Differenz 0',
      'Bewegen ←→↑↓ · Nächster Kandidat Tab · Auswählen Enter · Ausschalten Esc',
      'A (einziger Kandidat)',
      'Virtueller Cursor ausgeschaltet',
    ]);
    // 축 이름: 네 언어의 축 셋
    for (const l of LANGS) {
      const M = keySnapMessageFn(core, dictLookup(l));
      expect(['x', 'y', 'z'].map((a) => keySnapText(M, 'axisKind', [a.toUpperCase()])), l).toEqual(
        { en: ['X axis', 'Y axis', 'Z axis'], ja: ['X軸', 'Y軸', 'Z軸'], 'zh-CN': ['X 轴', 'Y 轴', 'Z 轴'], de: ['X-Achse', 'Y-Achse', 'Z-Achse'] }[l],
      );
    }
  });

  it('알림 열쇠가 화면 번역층에서 다른 글(앱 소스 한글 글·사전 열쇠)을 바꾸지 않는다 — 머리 글이 화면 글에 없다', () => {
    const corpus = new Set<string>();
    for (const k of Object.keys(catalogs.en!)) {
      if (ADDED.has(k)) continue;
      if (!/\{\d+\}/.test(k)) corpus.add(k);
      for (const f of ['12', 'T1', '공구', '끝점', 'X']) corpus.add(k.replace(/\{\d+\}/g, f));
    }
    // 키보드 붙잡기 모듈 자신(알림 열쇠 머리·그 설명 주석)은 뺀다
    for (const dir of ['src/app', 'src', 'src/view', 'src/sim'])
      for (const n of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts') && x !== 'keysnap.ts')) {
        const text = readFileSync(join(ROOT, dir, n), 'utf8');
        for (const m of text.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
          const t = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, '7');
          if (!HANGUL.test(t) || t.length > 300) continue;
          for (const piece of [t, ...t.split(/ · |\n/)]) if (HANGUL.test(piece) && !ADDED.has(piece)) corpus.add(piece);
        }
      }
    const list = [...corpus];
    expect(list.length).toBeGreaterThan(3000);
    // 머리 글('[가상 커서 알림] ')은 화면 글·다른 사전 열쇠 어디에도 없다 — 제 열쇠 틀은 다른 글과 맞지 않는다
    const head = KEY_SNAP_DICT_PREFIX.trim();
    expect(list.filter((t) => t.includes(head))).toEqual([]);
    const without = (l: string): Record<string, string> => Object.fromEntries(Object.entries(saved[l]!).filter(([k]) => !ADDED.has(k)));
    for (const l of LANGS) {
      registerCatalog(l, without(l));
      const before = list.map((t) => translate(t, l));
      registerCatalog(l, saved[l]!);
      const after = list.map((t) => translate(t, l));
      expect(list.filter((_, i) => before[i] !== after[i]), l).toEqual([]);
    }
    // 56차 우회의 까닭: 코어 틀을 그대로 열쇠로 넣으면 그 틀로 시작·끝나는 다른 글이 반만 옮겨진다
    registerCatalog('en', { ...saved.en!, '{0}축': '{0} axis', '후보 {0}': 'Next candidate {0}' });
    expect(translate('끌어온 축', 'en')).toBe('끌어온  axis');
    expect(translate('후보 목록', 'en')).toBe('Next candidate 목록');
    registerCatalog('en', saved.en!);
    expect(translate('끌어온 축', 'en')).toBe('끌어온 축');
    expect(translate('후보 목록', 'en')).toBe('후보 목록');
  });
});
