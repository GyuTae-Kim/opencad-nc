# 보안 문제 신고

> **English:** Please report vulnerabilities privately through
> [GitHub's private vulnerability reporting](https://github.com/GyuTae-Kim/opencad-nc/security/advisories/new).
> If that form isn't available, open an issue asking for a contact, without technical details. Only the deployed app (the `main` branch) is supported.

## 신고하는 곳

[GitHub 비공개 취약점 신고](https://github.com/GyuTae-Kim/opencad-nc/security/advisories/new)로 알려 주십시오.
신고 내용은 관리자에게만 보입니다.
그 양식이 열리지 않으면 공개 이슈에 재현 방법이나 공격 방법은 쓰지 말고, 연락 방법만 요청해 주십시오.

## 지원하는 판

배포된 앱([gyutae-kim.github.io/opencad-nc](https://gyutae-kim.github.io/opencad-nc/), `main` 브랜치)만 고칩니다. 고친 내용은 `main`에 병합되면 바로 배포됩니다.

## 특히 살펴 주실 곳

- **파일 읽기**
  - 조작한 NC 프로그램로 앱이 멈추거나(끝나지 않는 반복, 메모리를 끝없이 씀) 탭이 죽는 길
  - 파일 안의 글(주석, 공구 이름, 프로그램 이름)이 페이지에 HTML이나 스크립트로 들어가는 길
- **다른 웹페이지에 넣었을 때**
  - 앱은 바로 위 부모가 보낸 파일만 받고, 답은 그 글을 보낸 출처로만 보내야 합니다.
  - 파일 개수(32개)와 크기(1 GiB) 확인, 이름 검사를 우회하는 길이 있으면 알려 주십시오.
- **서비스 워커와 방문 통계**: 다른 출처의 응답을 담거나 내주는 길, 파일 이름이나 내용이 통계로 나가는 길

다국어 페이지, 검색 정보, 서비스 워커, 방문 통계, 임베드 수신기는 공용 도구 [opencad-site-kit](https://github.com/GyuTae-Kim/opencad-site-kit)에서 옵니다.
그 코드의 문제는 [opencad-site-kit의 비공개 신고](https://github.com/GyuTae-Kim/opencad-site-kit/security/advisories/new)로 알려 주셔도 됩니다.
