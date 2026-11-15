# 📝 제2의 뉴런 (Zen Reader PWA) 작업 로그 (WORKLOG)

## 2026-11-15

### v22 — 오프라인 Mermaid 다이어그램·구문 강조·반투명 Fast-Scroll TOC ([7490ae7a](conversation://7490ae7a-b4d7-4398-b1c4-eb134df92552))
- **커밋**: `876e381` (`origin/main` 푸시 완료)
- **변경 파일**: `api/lib/notion.js`, `public/css/app.css`, `public/index.html`, `public/js/app.js`, `public/js/reader.js`, `public/js/vendor/mermaid.min.js`, `public/sw.js`, `scripts/test-cache-return.js`
- **핵심 내역**:
  1. 노션 `mermaid` 코드 블록(`flowchart TD/LR` 등)을 로컬 `mermaid.min.js`(SW `zen-reader-v22` 프리캐시)로 4대 테마 연동 SVG 순서도로 렌더링하고, 카드 내 `한눈에`/`둘러보기`(2D 터치 드래그·핀치 줌·마우스 휠), 모달 전용 `90° 가로` 회전(`.mermaid-zoom-box.is-rotated` + 회전 좌표계 보정 + `맞춤`), `원본 코드` 토글 지원.
  2. 코드/마크다운 블록 단일 하늘색 하드코딩을 제거해 XSS-안전 단일 패스 구문 강조(`Reader.highlightCode`) 및 4대 테마 토큰 색상 적용. `heading_4`(`<h4>`), 블록 단위 `color`(Callout 배경색), `theme-green` `.notion-color-*` 보완.
  3. 우측 목차 레일(`#zen-toc-rail`) 미사용 시 반투명(`.is-idle`) 감쇠 및 터치/마우스 드래그 시 실시간 말풍선(`#zen-toc-scrub-pill`)·Fast-Scroll, 가장자리 스와이프 충돌 가드 적용.

### v21 — 실기기 UI 피드백 5종 ([7490ae7a](conversation://7490ae7a-b4d7-4398-b1c4-eb134df92552))
- **커밋**: `1943e40`
- **핵심 내역**: 와이드 2열 그리드(`.container` `960px`), 필터 좌우 1행 고정, 우상단 글자크기 버튼을 `최근 학습 이어 읽기(#header-resume-btn)`로 교체, 서재 카드 여백/호흡 개선, 고정폭 `.doc-card-badges` 및 제목 2행 클램프(`-webkit-line-clamp: 2`).

### v18 ~ v20 — 오프라인 아키텍처 v2 · 기억체감도 · Unslop UI ([7490ae7a](conversation://7490ae7a-b4d7-4398-b1c4-eb134df92552))
- **커밋**: `281e3d1` (v18), `ab3f592` (v19, v20)
- **핵심 내역**: IndexedDB `ZenReaderDB` v2 문서 영구 저장 및 SW 3분할 캐시(`zen-data-v1`/`zen-images-v1`), 설정 탭 오프라인 캐시 관리, 플로팅 독 기억체감도 팝오버·실수 정정·오프라인만 보기, Unslop UI/SVG·수동 새로고침 연타 방지 락 적용.
