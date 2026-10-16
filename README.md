# OpenCAD NC 해석기

NC 프로그램(G-code·Heidenhain 평문·woodWOP MPR)을 브라우저 안에서 읽어 3D 공구 경로 장면으로 만듭니다.
DOM·WebGL에 기대지 않아 웹 워커에서 돌 수 있고, 결과 장면(`Scene3d`)은 [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)로 그립니다.
다른 NC 해석 라이브러리를 쓰지 않고 공개 자료만 보고 새로 작성했습니다.

함께 쓰는 저장소: [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)(3D 뷰어 코어) ·
[opencad-step](https://github.com/GyuTae-Kim/opencad-step) · [opencad-skp](https://github.com/GyuTae-Kim/opencad-skp)

## 할 수 있는 것

- G-code(ISO·Fanuc·LinuxCNC·GRBL·Mach3 방언 자동 판별): 직선·호·나선, 평면·단위·좌표계, 고정 사이클, 부프로그램, 변수와 IF/WHILE
- Heidenhain 평문(.h)
- woodWOP MPR: 공작물, 수직·수평 드릴, 윤곽 가공, 홈, 포켓, 꺼진 가공, 변수
- 공구 목록(색·지름), 이송·급속 길이, 예상 시간, 줄 번호 ↔ 이동 연결
- 100만 줄(32MB) G-code를 약 0.5초에 읽습니다.

## 쓰는 법

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
| `src/index.ts` | 공개 입구: 형식 판별, `parseNcFile`, `ncParsedToScene`, `loadNcFile` |
| `src/gcode.ts`, `src/expr.ts` | G-code 해석과 변수·식 |
| `src/heidenhain.ts` | Heidenhain 평문 |
| `src/mpr.ts` | woodWOP MPR |
| `src/model.ts`, `src/emitter.ts`, `src/text.ts` | 공통 이동 모델·시간표, 이동 만들기, 원문 줄 |
| `src/scene.ts`, `src/mesh.ts` | 공구 경로·공작물 → `Scene3d` |
| `src/view/` | 화면에서 쓰던 도우미: 재생 계산(`playback.ts`), 합성 예제 프로그램(`sample.ts`), 선분 강조 덧그림(`overlay.ts`), 가상 목록(`vlist.ts`, `vlist.css`) |

## 개발

```bash
npm install
npm run typecheck
npm test
```

3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.1.0`으로 받습니다. 코어를 올리면 `package.json`의 태그를 바꿉니다.

## 남은 일

- 회전축(4·5축)·선반 코드
- 반경 보정 경로, 좌표 회전·배율
- Heidenhain FK·포켓 사이클
- MPR 나머지 매크로·좌표계

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/2dcad-viewer)의 `src/formats/nc/`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
`src/view/`의 파일은 같은 커밋의 `src/app/view3d/`에서 옮겼습니다.
2D 뷰어 안에서 NC 파일을 3D 탭으로 열던 화면(코드 보기·공구 목록·재생 패널, 리본, 웹 워커 — `src/app/view3d/manager.ts`·`panel.ts` 등)은
2D 뷰어 화면 골격에 붙어 있어 옮기지 않았고, 그 커밋의 2dcad-viewer에 남아 있습니다.

## 라이선스

MIT
