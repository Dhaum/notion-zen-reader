// scripts/test-cache-return.js - 리스트 복귀 0ms 렌더링 및 캐시 무결성 검증 스크립트
const assert = require('assert');

// 1. Mock DOM & Browser Environment
const mockElement = {
  style: {},
  innerHTML: '',
  classList: { add() {}, remove() {} },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

global.document = {
  getElementById: (id) => mockElement,
  querySelectorAll: () => [],
  querySelector: () => mockElement,
  addEventListener: () => {},
  body: { className: '' }
};

global.window = {
  addEventListener: () => {},
  scrollTo: () => {}
};

global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; }
};

global.navigator = { onLine: true };

// Mock ZenStorage
global.ZenStorage = {
  mockStats: {},
  async getDocStatsMap() {
    return this.mockStats;
  },
  async saveLog() {}
};

global.OfflineManager = {
  init() {},
  sendStudyLog: async () => {}
};

console.log('🧪 [Test 1] App & Reader 객체 로딩 및 초기화 검증');
// Load app.js and reader.js in simulated sandbox
const fs = require('fs');
const path = require('path');

const appCode = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
const readerCode = fs.readFileSync(path.join(__dirname, '../public/js/reader.js'), 'utf-8');

// Evaluate appCode
eval(appCode.replace('const App =', 'global.App ='));
eval(readerCode.replace('const Reader =', 'global.Reader ='));

assert.strictEqual(typeof App, 'object', 'App 객체가 로드되어야 합니다.');
assert.strictEqual(typeof Reader, 'object', 'Reader 객체가 로드되어야 합니다.');
assert.strictEqual(typeof App.refreshLocalStatsOnly, 'function', 'refreshLocalStatsOnly 메서드가 정의되어야 합니다.');

console.log('✅ [Test 1 PASS] App & Reader 객체 정상 로드');

// 2. Test showView('list') with cached documents
console.log('🧪 [Test 2] 메모리 캐시 존재 시 0ms 즉시 렌더링 검증');
let loadDocumentsCalled = false;
App.loadDocuments = () => { loadDocumentsCalled = true; };

App.documents = [
  { id: 'doc-1', title: '아젤라산', status: '완료', reviewCount: 1 },
  { id: 'doc-2', title: '트레티노인', status: '진행 중', reviewCount: 0 }
];

mockElement.innerHTML = 'INITIAL_CONTENT';

let appliedFilter = false;
App.applyFilterAndSort = () => { appliedFilter = true; };

App.showView('list');

assert.strictEqual(loadDocumentsCalled, false, '캐시가 있을 때는 loadDocuments()가 호출되지 않아야 합니다.');
assert.strictEqual(appliedFilter, true, '캐시가 있을 때는 즉시 applyFilterAndSort()가 호출되어야 합니다.');
assert.strictEqual(mockElement.innerHTML, 'INITIAL_CONTENT', 'listContainer가 스피너로 덮어씌워지지 않아야 합니다.');

console.log('✅ [Test 2 PASS] 스피너 없는 0ms 즉시 렌더링 동작 확인');

// 3. Test Reader.executeCheckin() in-memory sync
console.log('🧪 [Test 3] Reader 체크인 시 App.documents 인메모리 즉시 반영 검증');
Reader.currentDoc = { id: 'doc-1', title: '아젤라산', reviewCount: 1 };
Reader.hasLoggedStudy = false;
Reader.durationSeconds = 60;

Reader.executeCheckin('good').then(() => {
  const targetDoc = App.documents.find(d => d.id === 'doc-1');
  assert.strictEqual(targetDoc.reviewCount, 2, '체크인 후 App.documents의 reviewCount가 2로 즉시 갱신되어야 합니다.');
  assert.ok(targetDoc.lastReviewedAt, 'lastReviewedAt 타임스탬프가 기록되어야 합니다.');
  console.log('✅ [Test 3 PASS] 체크인 시 인메모리 캐시 0ms 동기화 확인');

  // 4. Test refreshLocalStatsOnly
  console.log('🧪 [Test 4] refreshLocalStatsOnly 동작 검증');
  ZenStorage.mockStats['doc-2'] = { reviewCount: 3, lastReviewedAt: new Date().toISOString() };
  
  let reFiltered = false;
  App.applyFilterAndSort = () => { reFiltered = true; };

  App.refreshLocalStatsOnly().then(() => {
    const doc2 = App.documents.find(d => d.id === 'doc-2');
    assert.strictEqual(doc2.reviewCount, 3, 'IndexedDB 통계가 doc-2에 반영되어야 합니다.');
    assert.strictEqual(reFiltered, true, '통계 변경 시 화면이 재필터링되어야 합니다.');
    console.log('✅ [Test 4 PASS] refreshLocalStatsOnly 정상 결합 확인');
    console.log('\n🎉 ALL TESTS PASSED! 모든 0ms 캐시 로직 무결성 검증 완료.');
  });
});
