/**
 * 경고 글 번역(30차): 화면 번역은 사전 틀({0})이 잡은 값을 옮기지 않는다(문서 자료일 수 있어서). 그래서 이유 글을 끼운 경고와
 * 정보 탭 목록에 글 하나로 들어가는 보정 경로 경고("보정 경로: N번 줄: …")는 사전 열쇠가 그 전체 꼴이어야 한국어가 남지 않는다.
 * - 보정 경로: 실제 해석으로 낸 경고(공구 반지름 모름·보정을 켠·끈 첫 이동이 원호·안쪽 원호 반지름)와 comp.ts의 나머지 글 꼴 모두
 * - Heidenhain FK의 그리지 않는 이유 여섯과 MPR 윤곽 모서리 둥글리기·모따기를 넣지 못한 이유 일곱(해석기가 쓰는 글 꼴 그대로)
 * - 뜻이 틀렸던 옛 번역(앞 절반이 빠진 영어·독일어, "해"를 해(太陽)로 옮긴 일본어)
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseForView } from '../src/app/payload';

const hangul = /[가-힣]/;
const codes = languages.filter((l: { code: string }) => l.code !== 'ko').map((l: { code: string }) => l.code);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const compWarnings = (text: string): string[] => (parseForView('c.nc', enc(text), { comp: true }).scene.warnings ?? []).filter((w) => w.startsWith('보정 경로: '));

describe('보정 경로 경고(정보 탭 목록 — 글 하나로)', () => {
  it('실제 해석으로 낸 경고가 네 언어에서 한국어 없이 옮겨진다', () => {
    const got = [
      // 공구 반지름을 모름
      ...compWarnings(['G21 G90 G17', 'G0 X0 Y0 Z0', 'G41 D7 G1 X10 F100', 'Y10', 'G40 X0', 'M2'].join('\n')),
      // 공구 지름 10: 보정을 켠 첫 이동·끈 첫 이동이 원호
      ...compWarnings(['G21 G90 G17', '(T1 D=10. FLAT END MILL)', 'T1 M6', 'G0 X-20 Y0 Z0', 'G41 D1 G2 X0 Y20 R20 F100', 'G1 X40', 'G40 G2 X60 Y0 R20', 'M2'].join('\n')),
      // 공구 지름 10: 왼쪽 보정에서 반시계 원호 R3(안쪽 — 공구 반지름 5보다 작다)
      ...compWarnings(['G21 G90 G17', '(T1 D=10. FLAT END MILL)', 'T1 M6', 'G0 X-20 Y-20 Z0', 'G41 D1 G1 X0 Y0 F100', 'G1 X20', 'G3 X26 Y0 R3', 'G1 X60', 'G40 G1 X70 Y-20', 'M2'].join('\n')),
    ];
    const want = ['공구 반지름을 몰라', '보정을 켠 첫 이동이 원호', '보정을 끈 첫 이동이 원호 — 현(직선)으로 나옴', '안쪽 원호 반지름'];
    for (const w of want) expect(got.some((g) => g.includes(w)), w).toBe(true);
    for (const t of got) for (const code of codes) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate(got.find((g) => g.includes('공구 반지름을 몰라'))!, 'en')).toBe('Compensation path: Line 3: Compensation section (line 3): tool radius unknown — the compensation path is not drawn');
  });

  it('comp.ts의 모든 글 꼴(줄 번호 있음·없음, 숫자 자리)', () => {
    const texts = [
      '보정 경로: 12번 줄: 보정 구간(12번 줄): 공구 반지름을 몰라 보정 경로를 그리지 않음',
      '보정 경로: 12번 줄: 보정 평면 밖의 원호는 현(직선)으로 보고 보정함',
      '보정 경로: 12번 줄: 안쪽 원호 반지름(3)이 공구 반지름(5)보다 작거나 같음 — 보정 경로가 뒤집힘',
      '보정 경로: 5번 줄: 보정 구간(5번 줄): 선반 공구 방향(1~9)을 몰라 노즈 반지름 중심 경로로 그림',
      '보정 경로: 선반 공구 방향 번호는 LinuxCNC 설명서의 그림대로 읽음 — 다른 컨트롤러는 번호가 다를 수 있음',
      '보정 경로: 12번 줄: 보정을 켠 첫 이동이 원호 — 현(직선)으로 들어감',
      '보정 경로: 6번 줄: 들어가기 이동 길이(3)가 공구 반지름(5)보다 짧음 — LinuxCNC 설명서는 반지름 이상을 요구',
      '보정 경로: 12번 줄: 안쪽 모서리에서 옮긴 요소가 만나지 않음(요소가 공구 반지름보다 짧음) — 간섭 가능, 직선으로 이음',
      '보정 경로: 12번 줄: 보정한 직선이 거꾸로 됨(요소가 공구 지름보다 짧음) — 간섭 가능',
      '보정 경로: 12번 줄: 보정한 원호가 남지 않음(모서리 교점이 원호를 넘음) — 간섭 가능, 직선으로 이음',
      '보정 경로: 12번 줄: 보정을 끈 첫 이동이 원호 — LinuxCNC는 오류로 멈춤(현(직선)으로 그림)',
      '보정 경로: 12번 줄: 보정을 끈 첫 이동이 원호 — 현(직선)으로 나옴',
      '보정 경로: 12번 줄: 보정을 끈 뒤 첫 직선 이동 길이(6)가 공구 지름(10)보다 짧음 — LinuxCNC는 오류로 멈춤',
      '보정 경로: 4번 줄: 보정 구간(4번 줄)에 간섭 의심 3곳',
    ];
    for (const t of texts) for (const code of codes) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate(texts[13]!, 'en')).toBe('Compensation path: Line 4: 3 suspected gouges in the compensation section (line 4)');
    expect(translate(texts[2]!, 'de')).toBe('Korrekturweg: Zeile 12: Innerer Bogenradius (3) ist kleiner oder gleich dem Werkzeugradius (5) — der Korrekturweg kehrt sich um');
    // 묶음 이름(범례)도 같은 낱말
    expect(translate('보정 경로', 'en')).toBe('Compensation path');
    expect(translate('보정 경로', 'zh-CN')).toBe('补偿路径');
  });
});

describe('이유 글을 끼운 해석 경고(정보 탭 — 줄 번호와 따로)', () => {
  it('Heidenhain FK: 그리지 않는 이유 여섯', () => {
    for (const why of ['끝점을 정할 자료가 모자람', '원호 끝점이 없음', '끝 좌표가 원 밖', '원호 중심·끝점을 정할 자료가 모자람', '시작점과 끝점이 같음', '원호 중심·반지름이 없음'])
      for (const kind of ['FL', 'FC', 'FLT'])
        for (const code of codes) expect(translate(`${kind}: ${why} — 다음 블록 자료가 필요한 FK는 그리지 않음`, code), `${code}: ${kind} ${why}`).not.toMatch(hangul);
    expect(translate('FC: 원호 중심·끝점을 정할 자료가 모자람 — 다음 블록 자료가 필요한 FK는 그리지 않음', 'en')).toBe(
      'FC: not enough data to find the arc center and end point — FK that needs data from following blocks is not drawn',
    );
  });

  it('MPR 윤곽: 모서리 둥글리기·모따기를 넣지 못한 이유 일곱', () => {
    for (const why of ['모서리가 겹침', '앞뒤 요소가 직선·원호가 아님', '모서리가 꺾이지 않음', '크기가 변보다 큼', '뒤에 요소가 없음', '길이가 없는 요소', '되돌아가는 모서리'])
      for (const type of ['KR', 'KF'])
        for (const code of codes) expect(translate(`윤곽 요소 ${type}(모서리 둥글리기·모따기): ${why} — 모서리 그대로 그림`, code), `${code}: ${type} ${why}`).not.toMatch(hangul);
    expect(translate('윤곽 요소 KR(모서리 둥글리기·모따기): 크기가 변보다 큼 — 모서리 그대로 그림', 'en')).toBe('Contour element KR (corner rounding/chamfer): the size is larger than the side — corner drawn unchanged');
  });

  it('뜻이 틀렸던 옛 번역', () => {
    expect(translate('뒤에 정의된 변수를 쓰는 변수 식이 있음 — 정의 차례와 상관없이 풀어 계산함', 'en')).toBe('Some variable expressions use variables defined later — solved regardless of definition order');
    expect(translate('뒤에 요소가 없음', 'en')).toBe('No element follows');
    expect(translate('G2: 반지름·끝점만으로는 해가 둘 — 짧은 호로 그림', 'ja')).not.toContain('太陽');
    for (const code of codes) expect(translate('뒤에 정의된 변수를 쓰는 변수 식이 있음 — 정의 차례와 상관없이 풀어 계산함', code), code).not.toMatch(/^\s*[—–]/);
  });
});
