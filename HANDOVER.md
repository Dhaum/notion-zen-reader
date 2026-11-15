# 📖 제2의 뉴런 (Zen Reader PWA) 개발 인수인계서

> **본 문서의 목적**: 신규 대화창이나 세션 시작 시, 소스 코드 전수 조사 없이 5초 만에 시스템 아키텍처, 5대 하드코딩 룰, 실행 방법 및 다음 작업을 복원하기 위한 단일 기술 진실 공급원(Technical SSOT)입니다.

---

## 1. 📌 다음 작업 재개 포인트 (Next Action)
- **최우선 과제**: **v22 배포본 실기기(AllDocube iPlay 60 mini pro) 검증** — `KDIGO 2027 CKD` 문서 상단 `갱신` 실행 후 ① 섹션 4 `4.1`·`4.2` Mermaid 다이어그램(`둘러보기` 2D 터치/핀치 줌·`가로` 90° 회전 뷰어·`원본 코드`), ② 코드/마크다운 구문 강조 다색상, ③ 우측 반투명 TOC 레일(`#zen-toc-rail`) 터치 Fast-Scroll 및 오프라인 동작 확인.
- **완료된 작업 (2026-11-15 v22 · 커밋 `876e381`)**:
  1. **오프라인 Mermaid SVG 다이어그램 + 2D 터치 탐색 + 일시 90° 가로 보기 (`sw.js`, `index.html`, `reader.js`, `app.css`)**: `public/js/vendor/mermaid.min.js` 정적 번들 내장 및 `zen-reader-v22` SW 프리캐시 등록. `language === 'mermaid'` 블록을 4대 테마 연동 SVG 순서도(`.zen-mermaid-card`)로 변환하며, `한눈에`(기본 Fit)·`둘러보기`(2D 터치 드래그/핀치 줌/마우스 휠)·`가로`(모달 전용 90° 회전 `.mermaid-zoom-box.is-rotated` + 회전 좌표계 보정 + `맞춤`)·`원본 코드` 토글 지원.
  2. **코드·마크다운 구문 강조 & 블록/테마 정합성 (`reader.js`, `app.css`, `notion.js`)**: 단일 `#38bdf8` 하드코딩을 제거하고 XSS-안전 단일 패스 토크나이저 `Reader.highlightCode` 및 4대 테마 토큰 변수(`--code-bg`, `--code-kw`, `--code-str` 등) 적용. `heading_4`(`<h4>`), 블록 단위 `color`(`notion-callout-*_background`), `theme-green` `.notion-color-*` 보완.
  3. **우측 목차 레일(`#zen-toc-rail`) 반투명 대기 & Fast-Scroll (`reader.js`, `app.css`)**: 미사용 시 `.is-idle`(`opacity: 0.22`) 자동 감쇠, 터치/마우스 드래그 시 실시간 섹션 말풍선(`#zen-toc-scrub-pill`)과 Fast-Scroll 제공, `setupSwipeToBack()` 충돌 가드 적용.
- **직전 완료 요약 (2026-11-15 v18~v21)**: IndexedDB `ZenReaderDB` v2 영구 문서 저장·SW 3분할 캐시·설정 캐시 관리(v18), 플로팅 독 체감도 팝오버·실수 정정·오프라인만 보기(v19), Unslop UI/SVG·여백 압축·새로고침 락(v20), 와이드 2열 그리드·좌우 1행 필터·이어 읽기·카드 뱃지/2행 제한 통일(v21). 상세 내역은 [WORKLOG.md](./WORKLOG.md) 참조.
- **테스트 현황**: `test-cache-return.js`(Tests 1~22 + `6-1`), `test-auth.js`, `test-sw-cache-matching.js`, `test-sw-image.js`, `test-change-detection.js` 전부 통과 (`2026-11-15`, 실패 0).
- **에셋/서비스워커 버전**: `v22` (`zen-reader-v22`, `zen-data-v1`, `zen-images-v1`, `?v=20261115_v22`).

---

## 2. 🚀 빠른 실행 및 검증 (How to Run)
```bash
cd "C:\Users\dbswo\Desktop\AI Agents\Antigravity\Apps\notion-zen-reader"
npm start
# 브라우저에서 http://localhost:3000 접속 (기본 PIN: 1234)
# 단위/통합 테스트 검증
node scripts/test-cache-return.js
node scripts/test-sw-cache-matching.js
node scripts/test-sw-image.js
node scripts/test-change-detection.js
node scripts/test-auth.js
```

---

## 3. 🚨 5대 하드코딩 엔지니어링 철칙 (Strict Constraints)
1. **Notion 원본 100% 무손상 (Zero Write)**: Notion API는 오직 읽기(Read-only) 권한만 사용하며, 노션 DB 원본은 1비트도 수정하지 않는다.
2. **태블릿 제로 트러스트 (Zero Notion Auth)**: 태블릿 환경에는 노션 API 키/토큰을 저장하지 않고 오직 4자리 PIN 번호로 웹앱만 잠금 해제한다.
3. **8.4인치 태블릿(iPlay 60 mini pro) 맞춤 가독성**: 세로 모드 100% 전담 (가로 모드 스플릿 뷰 기각), 다크/라이트/세피아/에버그린 4대 테마 및 최적 줄간격(1.85) 유지.
4. **오프라인 캐싱 보장 (Service Worker + IndexedDB v2)**: 로컬에 저장된 목록·본문·학습기록은 네트워크 단절 시에도 0초 지연으로 비파괴 렌더링되며 `studyLogs`는 절대 삭제되지 않는다.
5. **무빌드/경량 유지**: 웹팩/Vite 빌드 체인 없이 단일 정적 서빙 및 바닐라 JS의 가벼움을 유지한다.

---

## 4. 핵심 디렉토리 구조
- `scripts/dev-server.js`: 로컬 개발용 경량 Node.js 서버 (API 프록시 및 정적 파일 서빙)
- `scripts/test-*.js`: 오프라인/캐시/SW/변경감지/PIN 보안 자동화 검증 스위트
- `public/`: 프론트엔드 PWA 자산 (`index.html`, `sw.js`, `manifest.json`, `css/app.css`, `js/{storage-idb,offline,app,reader,dashboard,settings}.js`)
- `api/`: Vercel 배포용 서버리스 엔드포인트 (`documents.js`, `document.js`, `study-log.js`, `study-stats.js`, `verify-pin.js`, `lib/{auth,notion,storage}.js`)
- `data/`: 로컬 학습 로그(`study-logs.json`, gitignore 대상)

---

## 5. 📥 백로그 및 아이디어
- [x] 목록 복귀 시 캐시 즉시 렌더링(0ms) 및 SWR 비파괴 파이프라인 구현 (2026-11-08 v17 완료)
- [x] 시안 A 상태바, 스와이프/History 뒤로가기, 스크롤 압축, 태그 시트, TOC 레일 (2026-11-08 v17 완료)
- [x] IndexedDB v2 문서 본문 영구 저장, 증분 동기화, SW 캐시 분리 및 설정 캐시 관리 (2026-11-15 v18 완료)
- [x] 플로팅 독 체감도 선택·동일 세션 정정·서재 오프라인만 보기 필터 (2026-11-15 v19 완료)
- [x] Unslop UI/UX 디자인·여백/카드 슬림화·이모지 SVG화·새로고침 피드백·부드러운 모션 (2026-11-15 v20 완료)
- [x] 서재 뱃지 경계 정렬·좌우 1행 필터·우상단 이어읽기·카드 여백 개선·와이드 2열 그리드 (2026-11-15 v21 완료)
- [x] 오프라인 Mermaid SVG 순서도·2D 터치 탐색·90° 가로보기·코드 구문 강조·우측 반투명 Fast-Scroll TOC (2026-11-15 v22 완료)
- [ ] v22 실기기(AllDocube iPlay 60 mini pro) `KDIGO 2027` 및 가로 다이어그램/TOC Fast-Scroll 실사용 확인
