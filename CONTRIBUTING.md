# 기여하기

> **English:** Issues and pull requests are welcome in Korean or English.
> Issues are public, so please don't attach confidential drawings or customer files. A small file that shows the same problem, or the program and version that made the file, is enough.
> Run `npm ci`, `npm run typecheck` and `npm test` before opening a pull request. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

OpenCAD NC 뷰어의 버그 신고, 잘못 읽는 파일 제보, 번역 고침, 기능 제안을 반깁니다. 한국어나 영어로 쓰시면 됩니다.
동작을 크게 바꾸거나 새 기능을 더하는 일이면 먼저 이슈로 의논해 주십시오. 참여하는 모든 분은 [행동 강령](CODE_OF_CONDUCT.md)을 따릅니다.

## 파일을 알려 주실 때

- 이슈는 누구나 볼 수 있습니다. 회사 도면, 고객 파일, 공개하지 않은 설계는 올리지 마십시오.
- 같은 문제가 나는 작은 파일을 새로 만들어 올리거나, 파일을 만든 프로그램과 판, 내보내기 설정, 증상을 적어 주십시오.
- 다른 웹페이지에 넣은 `<opencad-viewer>`의 문제는 [opencad-site-kit](https://github.com/GyuTae-Kim/opencad-site-kit/issues)에 올려 주십시오.

## 개발 환경

CI와 같은 Node 22를 씁니다. 구조와 시험은 [README](README.md)의 「개발」에 자세히 있습니다.

```bash
npm ci
npm run dev         # http://localhost:4401/
npm run typecheck
npm test
npm run build       # 형 검사, 빌드, 검색 정보와 다국어 검사
```

## 바꿀 때 지켜 주실 것

- **시험**: 고친 동작과 새 동작에는 `tests/` 아래에 시험을 더합니다. NC 프로그램을 잘못 읽던 문제는 공개해도 되는 최소 재현 자료로 시험합니다.
- **화면 글**: 앱은 한국어, 영어, 일본어, 중국어(간체), 독일어로 나옵니다. 새 한국어 문구는 `site/locales/*.json`의 네 언어 사전에도 더합니다(README 「다국어 UI와 정적 소개」).
- **수정일**: 앱 기능이나 화면이 바뀌면 콘텐츠 수정일을 갱신합니다. 방법은 README 「검색·공유 메타데이터와 콘텐츠 수정일」에 있고, 빠지면 CI의 검색 정보 검사가 실패합니다.
- **사이트 도구**: 다국어 페이지, 검색 정보, 서비스 워커, 방문 통계는 [opencad-site-kit](https://github.com/GyuTae-Kim/opencad-site-kit)에서 옵니다. 그 부분의 문제는 그 저장소에 올려 주십시오.

## PR

- 제목은 이 저장소의 커밋처럼 `[<gitmoji> <동작>] 요약` 꼴로 씁니다(예: `[🐛 fix] 빈 레이어 이름에서 목록이 멈추던 것`).
- 본문에는 바꾼 것, 확인한 것(돌린 명령과 결과, 열어 본 파일), 남은 위험을 적습니다.
- main에 병합되면 GitHub Pages로 자동 배포됩니다.

## 라이선스

보내 주신 기여는 이 저장소와 같은 [MIT 라이선스](LICENSE)로 배포됩니다.
