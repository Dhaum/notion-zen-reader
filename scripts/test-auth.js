// scripts/test-auth.js - Zen PIN 보안 게이트 및 API 엔드포인트 자동화 검증 스위트
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 1. .env 로드
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const { verifyZenPin } = require('../api/lib/auth');
const documentsHandler = require('../api/documents');
const documentHandler = require('../api/document');
const studyLogHandler = require('../api/study-log');
const studyStatsHandler = require('../api/study-stats');

// Mock req & res 생성기
function createMockReqRes({ method = 'GET', headers = {}, query = {}, body = null, url = '/api/test' }) {
  const req = {
    method,
    headers: { ...headers },
    query: { ...query },
    body,
    url
  };

  const res = {
    statusCode: 200,
    headers: {},
    ended: false,
    bodyData: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.bodyData = data;
      this.ended = true;
      return this;
    },
    end(data) {
      if (data) this.bodyData = data;
      this.ended = true;
      return this;
    }
  };

  return { req, res };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 [보안 단위 테스트 1: api/lib/auth.js 모듈 정밀 검증]');
  console.log('====================================================');

  // Test 1-1: OPTIONS 사전 요청 200 통과 및 false 리턴
  {
    const { req, res } = createMockReqRes({ method: 'OPTIONS' });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, false, 'OPTIONS 요청 시 핸들러 추가 실행 방지를 위해 false를 반환해야 합니다.');
    assert.strictEqual(res.statusCode, 200, 'OPTIONS 요청 시 HTTP 200을 응답해야 합니다.');
    assert.strictEqual(res.ended, true, 'OPTIONS 요청 응답이 end() 되어야 합니다.');
    console.log('  ✅ [PASS] OPTIONS 사전 요청 (Preflight) 200 OK 통과');
  }

  // Test 1-2: PIN 헤더 누락 시 401 차단
  {
    const { req, res } = createMockReqRes({ method: 'GET', headers: {} });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, false, 'PIN 누락 시 false를 반환해야 합니다.');
    assert.strictEqual(res.statusCode, 401, 'PIN 누락 시 HTTP 401을 반환해야 합니다.');
    assert.strictEqual(res.bodyData.success, false);
    assert.strictEqual(res.bodyData.error, '인증 실패: 올바른 PIN 번호가 필요합니다.');
    console.log('  ✅ [PASS] PIN 누락 시 401 Unauthorized 차단');
  }

  // Test 1-3: 잘못된 PIN 입력 시 401 차단
  {
    const { req, res } = createMockReqRes({ method: 'GET', headers: { 'x-zen-pin': '0000' } });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.bodyData.success, false);
    console.log('  ✅ [PASS] 불일치 PIN (0000) 401 Unauthorized 차단');
  }

  // Test 1-4: 올바른 PIN 헤더 'x-zen-pin' 통과
  {
    const { req, res } = createMockReqRes({ method: 'GET', headers: { 'x-zen-pin': '1234' } });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, true);
    assert.strictEqual(res.ended, false);
    console.log('  ✅ [PASS] 올바른 PIN 헤더 (x-zen-pin: 1234) 검증 통과 (true 리턴)');
  }

  // Test 1-5: 하위 호환 PIN 헤더 'x-pin-code' 통과
  {
    const { req, res } = createMockReqRes({ method: 'GET', headers: { 'x-pin-code': '1234' } });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, true);
    console.log('  ✅ [PASS] 하위 호환 PIN 헤더 (x-pin-code: 1234) 검증 통과');
  }

  // Test 1-6: 쿼리스트링 '?pin=1234' 통과
  {
    const { req, res } = createMockReqRes({ method: 'GET', query: { pin: '1234' } });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, true);
    console.log('  ✅ [PASS] 쿼리스트링 (pin=1234) 검증 통과');
  }

  // Test 1-7: 대소문자 혼용 헤더 'X-Zen-Pin' 통과
  {
    const { req, res } = createMockReqRes({ method: 'GET', headers: { 'X-Zen-Pin': '1234' } });
    const allowed = verifyZenPin(req, res);
    assert.strictEqual(allowed, true);
    console.log('  ✅ [PASS] 대소문자 혼용 헤더 (X-Zen-Pin: 1234) 검증 통과');
  }

  console.log('\n====================================================');
  console.log('🧪 [보안 통합 테스트 2: 4대 핵심 API 게이트웨이 침투 방어 검증]');
  console.log('====================================================');

  // Test 2-1: /api/documents 차단 및 통과
  {
    // 무인증 요청 (침투 시도)
    const { req: reqFail, res: resFail } = createMockReqRes({ method: 'GET' });
    await documentsHandler(reqFail, resFail);
    assert.strictEqual(resFail.statusCode, 401);
    assert.strictEqual(resFail.bodyData.success, false);

    // 정당한 PIN 요청
    const { req: reqPass, res: resPass } = createMockReqRes({
      method: 'GET',
      headers: { 'x-zen-pin': '1234' }
    });
    await documentsHandler(reqPass, resPass);
    assert.strictEqual(resPass.statusCode, 200);
    assert.strictEqual(resPass.bodyData.success, true);
    assert.ok(Array.isArray(resPass.bodyData.documents));
    console.log(`  ✅ [PASS] /api/documents -> 무인증 401 차단 / 정당 PIN 200 통과 (문서 ${resPass.bodyData.documents.length}건 획득)`);
  }

  // Test 2-2: /api/document (상세조회) 차단 및 통과
  {
    // 무인증 요청
    const { req: reqFail, res: resFail } = createMockReqRes({ method: 'GET', query: { id: 'dummy-id' } });
    await documentHandler(reqFail, resFail);
    assert.strictEqual(resFail.statusCode, 401);

    // 정당한 PIN 요청
    const { req: reqPass, res: resPass } = createMockReqRes({
      method: 'GET',
      headers: { 'x-zen-pin': '1234' },
      query: { id: 'doc-1' }
    });
    await documentHandler(reqPass, resPass);
    assert.strictEqual(resPass.statusCode, 200);
    assert.strictEqual(resPass.bodyData.success, true);
    console.log('  ✅ [PASS] /api/document?id=doc-1 -> 무인증 401 차단 / 정당 PIN 200 상세 파싱 통과');
  }

  // Test 2-3: /api/study-log 차단 및 통과
  {
    // 무인증 위조 POST 요청 (가짜 학습 로그 생성 시도)
    const { req: reqFail, res: resFail } = createMockReqRes({
      method: 'POST',
      body: { docId: 'fake-doc', docTitle: '해킹 시도', durationSeconds: 9999 }
    });
    await studyLogHandler(reqFail, resFail);
    assert.strictEqual(resFail.statusCode, 401);

    // 정당한 PIN POST 요청
    const { req: reqPass, res: resPass } = createMockReqRes({
      method: 'POST',
      headers: { 'x-zen-pin': '1234' },
      body: { docId: 'doc-1', docTitle: '보안 테스트 복습', durationSeconds: 60, device: 'test-agent' }
    });
    await studyLogHandler(reqPass, resPass);
    assert.strictEqual(resPass.statusCode, 200);
    assert.strictEqual(resPass.bodyData.success, true);
    console.log('  ✅ [PASS] /api/study-log (POST) -> 무인증 위조 401 원천 차단 / 정당 PIN 200 체크인 통과');
  }

  // Test 2-4: /api/study-stats 차단 및 통과
  {
    // 무인증 통계 탈취 시도
    const { req: reqFail, res: resFail } = createMockReqRes({ method: 'GET' });
    await studyStatsHandler(reqFail, resFail);
    assert.strictEqual(resFail.statusCode, 401);

    // 정당한 PIN 요청
    const { req: reqPass, res: resPass } = createMockReqRes({
      method: 'GET',
      headers: { 'x-zen-pin': '1234' }
    });
    await studyStatsHandler(reqPass, resPass);
    assert.strictEqual(resPass.statusCode, 200);
    assert.strictEqual(resPass.bodyData.success, true);
    assert.ok(resPass.bodyData.stats.summary);
    console.log('  ✅ [PASS] /api/study-stats -> 무인증 401 차단 / 정당 PIN 200 대시보드 통계 통과');
  }

  console.log('\n====================================================');
  console.log('🧪 [프론트엔드 정적 코드 검증: PIN 로컬 저장 및 헤더 탑재 전수 점검]');
  console.log('====================================================');

  const filesToCheck = [
    'public/js/app.js',
    'public/js/reader.js',
    'public/js/dashboard.js',
    'public/js/offline.js'
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.join(__dirname, '..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // 'x-zen-pin' 헤더 사용 여부 확인
    assert.ok(content.includes('x-zen-pin'), `${relPath}에 'x-zen-pin' 헤더가 정의되어 있어야 합니다.`);
    assert.ok(content.includes("localStorage.getItem('zen_pin_code')"), `${relPath}에 localStorage.getItem('zen_pin_code')가 연동되어 있어야 합니다.`);
    console.log(`  ✅ [PASS] ${relPath} -> x-zen-pin 헤더 및 localStorage 연동 정상 확인`);
  }

  // app.js에 localStorage.setItem('zen_pin_code')가 있는지 확인
  const appJsContent = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
  assert.ok(appJsContent.includes("localStorage.setItem('zen_pin_code'"), "app.js verifyPin에 localStorage.setItem('zen_pin_code')가 저장되어야 합니다.");
  console.log("  ✅ [PASS] public/js/app.js -> verifyPin 시 localStorage.setItem('zen_pin_code', input.value) 저장 로직 정상 확인");

  console.log('\n====================================================');
  console.log('🎉 모든 보안 단위 테스트 및 통합 검증을 100% 성공적으로 통과하였습니다!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ 테스트 실패:', err);
  process.exit(1);
});
