# OpenCAD NC 뷰어 · 해석기

NC 프로그램(G-code·Heidenhain 평문·woodWOP MPR)을 브라우저 안에서 읽어 3D 공구 경로로 보여 주는 뷰어 앱과, 그 해석기 라이브러리입니다.
해석기는 DOM·WebGL에 기대지 않아 웹 워커에서 돌고, 결과 장면(`Scene3d`)은 [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)로 그립니다.
다른 NC 해석 라이브러리를 쓰지 않고 공개 자료만 보고 새로 작성했습니다.

- 뷰어(배포 예정): https://gyutae-kim.github.io/opencad-nc/
- 함께 쓰는 저장소: [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)(3D 뷰어 코어) ·
  [opencad-step](https://github.com/GyuTae-Kim/opencad-step) · [opencad-skp](https://github.com/GyuTae-Kim/opencad-skp) · [OpenCAD 도구 모음](https://gyutae-kim.github.io/opencad)

## 할 수 있는 것

- G-code(ISO·Fanuc·LinuxCNC·GRBL·Mach3 방언 자동 판별): 직선·호·나선, 평면·단위·좌표계, 고정 사이클, 부프로그램, 변수와 IF/WHILE
  - 좌표 변환: G68/G69 회전(Mach3 G68 A·B 중심), G51/G50 배율(Fanuc 중심 + P·I·J·K, Mach3 축별 배율), G51.1/G50.1 거울,
    LinuxCNC G10 L2 R 좌표계 회전 — 원호·고정 사이클 구멍도 함께 옮김
  - 반경 보정 G41/G42/G40: 프로그램 경로는 그대로 두고, 선택하면 공구 중심 경로를 따로 계산(직선·호 모서리 교점 자르기,
    바깥 모서리 호 잇기, 들어가기·나오기, 간섭 경고). 반지름은 D 번호 → 공구 표(선택)·G10 L12/L13(Fanuc)·G10 L1 R(LinuxCNC·Mach3)·
    G41.1 D 지름·공구 주석 지름(`T1 D=10.`) 차례로 찾음
  - 선반 모드(선택): G18, X 지름(LinuxCNC·GRBL은 G7/G8), U·W 증분, T0101, G96/G97 주속 일정(G50 S·G96 D 최고 회전수로 시간 계산),
    G90/G92/G94 단순 사이클, G70~G73 복합 사이클(거친 깎기·다듬질·형상 반복), G74/G75 쪼아 깎기, G76 나사(여러 번), G32/G33 —
    XZ 단면 경로(X = 반지름, 회전축 = Z). 선반 프로그램처럼 보이면 밀링으로 읽을 때 안내 경고
  - 회전축 A·B·C(선택): 각을 X·Y·Z축 둘레로 감아 공작물 기준 공구 끝 경로(각이 바뀌는 이동은 2도씩 나눔, 시간은 직선·각 합성 길이).
    G43.4/G43.5 공구 끝점 제어 동안은 프로그램 좌표를 그대로 공구 끝 경로로 그림
- Heidenhain 평문(.h): L·C·CR·CT·LP·CP, FK 자유 윤곽(FPOL·FL·FLT·FC·FCT — 한 블록 자료로 정해지는 것), RL/RR 반경 보정(TOOL DEF R + DR),
  드릴 사이클 200~209·240, 밀링 사이클 208(보어 나선)·251(사각 포켓)·252(원 포켓)·253(홈)·256/257(보스)·232(정면), 점 패턴 220/221,
  LBL·CALL LBL(구간 반복·부프로그램, 따옴표 표지), Q 변수·FN
- woodWOP MPR: 공작물, 수직·수평 드릴, 윤곽 가공(KR 둥글리기·KF 모따기 포함), 홈, 포켓, 꺼진 가공, 변수(뒤에 정의된 변수도 풂),
  지원하지 않는 매크로는 위치(XA·YA)만 점으로
- 공구 목록(색·지름), 이송·급속 길이, 예상 시간, 줄 번호 ↔ 이동 연결
- 100만 줄(30MB) G-code를 약 0.5~0.6초에 읽습니다(선택 기능을 켜지 않으면 예전과 같은 경로).

## 뷰어 앱 쓰는 법

1. 파일을 창 어디에나 끌어다 놓거나 **열기**(Ctrl/⌘+O)를 누릅니다. **예제 열기**는 코드로 만든 합성 G-code를 엽니다.
   파일은 서버로 올리지 않고 이 기기 안에서 읽습니다(해석은 웹 워커).
2. 가운데 3D 보기: 왼쪽 끌기 회전, 가운데·오른쪽 끌기 이동, 휠 확대(터치는 한 손가락 회전·두 손가락 이동·핀치).
   터치는 10화소(코어 `TOUCH_DRAG_START_PX`)보다 덜 움직이고 떼면 누르기로 보고(6~9화소 떨려도 모형이 돌지 않음),
   누르기·측정 점은 선분에서 14화소(코어 `touchPickTolerance` 기본값) 안이면 고르며 끝점에서 14화소 안이면 끝점에 붙잡습니다(마우스는 6·10화소 그대로).
   보기 도구 막대에 전체 보기, 표준 뷰, 원근/평행, 그리기 모드(음영·음영+모서리·와이어프레임·X-ray), 격자, 뷰 큐브, 좌표축,
   **단면**(끔·X·Y·Z 축 고르기, 위치 슬라이더, 뒤집기 — 새 문서를 열면 꺼짐), 두 점 측정, PNG 저장, 패널 열고 닫기가 있습니다.
   읽는 동안 덮개의 **취소**(또는 Esc)로 멈추면 열려 있던 문서를 그대로 둡니다.
3. 오른쪽 패널(폭 760px 미만이면 아래 시트)
   - G-code·Heidenhain: **코드**(줄을 누르면 그 줄의 이동을 강조, 3D에서 경로를 누르면 그 줄로 이동) ·
     **공구**(색·지름·시간, 켜고 끄기. 줄을 누르면 그 공구의 첫 이동 줄로, 두 번 누르면 그 공구 경로에 맞춰 보기) ·
     **정보**(방언·단위 바꿔 다시 읽기, 보기 선택 — **보정 경로 보기**(구간별 반지름·출처)·**선반 모드**·**회전축 감기**, 이송/급속 길이,
     예상 시간, 묶음 켜고 끄기, 해석 경고)
   - MPR: **가공**(작업 목록) · **변수** · **코드** · **정보**(꺼진 가공이 있으면 **꺼진 가공도 그리기**)
   - 재생 막대: 재생/멈춤, ×1·×10·×100, 시간 막대 — 지나간 경로만 진하게 그리고 공구 위치를 표시합니다.
4. 아래 상태 막대에 형식·단위·파일 크기·이동/선분 수·읽은 시간, 해석 경고 수(누르면 정보 탭)와 고른 것(줄·이동·측정 거리)이 보입니다.
5. 휴대폰·터치: 폭 760px 미만이거나 휴대폰 가로 화면(손가락 기기에 높이 500px 미만)에서는 도구 막대를 한 줄(전체 보기·표준 뷰·보기 설정·단면·측정·재생·패널)로 줄이고,
   뷰 큐브를 작게, 패널은 처음엔 닫아 둡니다.
   원근/평행·그리기 모드·격자·뷰 큐브·좌표축·PNG 저장은 "보기 설정" 메뉴로 모읍니다.
   좁은 화면이나 손가락 기기에서 측정을 켜면 3D 보기 아래 가운데 띠에 다음에 누를 곳, 거리와 dx·dy·dz를 크게 보이고,
   "다시 재기"(찍은 점과 결과 지우기)와 ✕(측정 끝내기) 단추를 둡니다(Esc 대신, 시트 패널을 열지 않아도 됩니다).
   측정 중 한 손가락을 거의 움직이지 않고(10화소 안) 길게(0.35초) 누르면 손가락 위 64px에 십자선이 떠 정밀 조준합니다 — 끌면 십자선이 따라가고
   (붙잡을 점·거리를 미리 보입니다) 떼면 그 자리를 누른 것으로 칩니다. 십자선 자리는 보통 터치 누르기(14화소)가 아니라
   마우스와 같은 좁은 허용 거리(선분 6화소, 끝점 10화소 — 코어에 펜 포인터로 알림)로 골라, 구멍·선분이 빽빽한 곳에서도 미리 본 점이 그대로 찍힙니다.
   둘째 손가락이 닿으면 조준을 그만두고 두 손가락 이동·확대로 넘어갑니다.
   손가락 기기의 안내에는 키(Esc) 설명 대신 길게 누르기를 적고, 파일 고르기 상자는 확장자로 거르지 않습니다
   (iOS에서 .nc·.mpr 등이 흐리게 막히지 않게 — 모르는 확장자는 앞부분을 보고 이진 파일을 바로 막고, 글 파일은 내용으로 형식을 가립니다).
6. 최근 문서: 파일 고르기·끌어다 놓기로 열린 파일은 이 브라우저의 IndexedDB(`opencad-nc`)에 새것부터 8개까지 두고
   (60MB 넘는 파일, 예제, `?open=`으로 받은 파일은 두지 않음), 시작 화면의 **최근 문서**에서 이름·크기·연 시각을 보고 눌러 다시 엽니다.
   휴대폰 브라우저가 뒤로 간 탭을 버렸다가 다시 읽어도 파일 앱을 다시 거치지 않습니다. 줄마다 ✕(그 항목만 지우기)와 **모두 지우기**가 있고,
   서버로는 보내지 않습니다(비공개 창처럼 저장소를 못 쓰면 목록이 생기지 않습니다). 읽는 동안 덮개(취소 가능)를 보이고,
   저장된 내용이 없으면 그 항목을 지우되 잠깐 못 읽었으면(연결 끊김 등) 항목을 두고 다시 눌러 보라고 알립니다.
   iOS에서 홈 화면에 추가한 앱은 Safari와 저장 공간이 따로라, Safari에서 연 최근 문서는 홈 화면 앱에 보이지 않습니다(반대도 같음).
7. 홈 화면에 추가: 웹 앱 매니페스트(`public/manifest.webmanifest` — 이름 "OpenCAD NC 뷰어", 짧은 이름 "NC 뷰어", `standalone`)와
   192·512·maskable 512 아이콘, iOS용 180px `apple-touch-icon.png`로 휴대폰 홈 화면에서 주소 막대 없이 앱처럼 엽니다.
   영어·일본어·중국어·독일어 페이지는 빌드 때 번역해 만든 `<언어>/manifest.webmanifest`(그 언어 페이지에서 시작)를 씁니다.
   서비스 워커는 두지 않아 오프라인으로는 열리지 않습니다. 홈 화면 앱에서는 제목 막대를 상태 막대(노치) 아래로 내리고,
   제목·상태 막대를 아래로 당겨도 페이지를 새로 읽지 않습니다(`overscroll-behavior-y: none` — 코드 목록·패널·시작 화면은 그대로 굴러갑니다).

| 키 | 하는 일 |
|---|---|
| F | 전체 보기 |
| 1~7 | 앞·뒤·왼쪽·오른쪽·위·아래·등각 |
| F7 | 격자 켜고 끄기 |
| Space | 재생 / 멈춤 |
| Esc | 측정·고른 것 지우기(읽는 중이면 읽기 멈추기) |
| Ctrl/⌘+O | 파일 열기 |

주소 인자: `?sample`(예제 바로 열기), `?open=<같은 출처 주소>`(그 파일을 받아 열기 — 자동 확인용, 다른 사이트 주소는 열지 않음).
테마는 시스템 설정을 따르고, 제목 막대 단추로 고른 테마는 이 브라우저에 기억합니다.
자동 확인용으로 `window.opencadApp`(상태 `state`, `open`·`openSample`·`openUrl`·`reparse`·`cancel`·`setSection` 등)을 둡니다.

## 라이브러리로 쓰는 법

```ts
import { loadNcFile } from 'opencad-nc';

const { parsed, scene } = loadNcFile('part.nc', bytes); // 형식은 앞부분·확장자로 자동 판별
// parsed.kind: 'gcode' | 'heidenhain' | 'mpr'
// scene: Scene3d (opencad-viewer3d의 Viewer3d.setScene에 넘긴다)
```

형식별 함수(`parseGcode`, `parseHeidenhain`, `parseMpr`, `ncToScene`, `mprToScene`)와 확장자 목록(`NC_EXTENSIONS` 등)도 `src/index.ts`에서 내보냅니다.

선택 기능(기본은 모두 꺼짐 — 켜지 않으면 결과가 예전과 같습니다):

```ts
// 선반 모드('auto'면 글로 판별), 회전축 감기, 반경 보정용 공구 표(키 = D 번호, LinuxCNC는 공구 번호)
const p = parseGcode(text, { lathe: true, rotary: { A: 'x', stepDeg: 2 }, toolTable: { 1: { diameter: 10 } } });
p.compRuns; // 보정 구간 [{ first, end, side, plane, radius, source, line }]
const scene = ncToScene(p, { compPath: true }); // 선분 묶음 'nc-comp'(묶음 '보정 경로'), meta.compRuns
const cp = ncCompPath(p, { radius: 5 }); // 조각(직선·호) 구조 배열 — compPathSegments(cp)로 선분
```

## 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `public/favicon.svg` | 뷰어 앱 진입(제목·설명·테마 먼저 정하기, 홈 화면 앱 머리 태그) |
| `public/manifest.webmanifest`, `public/icon-*.png`, `public/apple-touch-icon.png` | 홈 화면에 추가(웹 앱 매니페스트·아이콘 — `favicon.svg` 그림을 Chrome으로 그려 만듦). 다른 언어 매니페스트는 `tools/site-metadata.mjs`가 만든다 |
| `src/app/` | 뷰어 앱 화면: `app.ts`(틀·열기·보기·재생·키), `panel.ts`(코드·공구·정보·가공·변수 탭), `doc.ts`(문서 상태·요약 글), `protocol.ts`·`payload.ts`·`client.ts`(워커 메시지·이전 목록), `format.ts`·`keys.ts`·`theme.ts`(글·키·테마), `recent.ts`(최근 문서, IndexedDB), `styles.css` |
| `src/worker/parse.worker.ts` | 해석 워커: 파일 확인 → 해석 → 장면·패널 자료를 이전 가능한 버퍼로 돌려줌 |
| `src/index.ts` | 공개 입구: 형식 판별, `parseNcFile`, `ncParsedToScene`, `loadNcFile` |
| `src/extensions.ts` | 확장자 목록(`NC_EXTENSIONS` 등 — 화면 코드가 해석기 없이 가져다 쓴다) |
| `src/gcode.ts`, `src/expr.ts` | G-code 해석(좌표 변환·선반·회전축 포함)과 변수·식 |
| `src/comp.ts` | 반경 보정 공구 중심 경로(옮긴 요소, 모서리 교점·호 잇기, 들어가기·나오기) |
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

3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.6.0`(잠금 커밋 `d6e9ed3`)으로 받습니다. 코어를 올리면
`npm install "opencad-viewer3d@github:GyuTae-Kim/opencad-viewer3d#<태그>"`로 받아 `package.json`·`package-lock.json`을 함께 바꿉니다(그냥 `npm install`은 옛 커밋을 남김).
표본·임시 파일은 `.runtime/`(git 무시)에 둡니다.

## 배포

`main`에 올리면 `.github/workflows/deploy.yml`이 형식 검사 → 시험 → 빌드 뒤 `dist/`를 `gh-pages` 가지에 게시합니다
(GitHub Pages: https://gyutae-kim.github.io/opencad-nc/). 끌어오기 요청은 `ci.yml`이 같은 확인을 합니다.

## 남은 일

- 5축: 공구 끝점 제어 없는 동시 5축(기계 구조·피벗 길이가 필요), 공구 방향 표시, G68.2·Heidenhain PLANE·M128·회전축 감기(Heidenhain)
- 반경 보정: Fanuc B형·C형 들어가기(교점 방식)·보정 중 평면 바꾸기·G41/G42 방향 바꿀 때의 교점, 선반 공구 끝 R 보정(G41/G42 노즈 R)
- 선반: Fanuc G 코드 B·C 체계(G77~G79), LinuxCNC G70~G72(o-코드 윤곽), G71 II형(오목 윤곽), 나사 사이클의 모따기·절입 각
- Heidenhain: 다음 블록 자료가 필요한 FK(PDX·RX·PAR, FSELECT), RND·CHF, 윤곽(SL) 사이클 20~25·270, 회전·배율·대칭 사이클 7.x 밖의 것,
  PATTERN DEF, CALL PGM
- MPR: 좌표계 표 `[K`·KO(면 좌표계), BohrUniv 등 나머지 매크로(지금은 위치만 점), 호가 낀 모서리의 KR·KF
- G16 극좌표, LinuxCNC 스플라인(G5) 곡선

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/opencad-dwgdxf)의 `src/formats/nc/`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
`src/view/`의 파일은 같은 커밋의 `src/app/view3d/`에서 옮겼습니다.
2D 뷰어 안에서 NC 파일을 3D 탭으로 열던 화면(코드 보기·공구 목록·재생 패널, 웹 워커 — 같은 커밋의 `src/app/view3d/manager.ts`·`panel.ts` 등)은
2D 화면 골격(리본·탭)에 기대지 않게 다시 짜서 `src/app/`·`src/worker/`의 혼자 돌아가는 뷰어 앱으로 옮겼습니다.

## 라이선스

MIT


## 검색·공유 메타데이터와 콘텐츠 수정일

`site/metadata.json`을 공통 원본으로 삼아 Vite 플러그인이 제목·설명·canonical·Open Graph·Twitter Card·JSON-LD를 초기 HTML에 넣습니다. 같은 원본으로 앱의 공개 주소를 담은 `sitemap.xml`도 생성합니다. 공유 이미지는 각 앱의 `public/og-opencad.jpg`이며 앱 파일과 함께 배포합니다. `robots.txt`는 같은 호스트 루트(`https://gyutae-kim.github.io/robots.txt`)의 설정이 적용됩니다.

`site/content-history.json`에는 실제 콘텐츠 수정 시각과 지문을 저장합니다. 초기 HTML 본문·메타데이터·공유 이미지와 빌드된 앱/워커 JavaScript·CSS를 비교하므로 앱 기능이 바뀌면 날짜 갱신이 필요합니다. 수정일 자체와 소스 맵은 비교에서 제외합니다.

1. 콘텐츠를 변경한 실제 UTC 시각을 기록하고 `npm run update:content-dates -- --at YYYY-MM-DDTHH:mm:ssZ`를 실행합니다.
2. `npm run build`로 다시 빌드합니다. 변경되지 않은 콘텐츠는 기존 날짜를 유지하며, 날짜가 오래되었거나 잘못된 경우 SEO 검사가 실패해 배포를 막습니다.
3. `npm run test:seo`와 기존 테스트를 실행하고 메타데이터·수정일 기록을 함께 커밋합니다.

일반 빌드나 배포 시각으로 날짜를 자동 갱신하지 않습니다. `sitemap.xml`의 `lastmod`와 앱 구조화 데이터의 `dateModified`는 동일한 기록을 사용합니다. 배포 뒤에는 앱·사이트맵·공유 이미지의 실제 공개 응답을 확인하고, 포트폴리오 통합 사이트맵의 연결 날짜도 새 앱 사이트맵과 맞춥니다. 사이트맵 게시와 검색엔진의 실제 수집·색인 완료는 별도로 확인합니다.


## 다국어 UI와 정적 소개

한국어 기본 주소와 영어(`/en/`), 일본어(`/ja/`), 중국어 간체(`/zh-CN/`), 독일어(`/de/`) 페이지를 제공합니다. 각 언어의 소개 본문과 검색·공유 메타데이터를 빌드할 때 생성하며, `hreflang`과 사이트맵이 같은 페이지의 언어들을 연결합니다. `site/locales/*.json`에 한국어 원문과 번역을 저장하고, 브라우저는 선택한 언어의 사전만 내려받습니다. 방문 중 외부 번역 서비스는 호출하지 않습니다.

우측 상단 지구본 아이콘에서 언어를 선택합니다. 방향키로 이동하고 Escape나 바깥 클릭으로 닫을 수 있습니다. 언어 선택은 URL에 반영하며, 열린 문서나 편집 상태를 다시 만들지 않고 화면 문구·접근성 설명·오류·도움말을 갱신합니다. 명령 식별자·입력값·파일명·모델 이름·원본 도면의 문자는 번역하지 않습니다. 새 데이터 이름을 표시하는 요소에는 `translate="no"`를 지정하고, UI 문구의 `{0}` 같은 변수 자리를 변경하지 마세요. 여러 줄 메시지와 새 한국어 문구도 번역 사전에 추가해야 합니다.

`npm run test:i18n`은 언어 전환과 문서 데이터 보존을, `npm run check:i18n`은 다섯 언어의 정적 소개·canonical·언어 링크·사전 변수·에셋 경로를 검사합니다. 번역이나 앱을 수정하면 기존 콘텐츠 수정일 갱신 절차를 따른 뒤 다시 빌드합니다. 자동 번역 초안의 주요 메뉴와 제품명은 교정했으며, 긴 기술 설명에는 추가 원어민 감수가 필요합니다.
