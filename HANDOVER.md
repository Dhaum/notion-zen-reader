# 📖 제2의 뉴런 (Zen Reader PWA) 개발 인수인계서

> **본 문서의 목적**: 신규 대화창이나 세션 시작 시, 소스 코드 전수 조사 없이 5초 만에 시스템 아키텍처, 5대 하드코딩 룰, 실행 방법 및 다음 작업을 복원하기 위한 단일 기술 진실 공급원(Technical SSOT)입니다.

---

## 1. 📌 다음 작업 재개 포인트 (Next Action)
- **최우선 과제**: **문서 읽기 후 목록(리스트) 복귀 시 로컬 캐시 지연 현상 분석 및 렌더링 최적화** (2026-11-08 텔레그램 인입 이슈)
- **현상**: 이미 로컬 스토리지/IndexedDB에 캐시된 데이터임에도 목록 복귀 시 불필요한 스피너/화면 멈춤이 발생함.
- **분석 타겟**: `public/js/app.js` (또는 캐시 로드 함수) 내 렌더링 파이프라인 및 비동기 대기 구간 점검.

---

## 2. 🚀 빠른 실행 및 검증 (How to Run)
```bash
cd "C:\Users\dbswo\Desktop\AI Agents\Antigravity\Apps\notion-zen-reader"
npm start
# 브라우저에서 http://localhost:3000 접속 (기본 PIN: 1234)
```

---

## 3. 🚨 5대 하드코딩 엔지니어링 철칙 (Strict Constraints)
1. **Notion 원본 100% 무손상 (Zero Write)**: Notion API는 오직 읽기(Read-only) 권한만 사용하며, 노션 DB 원본은 1비트도 수정하지 않는다.
2. **태블릿 제로 트러스트 (Zero Notion Auth)**: 태블릿 환경에는 노션 API 키/토큰을 저장하지 않고 오직 4자리 PIN 번호로 웹앱만 잠금 해제한다.
3. **8.4인치 태블릿(iPlay 60 mini pro) 맞춤 가독성**: 다크/라이트/세피아 테마 및 최적 줄간격(1.85) 유지.
4. **오프라인 캐싱 보장 (Service Worker)**: 이미 로컬에 저장된 데이터는 네트워크 단절 시에도 0초 지연으로 즉각 표시되어야 함.
5. **무빌드/경량 유지**: 복잡한 웹팩/Vite 빌드 체인 없이 단일 정적 서빙 및 바닐라 JS의 가벼움을 유지한다.

---

## 4. 핵심 디렉토리 구조
- `scripts/dev-server.js`: 로컬 개발용 경량 Node.js 서버 (API 프록시 및 정적 파일 서빙)
- `public/`: 프론트엔드 PWA 자산 (`index.html`, `app.js`, `style.css`, `manifest.json`)
- `api/`: Vercel 배포용 서버리스 엔드포인트
- `data/`: 로컬 캐시 및 목업 데이터

---

## 5. 📥 백로그 및 아이디어
- [ ] 목록 복귀 시 캐시 즉시 렌더링 후 백그라운드 SWR(Stale-While-Revalidate) 적용
- [ ] 8.4인치 태블릿 세로 모드 터치 제스처 개선
