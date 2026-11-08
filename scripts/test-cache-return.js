// scripts/test-cache-return.js - 리스트 복귀 0ms 렌더링 및 캐시 무결성 검증 스크립트
const assert = require('assert');

// 1. Mock DOM & Browser Environment
const mockElement = {
  style: {},
  innerHTML: '',
  classList: { add() {}, remove() {} },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  remove() {}
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
const originalRenderDocumentList = App.renderDocumentList;

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

    // 5. Test filterByTag & toggle
    console.log('🧪 [Test 5] 태그 터치 시 필터링 & 토글 해제 검증');
    const freshAppCode = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
    eval(freshAppCode.replace('const App =', 'global.App ='));
    App.documents = [
      { id: 'd1', title: '아젤라산', tags: ['여드름', '주사', '미용', '색소침착'] },
      { id: 'd2', title: '이소트레티노인', tags: ['여드름', '피지조절'] },
      { id: 'd3', title: '메트포르민', tags: ['당뇨', '내분비'] }
    ];
    App.showToast = () => {};
    App.renderDocumentList = () => {};

    // First click: filter by '여드름'
    App.filterByTag('여드름');
    assert.strictEqual(App.searchQuery, '여드름', 'searchQuery가 여드름으로 설정되어야 합니다.');
    assert.strictEqual(App.filteredDocuments.length, 2, '여드름 태그를 가진 문서는 2개여야 합니다.');
    assert.ok(App.filteredDocuments.every(d => d.tags.includes('여드름')), '필터링된 모든 문서에 여드름 태그가 있어야 합니다.');

    // Second click: toggle off
    App.filterByTag('여드름');
    assert.strictEqual(App.searchQuery, '', '동일 태그 재클릭 시 searchQuery가 비워져야 합니다.');
    assert.strictEqual(App.filteredDocuments.length, 3, '필터 해제 시 전체 3개 문서가 보여야 합니다.');
    console.log('✅ [Test 5 PASS] 태그 원터치 필터링 및 토글 해제 정상 작동 확인');

    // 6. Test 시안 A 좌측 상태 인디케이터 클래스 및 상단 회독수 뱃지 고정 렌더링
    console.log('🧪 [Test 6] 시안 A 상태 인디케이터 바 및 상단 뱃지 그룹 렌더링 검증');
    const updatedAppCode = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
    eval(updatedAppCode.replace('const App =', 'global.App ='));
    let capturedListHtml = '';
    mockElement.innerHTML = '';
    Object.defineProperty(mockElement, 'innerHTML', {
      set(val) { capturedListHtml = val; },
      get() { return capturedListHtml; }
    });

    App.documents = [
      { id: 'd-done', title: '완료문서', status: '완료', reviewCount: 2, tags: ['피부'] },
      { id: 'd-prog', title: '진행문서', status: '진행 중', reviewCount: 0, tags: ['약학'] },
      { id: 'd-todo', title: '시작전문서', status: '시작 전', reviewCount: 0, tags: ['기초'] },
      { id: 'd-upd', title: '수정문서', status: '완료', hasUpdate: true, reviewCount: 1, tags: ['임상'] }
    ];
    App.filteredDocuments = [...App.documents];

    App.renderDocumentList();

    assert.ok(capturedListHtml.includes('card-status-완료'), '완료 문서에 card-status-완료 클래스가 있어야 합니다.');
    assert.ok(capturedListHtml.includes('card-status-진행중'), '진행 중 문서에 card-status-진행중 클래스가 있어야 합니다.');
    assert.ok(capturedListHtml.includes('card-status-시작전'), '시작 전 문서에 card-status-시작전 클래스가 있어야 합니다.');
    assert.ok(capturedListHtml.includes('card-has-update'), 'hasUpdate 문서에 card-has-update 클래스가 있어야 합니다.');
    assert.ok(capturedListHtml.includes('doc-card-badges'), '상단에 doc-card-badges 그룹이 렌더링되어야 합니다.');
    assert.ok(capturedListHtml.includes('🏆 2회독'), '회독수가 있는 문서는 상단 뱃지에 🏆 2회독이 표시되어야 합니다.');
    console.log('✅ [Test 6 PASS] 시안 A 클래스 및 상단 고정 뱃지 렌더링 검증 완료');

    // 6-1. Test 1안: 정렬 기준에 따른 스마트 날짜 전환 (생성일순 vs 최근 수정순)
    console.log('🧪 [Test 6-1] 정렬 기준에 따른 스마트 날짜 라벨 전환 검증 (1안)');
    App.documents = [
      { id: 'd-date', title: '날짜테스트', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }
    ];
    App.filteredDocuments = [...App.documents];

    // Case A: 기본 생성일순 정렬
    App.sortOrder = 'created_desc';
    App.renderDocumentList();
    assert.ok(capturedListHtml.includes('date-created'), '생성일순 정렬 시 date-created 클래스가 포함되어야 합니다.');
    assert.ok(capturedListHtml.includes('26.10.15'), '생성일자(26.10.15)가 렌더링되어야 합니다.');
    assert.ok(!capturedListHtml.includes('🔄 26.11.08'), '생성일순 정렬 시에는 수정 아이콘 🔄이 노출되지 않아야 합니다.');

    // Case B: 최근 수정순 정렬
    App.sortOrder = 'updated_desc';
    App.renderDocumentList();
    assert.ok(capturedListHtml.includes('date-updated'), '최근 수정순 정렬 시 date-updated 클래스가 포함되어야 합니다.');
    assert.ok(capturedListHtml.includes('🔄 26.11.08'), '최근 수정순 정렬 시 🔄 와 함께 수정일자(26.11.08)가 렌더링되어야 합니다.');
    console.log('✅ [Test 6-1 PASS] 정렬 모드별 스마트 날짜 전환 정상 동작 확인');

    // 7. Test 온디맨드 태그 바텀시트 빈도 계산
    console.log('🧪 [Test 7] 온디맨드 태그 모아보기 빈도수 계산 검증');
    let capturedTagChips = '';
    const mockChipsContainer = {
      set innerHTML(val) { capturedTagChips = val; },
      get innerHTML() { return capturedTagChips; }
    };
    global.document.getElementById = (id) => {
      if (id === 'tag-sheet-chips') return mockChipsContainer;
      return mockElement;
    };

    App.documents = [
      { id: '1', tags: ['여드름', '피부과'] },
      { id: '2', tags: ['여드름', '비만'] },
      { id: '3', tags: ['여드름', '피부과', '비만'] },
      { id: '4', tags: ['당뇨'] }
    ];

    App.renderTagSheet();
    assert.ok(capturedTagChips.includes('#여드름'), '여드름 태그가 시트에 렌더링되어야 합니다.');
    assert.ok(capturedTagChips.includes('>3<'), '여드름 태그 빈도수 3이 표시되어야 합니다.');
    assert.ok(capturedTagChips.includes('>2<'), '피부과 및 비만 빈도수 2가 표시되어야 합니다.');
    assert.ok(capturedTagChips.includes('>1<'), '당뇨 빈도수 1이 표시되어야 합니다.');
    console.log('✅ [Test 7 PASS] 태그 빈도수 자동 취합 및 바텀시트 칩 렌더링 검증 완료');

    // 8. Test Reader.goBack 및 마이크로 목차(TOC) 헤딩 수집
    console.log('🧪 [Test 8] Reader.goBack 및 마이크로 목차(TOC) 헤딩 추출 검증');
    let historyBackCalled = false;
    let showViewListCalled = false;

    global.history = {
      length: 2,
      state: { view: 'reader', docId: 'test-doc' },
      back: () => { historyBackCalled = true; },
      pushState: () => {}
    };

    Reader.goBack();
    assert.strictEqual(historyBackCalled, true, 'reader 뷰에서는 history.back()이 호출되어야 합니다.');

    // fallback when history stack is 1
    global.history.length = 1;
    App.showView = (v) => { if (v === 'list') showViewListCalled = true; };
    Reader.goBack();
    assert.strictEqual(showViewListCalled, true, '히스토리 스택이 없을 때는 App.showView("list")로 fallback해야 합니다.');

    // Test headings extraction
    Reader.headingsList = [];
    Reader.headingCounter = 0;
    const testBlocks = [
      { type: 'heading_1', text: '1. 서론' },
      { type: 'paragraph', text: '본문 내용' },
      { type: 'heading_2', text: '2. 약물 기전' },
      { type: 'heading_3', text: '2-1. 수용체 결합' }
    ];
    Reader.renderBlocks(testBlocks);

    assert.strictEqual(Reader.headingsList.length, 3, '3개의 헤딩이 목차 목록에 수집되어야 합니다.');
    assert.strictEqual(Reader.headingsList[0].text, '1. 서론');
    assert.strictEqual(Reader.headingsList[1].text, '2. 약물 기전');
    assert.strictEqual(Reader.headingsList[2].text, '2-1. 수용체 결합');
    console.log('✅ [Test 8 PASS] Reader.goBack 히스토리 라우팅 및 TOC 헤딩 수집 검증 완료');

    console.log('\n🎉 ALL 8 TESTS PASSED! 모든 기능 무결성 검증 완료.');
  });
});
