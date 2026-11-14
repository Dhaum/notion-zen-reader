# 📖 제2의 뉴런 (Zen Reader PWA) 개발 인수인계서

> **본 문서의 목적**: 신규 대화창이나 세션 시작 시, 소스 코드 전수 조사 없이 5초 만에 시스템 아키텍처, 5대 하드코딩 룰, 실행 방법 및 다음 작업을 복원하기 위한 단일 기술 진실 공급원(Technical SSOT)입니다.

---

## 1. 📌 다음 작업 재개 포인트 (Next Action)
- **최우선 과제**: **v21 실기기 피드백 5종(서재 뱃지 경계 정렬·좌우 1행 필터·우상단 이어읽기·카드 여백 개선·와이드 그리드) 커밋/배포 및 최종 검증**
- **완료된 작업 (2026-11-15 v21 — 실기기 UI 피드백 5종 반영)**:
  1. **불필요한 여백 활용 & 와이드 그리드 (`public/css/app.css`)**: `.container` 상한을 `960px`로 확장하고 `@media (min-width: 740px)`에서 서재 카드를 2열 그리드로 배치, 본문 `.reader-container`는 `740px` 최적 독서 폭 중앙 정렬 유지.
  2. **필터 행 단일 행 좌우 정렬 (`public/index.html`, `public/css/app.css`)**: 좌측 `[전체·완료·진행중·시작전]`과 우측 `[오프라인만·최신순/과거순/수정순/제목순]`을 `flex-wrap: nowrap` 단일 행으로 고정하고, `app.css` 내 잔존하던 깨진 CSS 중괄호를 제거.
  3. **우상단 글자크기 버튼 대체 (`public/index.html`, `public/js/app.js`, `public/js/reader.js`)**: 실사용 빈도가 낮은 `[가]` 버튼을 제거하고 마지막 열람 문서로 1탭 복귀하는 `최근 학습 이어 읽기(#header-resume-btn, App.openLastReadDoc)` 북마크 버튼으로 교체(`zen_last_read_doc_id` 연동; 글자 크기는 설정 탭 유지).
  4. **서재 카드 구획 호흡 개선 (`public/css/app.css`, `public/js/app.js`)**: `.doc-card` 패딩(`13px 14px 12px 17px`), 카드 간격(`9px`), 헤더 행(`.doc-card-header-row` `margin-bottom: 7px`) 및 태그 여백을 정돈해 답답함 해소.
  5. **긴 제목-우측 뱃지 경계 통일 & 2행 제한 (`public/css/app.css`, `public/js/app.js`)**: `.doc-card-badges`에 `min-width: 96px; justify-content: flex-end;` 슬롯 너비를 고정하고, `.doc-card-title`은 `-webkit-line-clamp: 2`로 최대 2행까지만 표시(`수정됨`·`미저장` 뱃지는 하단 메타 행으로 분리해 잘림 방지).
- **완료된 작업 (2026-11-15 v20 — Unslop UI/UX 디자인·인터랙션 고도화)**:
  1. **Editorial Clinical Notebook 디자인 언슬롭 (`index.html`, `app.css`, `app.js`, `reader.js`, `settings.js`, `dashboard.js`)**: 네온 `box-shadow` 글로우, 무한 펄스 뱃지, 그라데이션 배너, 비인디고 테마로 새어 나오던 `#6366f1` 및 대시보드 다크 `rgba(30,41,59,0.4)` 하드코딩을 제거하고 4대 테마 토큰 정합성 확보. 과장·느낌표 위주 카피를 차분한 임상 노트 어조로 정돈.
  2. **이모지 정리 및 SVG·시맨틱 도트 교체 (`index.html`, `app.js`, `reader.js`, `settings.js`, `dashboard.js`)**: 헤더·네비게이션 탭·검색바·상태/체감도 필터·플로팅 독·팝오버·설정·대시보드·PIN 모달의 장식용 이모지를 1.75–2px 모노크롬 SVG(`.zen-svg`)와 시맨틱 컬러 도트(`.status-dot`, `.fb-dot`)로 교체.
  3. **여백 압축 & 서재 카드 세로 높이 슬림화 (`public/css/app.css`, `public/js/app.js`)**: `.zen-header`, `.container`, `.nav-tabs`, `.search-and-tag-bar`, `.filter-controls-row`, `.settings-panel`, `.dash-panel` 패딩·간격 압축 및 `.doc-card` 패딩(`10px 12px 10px 15px`)·카드 간격(`6px`)·제목 라인하이트(`1.32`) 슬림화로 8.4" 세로 뷰포트 정보 밀도 향상.
  4. **수동 새로고침/터치 피드백 & 중복 연타 방지 락 (`app.css`, `app.js`, `reader.js`, `settings.js`)**: `:active` 눌림 감쇠·`:focus-visible` 포커스 링 강화, `setButtonLoading()` + `.is-loading`/`.icon-spin-target` 도입으로 헤더(`#header-refresh-btn`)·뷰어(`#btn-reader-pinpoint-refresh`)·설정(`노션 대조`, `증분 저장`, `서버 업로드`) 클릭 즉시 시각/토스트 피드백 제공 및 `_isRefreshingDocs` / `_isBatchCaching` / `_isRefreshingCurrent` 연타 방지 락 적용.
  5. **부드러운 뷰 전환 & 모션 (`public/css/app.css`, `public/js/app.js`)**: `.view-enter`(`viewReveal`), 팝오버/토스트 스프링 전환 및 `@media (prefers-reduced-motion: reduce)` 지원 추가.
- **완료된 작업 (2026-11-15 v19)**:
  1. **플로팅 독 완료 버튼 기억체감도 팝오버 (`public/index.html`, `public/js/reader.js`, `public/css/app.css`)**: 하단 플로팅 독 완료 버튼 터치 시 `#zen-dock-feedback-popover`(수월함/적정/헷갈림)를 노출해 원손가락으로 즉시 체감도를 선택·체크인하도록 개선.
  2. **동일 세션 내 기억체감도 실수 정정 (`reader.js`, `storage-idb.js`, `offline.js`, `api/study-log.js`, `api/lib/storage.js`)**: 체크인 이후에도 하단 완료 카드의 3개 버튼(`#fb-btn-easy/good/hard`) 및 플로팅 독 팝오버를 활성 유지하고, 다른 체감도를 재선택 시 `reviewCount` 증가·중복 로그 생성 없이 `clientLogId` 기준으로 IndexedDB·`zen_permanent_logs`·`zen_offline_study_queue`(제자리 수정)·서버(`/api/study-log` `action: 'update_feedback'`)를 일관 정정.
  3. **서재 탭 '오프라인만' 보기 필터 (`public/index.html`, `public/js/app.js`, `public/css/app.css`)**: `#btn-offline-only-filter`(오프라인만) 토글 버튼 추가, 상태 필터·검색·정렬과 교차 조합 지원 및 `localStorage('zen_filter_offline_only')` 상태 보존.
- **완료된 작업 (2026-11-15 v18)**:
  1. **IndexedDB `ZenReaderDB` v2 SSOT (`public/js/storage-idb.js`, `public/js/offline.js`)**: `DB_VERSION = 2`로 통일(`studyLogs` 100% 보존 + `documents`/`meta` 스토어 추가), `OfflineManager.openDB()`를 `ZenStorage.openDB()` 단일 프라미스에 위임해 `VersionError` 경합 제거. 문서 CRUD, `getOfflineCacheSummary`, `pruneOrphanDocuments`, `clearDocumentCache`(학습기록 보존), `prefetchDocumentImages`(동시성 3) 구현.
  2. **Service Worker 캐시 분리 및 폴백 안전화 (`public/sw.js`)**: `zen-reader-v20`(앱 셸) / `zen-data-v1`(API 데이터) / `zen-images-v1`(이미지) 3분할 보존(`PRESERVED_CACHES`). `GET /api/*` 응답을 `event.waitUntil`로 `zen-data-v1`에 저장하며, `.js`/`.css` 오프라인 폴백은 `ignoreSearch: true` 후 503 반환(`/index.html` 오반환 차단), Section D는 `navigate` 요청만 `/index.html` 폴백.
  3. **비파괴 오프라인 서재 & 0ms SWR 리더 (`public/js/app.js`, `public/js/reader.js`)**: `loadDocuments()` 오프라인/실패 시 기존 캐시 목록 보존 및 `ZenStorage.getDocumentList()` 복원, 미저장 카드 구분(`.card-offline-unavailable`, `.badge-doc-uncached`), `downloadAllForOffline(false)` 증분 동기화(Delta Sync) 및 `WakeLock` 적용. `Reader.open()`은 온라인 열람 본문을 즉시 IDB에 저장하며, 캐시 최신본은 0ms SWR + 백그라운드 재검증, 오프라인/구버전 열람 시 `.reader-cache-banner`(`banner-offline`/`banner-outdated`) 노출.
  4. **설정 탭 오프라인 캐시 관리 & 버그 수정 (`public/js/settings.js`, `public/css/app.css`, `public/index.html`)**: Panel #3 영구 보존 락(`isPersisted`) 하드코딩 버그 수정, Panel #4 오프라인 문서 캐시 요약·증분 저장·전체 재다운로드·고아 정리(`pruneOrphans`)·학습기록 보존 초기화(`clearDocCacheOnly`) 구현, 4대 테마 호환 CSS 및 에셋 `?v=20261115_v20` 갱신.
  5. **Notion 하위 블록 수집 최적화 (`api/lib/notion.js`)**: `fetchBlocksRecursively`에 블록 순서 보존 + `createConcurrencyLimiter(3)` 적용으로 대용량 문서 타임아웃 방어.
- **이전 완료 (2026-11-08 v17)**: 스마트 날짜 전환(1안), 상단 회독수 고정, 시안 A 상태 인디케이터 바, History API/스와이프 뒤로가기, 상단 크롬 스크롤 압축, 태그 바텀시트, 마이크로 목차 레일(TOC Scrubber).
- **테스트 현황**: `test-cache-return.js`(Tests 1..20, 21개 케이스), `test-sw-cache-matching.js`, `test-sw-image.js`, `test-change-detection.js`, `test-auth.js` 및 전 JS 파일 `node -c` 구문 검사 100% 통과.
- **에셋/서비스워커 버전**: `v21` (`zen-reader-v21`, `zen-data-v1`, `?v=20261115_v21`).

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
- [ ] v20 커밋·배포 및 알도큐브 실기기 검증
