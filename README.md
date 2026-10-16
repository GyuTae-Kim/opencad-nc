# OpenCAD NC 뷰어 · 해석기

NC 프로그램(G-code·Heidenhain 평문·woodWOP MPR)을 브라우저 안에서 읽어 3D 공구 경로로 보여 주는 뷰어 앱과, 그 해석기 라이브러리입니다.
해석기는 DOM·WebGL에 기대지 않아 웹 워커에서 돌고, 결과 장면(`Scene3d`)은 [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)로 그립니다.
다른 NC 해석 라이브러리를 쓰지 않고 공개 자료만 보고 새로 작성했습니다.

- 뷰어(배포 예정): https://gyutae-kim.github.io/opencad-nc/
- 함께 쓰는 저장소: [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)(3D 뷰어 코어) ·
  [opencad-step](https://github.com/GyuTae-Kim/opencad-step) · [opencad-skp](https://github.com/GyuTae-Kim/opencad-skp) · [OpenCAD 도구 모음](https://gyutae-kim.github.io/opencad)

## 할 수 있는 것

- G-code(ISO·Fanuc·LinuxCNC·GRBL·Mach3 방언 자동 판별): 직선·호·나선, 평면·단위·좌표계, 고정 사이클, 부프로그램, 변수와 IF/WHILE
- Heidenhain 평문(.h)
- woodWOP MPR: 공작물, 수직·수평 드릴, 윤곽 가공, 홈, 포켓, 꺼진 가공, 변수
- 공구 목록(색·지름), 이송·급속 길이, 예상 시간, 줄 번호 ↔ 이동 연결
- 100만 줄(32MB) G-code를 약 0.5초에 읽습니다.

## 뷰어 앱 쓰는 법

1. 파일을 창 어디에나 끌어다 놓거나 **열기**(Ctrl/⌘+O)를 누릅니다. **예제 열기**는 코드로 만든 합성 G-code를 엽니다.
   파일은 서버로 올리지 않고 이 기기 안에서 읽습니다(해석은 웹 워커).
2. 가운데 3D 보기: 왼쪽 끌기 회전, 가운데·오른쪽 끌기 이동, 휠 확대(터치는 한 손가락 회전·두 손가락 이동·핀치).
   보기 도구 막대에 전체 보기, 표준 뷰, 원근/평행, 그리기 모드(음영·음영+모서리·와이어프레임·X-ray), 격자, 뷰 큐브, 좌표축, 두 점 측정, PNG 저장, 패널 열고 닫기가 있습니다.
3. 오른쪽 패널(폭 760px 미만이면 아래 시트)
   - G-code·Heidenhain: **코드**(줄을 누르면 그 줄의 이동을 강조, 3D에서 경로를 누르면 그 줄로 이동) · **공구**(색·지름·시간, 켜고 끄기) ·
     **정보**(방언·단위 바꿔 다시 읽기, 이송/급속 길이, 예상 시간, 묶음 켜고 끄기, 해석 경고)
   - MPR: **가공**(작업 목록) · **변수** · **코드** · **정보**
   - 재생 막대: 재생/멈춤, ×1·×10·×100, 시간 막대 — 지나간 경로만 진하게 그리고 공구 위치를 표시합니다.
4. 아래 상태 막대에 형식·단위·파일 크기·이동/선분 수·읽은 시간과 고른 것(줄·이동·측정 거리)이 보입니다.

| 키 | 하는 일 |
|---|---|
| F | 전체 보기 |
| 1~7 | 앞·뒤·왼쪽·오른쪽·위·아래·등각 |
| F7 | 격자 켜고 끄기 |
| Space | 재생 / 멈춤 |
| Esc | 측정·고른 것 지우기 |
| Ctrl/⌘+O | 파일 열기 |

주소 인자: `?sample`(예제 바로 열기), `?open=<같은 출처 주소>`(그 파일을 받아 열기 — 자동 확인용, 다른 사이트 주소는 열지 않음).
테마는 시스템 설정을 따르고, 제목 막대 단추로 고른 테마는 이 브라우저에 기억합니다.
자동 확인용으로 `window.opencadApp`(상태 `state`, `open`·`openSample`·`openUrl` 등)을 둡니다.

## 라이브러리로 쓰는 법

```ts
import { loadNcFile } from 'opencad-nc';

const { parsed, scene } = loadNcFile('part.nc', bytes); // 형식은 앞부분·확장자로 자동 판별
// parsed.kind: 'gcode' | 'heidenhain' | 'mpr'
// scene: Scene3d (opencad-viewer3d의 Viewer3d.setScene에 넘긴다)
```

형식별 함수(`parseGcode`, `parseHeidenhain`, `parseMpr`, `ncToScene`, `mprToScene`)와 확장자 목록(`NC_EXTENSIONS` 등)도 `src/index.ts`에서 내보냅니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `public/favicon.svg` | 뷰어 앱 진입(제목·설명·테마 먼저 정하기) |
| `src/app/` | 뷰어 앱 화면: `app.ts`(틀·열기·보기·재생·키), `panel.ts`(코드·공구·정보·가공·변수 탭), `doc.ts`(문서 상태·요약 글), `protocol.ts`·`payload.ts`·`client.ts`(워커 메시지·이전 목록), `format.ts`·`keys.ts`·`theme.ts`(글·키·테마), `styles.css` |
| `src/worker/parse.worker.ts` | 해석 워커: 파일 확인 → 해석 → 장면·패널 자료를 이전 가능한 버퍼로 돌려줌 |
| `src/index.ts` | 공개 입구: 형식 판별, `parseNcFile`, `ncParsedToScene`, `loadNcFile` |
| `src/extensions.ts` | 확장자 목록(`NC_EXTENSIONS` 등 — 화면 코드가 해석기 없이 가져다 쓴다) |
| `src/gcode.ts`, `src/expr.ts` | G-code 해석과 변수·식 |
| `src/heidenhain.ts` | Heidenhain 평문 |
| `src/mpr.ts` | woodWOP MPR |
| `src/model.ts`, `src/emitter.ts`, `src/text.ts` | 공통 이동 모델·시간표, 이동 만들기, 원문 줄 |
| `src/scene.ts`, `src/mesh.ts` | 공구 경로·공작물 → `Scene3d` |
| `src/view/` | 화면 도우미: 재생 계산(`playback.ts`), 합성 예제 프로그램(`sample.ts`), 가상 목록(`vlist.ts`, `vlist.css`) |
| `tests/`, `tests/app/` | 해석기 시험, 앱 순수 로직 시험(글·키·테마·이전 목록·문서 모델) |

## 개발

```bash
npm install
npm run dev        # http://localhost:4401/ (예: /?sample)
npm run typecheck
npm test
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 빌드 결과 보기
```

3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.3.0`으로 받습니다. 코어를 올리면 `package.json`의 태그를 바꿉니다.
표본·임시 파일은 `.runtime/`(git 무시)에 둡니다.

## 배포

`main`에 올리면 `.github/workflows/deploy.yml`이 형식 검사 → 시험 → 빌드 뒤 `dist/`를 `gh-pages` 가지에 게시합니다
(GitHub Pages: https://gyutae-kim.github.io/opencad-nc/). 끌어오기 요청은 `ci.yml`이 같은 확인을 합니다.

## 남은 일

- 회전축(4·5축)·선반 코드
- 반경 보정 경로, 좌표 회전·배율
- Heidenhain FK·포켓 사이클
- MPR 나머지 매크로·좌표계

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/2dcad-viewer)의 `src/formats/nc/`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
`src/view/`의 파일은 같은 커밋의 `src/app/view3d/`에서 옮겼습니다.
2D 뷰어 안에서 NC 파일을 3D 탭으로 열던 화면(코드 보기·공구 목록·재생 패널, 웹 워커 — 같은 커밋의 `src/app/view3d/manager.ts`·`panel.ts` 등)은
2D 화면 골격(리본·탭)에 기대지 않게 다시 짜서 `src/app/`·`src/worker/`의 혼자 돌아가는 뷰어 앱으로 옮겼습니다.

## 라이선스

MIT
