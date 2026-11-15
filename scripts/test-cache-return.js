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

  return App.refreshLocalStatsOnly().then(async () => {
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
    assert.ok(capturedListHtml.includes('doc-review-badge">2회독<'), '회독수가 있는 문서는 상단 뱃지에 2회독이 표시되어야 합니다.');
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
    assert.ok(!capturedListHtml.includes('date-updated') && !capturedListHtml.includes('<span>26.11.08</span>'), '생성일순 정렬 시에는 수정 날짜/아이콘이 노출되지 않아야 합니다.');

    // Case B: 최근 수정순 정렬
    App.sortOrder = 'updated_desc';
    App.renderDocumentList();
    assert.ok(capturedListHtml.includes('date-updated'), '최근 수정순 정렬 시 date-updated 클래스가 포함되어야 합니다.');
    assert.ok(capturedListHtml.includes('<span>26.11.08</span>'), '최근 수정순 정렬 시 수정일자(26.11.08)가 렌더링되어야 합니다.');
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

    await runV18Tests();
    console.log('\n🎉 ALL 20 TESTS PASSED! v21 서재 뱃지 경계 정렬·1행 필터·이어읽기·여백 개선 전체 검증 완료.');
  });
}).catch(err => {
  console.error('❌ 테스트 실패:', err);
  process.exit(1);
});

async function runV18Tests() {
  const realStorageCodePath = path.join(__dirname, '../public/js/storage-idb.js');
  const realOfflineCodePath = path.join(__dirname, '../public/js/offline.js');
  const realAppCodePath = path.join(__dirname, '../public/js/app.js');
  const realReaderCodePath = path.join(__dirname, '../public/js/reader.js');
  const realSettingsCodePath = path.join(__dirname, '../public/js/settings.js');

  function setNavigatorOnline(onLine) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine },
      configurable: true,
      writable: true
    });
  }

  function createElementsRegistry() {
    const els = {};
    const getEl = (id) => {
      if (!els[id]) {
        const classes = new Set();
        els[id] = {
          id,
          style: {},
          dataset: {},
          innerHTML: '',
          innerText: '',
          disabled: false,
          value: '',
          classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            contains: (c) => classes.has(c)
          },
          querySelectorAll: () => [],
          querySelector: () => null,
          addEventListener: () => {},
          remove: () => {}
        };
      }
      return els[id];
    };
    return { els, getEl };
  }

  function createMockIndexedDB(initialStudyLogs = []) {
    const storesData = {
      studyLogs: new Map()
    };
    let autoId = 1;
    for (const log of initialStudyLogs) {
      const id = log.id || autoId++;
      if (id >= autoId) autoId = id + 1;
      storesData.studyLogs.set(id, { ...log, id });
    }
    const storeConfigs = {
      studyLogs: { keyPath: 'id', autoIncrement: true, indexes: new Set(['docId', 'timestamp', 'readAt', 'reviewCount', 'synced']) }
    };
    let currentVersion = 1;

    const makeReq = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });

    const makeDBHandle = () => ({
      objectStoreNames: {
        contains: (name) => Object.prototype.hasOwnProperty.call(storesData, name)
      },
      createObjectStore: (name, opts = {}) => {
        if (!storesData[name]) storesData[name] = new Map();
        storeConfigs[name] = { keyPath: opts.keyPath || 'id', autoIncrement: Boolean(opts.autoIncrement), indexes: new Set() };
        return {
          indexNames: { contains: (idx) => storeConfigs[name].indexes.has(idx) },
          createIndex: (idx) => { storeConfigs[name].indexes.add(idx); }
        };
      },
      transaction: (names) => {
        const storeList = Array.isArray(names) ? names : [names];
        return {
          objectStore: (storeName) => {
            if (!storeList.includes(storeName) || !storesData[storeName]) {
              throw new Error(`Store ${storeName} not in transaction`);
            }
            const map = storesData[storeName];
            const cfg = storeConfigs[storeName];
            return {
              indexNames: { contains: (idx) => cfg.indexes.has(idx) },
              createIndex: (idx) => { cfg.indexes.add(idx); },
              put: (val) => {
                const req = makeReq();
                const copy = { ...val };
                let key = copy[cfg.keyPath];
                if (key === undefined && cfg.autoIncrement) {
                  key = autoId++;
                  copy[cfg.keyPath] = key;
                }
                map.set(key, copy);
                queueMicrotask(() => {
                  req.result = key;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              add: (val) => {
                const req = makeReq();
                const copy = { ...val };
                let key = copy[cfg.keyPath];
                if (key === undefined && cfg.autoIncrement) {
                  key = autoId++;
                  copy[cfg.keyPath] = key;
                }
                map.set(key, copy);
                queueMicrotask(() => {
                  req.result = key;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              get: (key) => {
                const req = makeReq();
                queueMicrotask(() => {
                  req.result = map.has(key) ? { ...map.get(key) } : undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              getAll: () => {
                const req = makeReq();
                queueMicrotask(() => {
                  req.result = Array.from(map.values()).map(v => ({ ...v }));
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              delete: (key) => {
                const req = makeReq();
                map.delete(key);
                queueMicrotask(() => {
                  req.result = undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              clear: () => {
                const req = makeReq();
                map.clear();
                queueMicrotask(() => {
                  req.result = undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              }
            };
          }
        };
      },
      close: () => {},
      onversionchange: null,
      onclose: null
    });

    return {
      storesData,
      storeConfigs,
      indexedDB: {
        open: (name, version) => {
          const req = { result: null, error: null, transaction: null, onupgradeneeded: null, onsuccess: null, onerror: null };
          queueMicrotask(() => {
            const db = makeDBHandle();
            req.result = db;
            req.transaction = db.transaction(Object.keys(storesData));
            if (version > currentVersion) {
              currentVersion = version;
              if (req.onupgradeneeded) {
                req.onupgradeneeded({ target: req });
              }
            }
            if (req.onsuccess) {
              req.onsuccess({ target: req });
            }
          });
          return req;
        }
      }
    };
  }

  function createMockCacheStorage(initialCaches = {}) {
    const cacheMap = new Map();
    for (const [name, entries] of Object.entries(initialCaches)) {
      const store = new Map(Object.entries(entries));
      cacheMap.set(name, store);
    }
    const openCacheObj = (name) => {
      if (!cacheMap.has(name)) cacheMap.set(name, new Map());
      const store = cacheMap.get(name);
      return {
        match: async (req, opts = {}) => {
          const targetUrl = typeof req === 'string' ? req : (req && req.url);
          if (!targetUrl) return undefined;
          if (store.has(targetUrl)) return store.get(targetUrl);
          if (opts.ignoreSearch) {
            const base = targetUrl.split('?')[0];
            for (const [k, v] of store.entries()) {
              if (k.split('?')[0] === base) return v;
            }
          }
          return undefined;
        },
        keys: async () => Array.from(store.keys()).map(u => ({ url: u })),
        put: async (req, val) => {
          const targetUrl = typeof req === 'string' ? req : (req && req.url);
          if (targetUrl) store.set(targetUrl, val);
        }
      };
    };
    return {
      cacheMap,
      caches: {
        open: async (name) => openCacheObj(name),
        keys: async () => Array.from(cacheMap.keys()),
        delete: async (name) => cacheMap.delete(name)
      }
    };
  }

  function resetDomMocks() {
    const reg = createElementsRegistry();
    global.document = {
      getElementById: reg.getEl,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag) => reg.getEl(`__created_${tag}_${Math.random()}`),
      addEventListener: () => {},
      body: { className: '', appendChild: () => {}, classList: { add() {}, remove() {}, contains: () => false } }
    };
    global.window = {
      location: { pathname: '/' },
      addEventListener: () => {},
      removeEventListener: () => {},
      scrollTo: () => {},
      scrollY: 0,
      matchMedia: () => ({ matches: false })
    };
    global.localStorage = {
      _store: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    };
    global.history = {
      length: 1,
      state: null,
      pushState: () => {},
      replaceState: () => {},
      back: () => {}
    };
    return reg;
  }

  function loadFreshZenStorage() {
    delete require.cache[require.resolve(realStorageCodePath)];
    const storage = require(realStorageCodePath);
    storage.db = null;
    storage._openPromise = null;
    storage._memDocs.clear();
    storage._memList = null;
    global.ZenStorage = storage;
    return storage;
  }

  function loadFreshAppAndReader() {
    const appSrc = fs.readFileSync(realAppCodePath, 'utf-8');
    const readerSrc = fs.readFileSync(realReaderCodePath, 'utf-8');
    eval(appSrc.replace('const App =', 'global.App ='));
    eval(readerSrc.replace('const Reader =', 'global.Reader ='));
    global.App.documents = [];
    global.App.filteredDocuments = [];
    global.App.offlineDocIds = new Set();
    global.App.currentView = 'list';
  }

  // =========================================================================
  // Test 9: ZenStorage v2 document CRUD, summary, prune, clear (studyLogs 보존)
  // =========================================================================
  console.log('🧪 [Test 9] ZenStorage v2 문서 CRUD, 요약/고아정리, studyLogs 보존 초기화 검증');
  {
    resetDomMocks();
    delete global.caches;
    setNavigatorOnline(true);

    // 9-A. Pure in-memory fallback (without window.indexedDB)
    const storageMem = loadFreshZenStorage();
    assert.strictEqual(storageMem.DB_VERSION, 2, 'ZenStorage.DB_VERSION은 2여야 합니다.');

    let threwOnInvalid = false;
    try {
      await storageMem.saveDocument({ title: 'no id' });
    } catch (_) {
      threwOnInvalid = true;
    }
    assert.strictEqual(threwOnInvalid, true, 'id 없는 문서 저장 시 예외를 발생시켜야 합니다.');

    await storageMem.saveDocument({
      id: 'doc-up',
      title: '최신 문서',
      updatedAt: '2026-11-12T10:00:00.000Z',
      blocks: [{ type: 'paragraph', text: '최신 본문 내용' }]
    });
    await storageMem.saveDocument({
      id: 'doc-out',
      title: '구버전 문서',
      updatedAt: '2026-11-10T10:00:00.000Z',
      blocks: [{ type: 'paragraph', text: '이전 본문' }]
    });
    await storageMem.saveDocument({
      id: 'doc-orphan',
      title: '삭제된 고아 문서',
      updatedAt: '2026-11-09T10:00:00.000Z',
      blocks: [{ type: 'paragraph', text: '고아 본문' }]
    });
    await storageMem.saveDocument({
      id: 'doc-stub',
      title: '본문없는 메타'
    });

    const gotDoc = await storageMem.getDocument('doc-up');
    assert.strictEqual(gotDoc.title, '최신 문서');
    assert.ok(gotDoc.cachedAt, 'cachedAt 타임스탬프가 자동 부여되어야 합니다.');
    assert.strictEqual(await storageMem.getDocument('non-existent'), null);

    await storageMem.saveDocumentList([{ id: 'doc-up', title: '최신 문서' }]);
    const gotList = await storageMem.getDocumentList();
    assert.strictEqual(gotList.length, 1);
    assert.strictEqual(gotList[0].id, 'doc-up');

    const cachedIds = await storageMem.getCachedDocIds();
    assert.strictEqual(cachedIds.has('doc-up'), true);
    assert.strictEqual(cachedIds.has('doc-stub'), false, 'blocks/content가 없는 문서는 getCachedDocIds에 포함되지 않아야 합니다.');

    // remove doc-stub before summary check for clean 3-doc count
    await storageMem.pruneOrphanDocuments(['doc-up', 'doc-out', 'doc-orphan']);
    assert.strictEqual(await storageMem.getDocument('doc-stub'), null, 'doc-stub가 정리되어야 합니다.');

    const summary = await storageMem.getOfflineCacheSummary([
      { id: 'doc-up', updatedAt: '2026-11-12T10:00:00.000Z' },
      { id: 'doc-out', updatedAt: '2026-11-14T10:00:00.000Z' },
      { id: 'doc-miss', updatedAt: '2026-11-13T10:00:00.000Z' }
    ]);
    assert.strictEqual(summary.totalRemote, 3);
    assert.strictEqual(summary.cachedCount, 3);
    assert.strictEqual(summary.upToDateCount, 1);
    assert.strictEqual(summary.outdatedCount, 1);
    assert.strictEqual(summary.missingCount, 1);
    assert.strictEqual(summary.orphanCount, 1);
    assert.ok(summary.approxSizeKB >= 1);
    assert.ok(summary.lastCachedAt);

    assert.strictEqual(await storageMem.pruneOrphanDocuments([]), 0, '빈 목록 전달 시 안전하게 0을 반환해야 합니다.');
    const prunedCount = await storageMem.pruneOrphanDocuments(new Set(['doc-up', 'doc-out', 'doc-miss']));
    assert.strictEqual(prunedCount, 1, '고아 문서 1건이 삭제되어야 합니다.');
    assert.strictEqual(await storageMem.getDocument('doc-orphan'), null);

    // 9-B. Mock IndexedDB v1 -> v2 upgrade + OfflineManager delegation + clearDocumentCache preserving studyLogs
    const mockIdb = createMockIndexedDB([
      { id: 1, docId: 'doc-up', docTitle: '최신 문서', reviewCount: 2, readAt: '2026-11-10T00:00:00.000Z', timestamp: '2026-11-10T00:00:00.000Z' }
    ]);
    global.window.indexedDB = mockIdb.indexedDB;
    const mockCaches = createMockCacheStorage({
      'zen-data-v1': { 'https://app.local/api/documents/doc-up': 'cached-api' },
      'zen-images-v1': { 'https://cdn.example.com/img1.png?sig=abc': 'img-bin' },
      'zen-reader-v18': { 'https://app.local/index.html': 'html-shell' }
    });
    global.caches = mockCaches.caches;

    const storageIdb = loadFreshZenStorage();
    const openedDb = await storageIdb.openDB();
    assert.ok(openedDb.objectStoreNames.contains('studyLogs'), 'v2 업그레이드 후 studyLogs 스토어가 보존되어야 합니다.');
    assert.ok(openedDb.objectStoreNames.contains('documents'), 'v2 업그레이드 시 documents 스토어가 생성되어야 합니다.');
    assert.ok(openedDb.objectStoreNames.contains('meta'), 'v2 업그레이드 시 meta 스토어가 생성되어야 합니다.');

    delete require.cache[require.resolve(realOfflineCodePath)];
    const offlineMgr = require(realOfflineCodePath);
    offlineMgr.dbInstance = null;
    global.OfflineManager = offlineMgr;
    assert.strictEqual(offlineMgr.DB_VERSION, 2, 'OfflineManager.DB_VERSION은 2여야 합니다.');
    const delegatedDb = await offlineMgr.openDB();
    assert.strictEqual(delegatedDb, openedDb, 'OfflineManager.openDB()는 ZenStorage.openDB()와 동일 DB 핸들을 공유해야 합니다.');

    await storageIdb.saveDocument({
      id: 'doc-up',
      title: '최신 문서',
      updatedAt: '2026-11-12T10:00:00.000Z',
      blocks: [
        { type: 'image', imageUrl: 'https://cdn.example.com/img1.png?sig=new' },
        { type: 'toggle', children: [{ type: 'image', imageUrl: 'https://cdn.example.com/img2.png' }] }
      ]
    });
    await storageIdb.saveDocumentList([{ id: 'doc-up', title: '최신 문서' }]);

    // Verify prefetchDocumentImages skips already-cached pathname (img1.png) and fetches missing (img2.png)
    const prefetchedUrls = [];
    global.fetch = async (url, opts) => {
      prefetchedUrls.push({ url, opts });
      return { ok: true, status: 200 };
    };
    const prefetchRes = await storageIdb.prefetchDocumentImages(await storageIdb.getDocument('doc-up'), 3);
    assert.strictEqual(prefetchRes.total, 2);
    assert.strictEqual(prefetchRes.skipped, 1, 'pathname이 일치하는 img1은 중복 fetch하지 않아야 합니다.');
    assert.strictEqual(prefetchRes.fetched, 1, '미저장 img2만 fetch되어야 합니다.');
    assert.strictEqual(prefetchedUrls[0].url, 'https://cdn.example.com/img2.png');
    assert.strictEqual(prefetchedUrls[0].opts.mode, 'no-cors');

    setNavigatorOnline(false);
    const offlinePrefetchRes = await storageIdb.prefetchDocumentImages(await storageIdb.getDocument('doc-up'), 3);
    assert.deepStrictEqual(offlinePrefetchRes, { total: 0, skipped: 0, fetched: 0 }, '오프라인 시 prefetchDocumentImages는 안전하게 no-op이어야 합니다.');
    setNavigatorOnline(true);

    localStorage.setItem('zen_doc_sync_map', '{"doc-up":{"cachedUpdatedAt":"2026-11-12"}}');
    localStorage.setItem('zen_cached_documents', '[{"id":"doc-up"}]');
    localStorage.setItem('zen_permanent_logs', '[{"docId":"doc-up"}]');

    const clearRes = await storageIdb.clearDocumentCache();
    assert.strictEqual(clearRes.clearedDocsCount, 1);
    assert.strictEqual(await storageIdb.getDocument('doc-up'), null, 'documents 스토어가 비워져야 합니다.');
    assert.strictEqual(await storageIdb.getDocumentList(), null, 'documentList 메타가 삭제되어야 합니다.');
    assert.strictEqual(localStorage.getItem('zen_doc_sync_map'), null);
    assert.strictEqual(localStorage.getItem('zen_cached_documents'), null);
    assert.strictEqual(mockCaches.cacheMap.has('zen-data-v1'), false, 'zen-data-v1 캐시가 삭제되어야 합니다.');
    assert.strictEqual(mockCaches.cacheMap.has('zen-images-v1'), false, 'zen-images-v1 캐시가 삭제되어야 합니다.');
    assert.strictEqual(mockCaches.cacheMap.has('zen-reader-v18'), true, '앱 셸 캐시(zen-reader-v18)는 보존되어야 합니다.');

    const preservedLogs = await storageIdb.getAllLogs();
    assert.strictEqual(preservedLogs.length, 1, 'clearDocumentCache() 후에도 studyLogs 학습 기록이 100% 보존되어야 합니다.');
    assert.strictEqual(preservedLogs[0].docId, 'doc-up');
    assert.strictEqual(localStorage.getItem('zen_permanent_logs'), '[{"docId":"doc-up"}]', 'zen_permanent_logs 미러도 보존되어야 합니다.');

    delete global.window.indexedDB;
    delete global.caches;
    console.log('✅ [Test 9 PASS] ZenStorage v2 문서 CRUD/요약/고아정리/이미지프리패치 및 studyLogs 보존 초기화 확인');
  }

  // =========================================================================
  // Test 10: App.loadDocuments() 오프라인 비파괴 가드 + 수정 감지
  // =========================================================================
  console.log('🧪 [Test 10] App.loadDocuments() 오프라인 비파괴 가드 및 수정 감지 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();

    const listEl = reg.getEl('doc-card-list');
    await storage.saveDocument({
      id: 'doc-cached',
      title: '저장된 약물',
      updatedAt: '2026-11-10T00:00:00.000Z',
      blocks: [{ type: 'paragraph', text: '본문' }]
    });

    const cachedList = [
      { id: 'doc-cached', title: '저장된 약물', status: '완료', updatedAt: '2026-11-10T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z', tags: ['약물'] },
      { id: 'doc-uncached', title: '미저장 약물', status: '진행 중', updatedAt: '2026-11-11T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z', tags: ['임상'] }
    ];
    localStorage.setItem('zen_cached_documents', JSON.stringify(cachedList));

    // Scenario A: fetch throws network error while offline
    setNavigatorOnline(false);
    global.fetch = async () => { throw new Error('Failed to fetch'); };
    await App.loadDocuments(false);
    assert.strictEqual(listEl.innerHTML.includes('문서 목록 로딩 실패'), false, '네트워크 실패 시 기존 목록이 에러 화면으로 덮어씌워지면 안 됩니다.');
    assert.strictEqual(listEl.innerHTML.includes('저장된 약물'), true);
    assert.strictEqual(listEl.innerHTML.includes('미저장 약물'), true);
    assert.strictEqual(listEl.innerHTML.includes('card-offline-unavailable'), true, '오프라인 미저장 문서에 card-offline-unavailable 클래스가 적용되어야 합니다.');
    assert.strictEqual(listEl.innerHTML.includes('badge-doc-uncached'), true, '오프라인 미저장 문서에 ☁️ 미저장 뱃지가 렌더링되어야 합니다.');

    // Scenario B: fetch returns SW offline JSON { success: false, offline: true }
    App.documents = [];
    listEl.innerHTML = '';
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false, offline: true, message: '오프라인 상태입니다.' })
    });
    await App.loadDocuments(false);
    assert.strictEqual(listEl.innerHTML.includes('문서 목록 로딩 실패'), false, 'SW 오프라인 JSON 응답 시에도 캐시 목록이 보존되어야 합니다.');
    assert.strictEqual(App.documents.length, 2);

    // Scenario C: localStorage empty -> fallback to ZenStorage.getDocumentList()
    localStorage.removeItem('zen_cached_documents');
    await storage.saveDocumentList(cachedList);
    App.documents = [];
    listEl.innerHTML = '';
    await App.loadDocuments(false);
    assert.strictEqual(App.documents.length, 2, 'localStorage 비어있을 때 ZenStorage.getDocumentList()에서 복원되어야 합니다.');
    assert.strictEqual(listEl.innerHTML.includes('문서 목록 로딩 실패'), false);

    // Scenario D: Online fetch with update detection & orphan pruning
    setNavigatorOnline(true);
    await storage.saveDocument({
      id: 'doc-stale-orphan',
      title: '삭제 예정 고아',
      updatedAt: '2026-11-01T00:00:00.000Z',
      blocks: [{ type: 'paragraph', text: 'x' }]
    });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        documents: [
          { id: 'doc-cached', title: '저장된 약물', status: '완료', updatedAt: '2026-11-14T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z', tags: ['약물'] },
          { id: 'doc-uncached', title: '미저장 약물', status: '진행 중', updatedAt: '2026-11-11T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z', tags: ['임상'] }
        ]
      })
    });
    await App.loadDocuments(false);
    await new Promise(r => setTimeout(r, 20)); // allow background pruneOrphanDocuments promise to settle
    const updatedCachedDoc = App.documents.find(d => d.id === 'doc-cached');
    const uncachedDoc = App.documents.find(d => d.id === 'doc-uncached');
    assert.strictEqual(updatedCachedDoc.hasUpdate, true, '원격 updatedAt이 캐시보다 최신이면 hasUpdate=true여야 합니다.');
    assert.strictEqual(updatedCachedDoc.isCachedLocally, true);
    assert.strictEqual(uncachedDoc.hasUpdate, false, '로컬 미저장 문서는 최초 방문 스팸 방지를 위해 hasUpdate=false여야 합니다.');
    assert.strictEqual(await storage.getDocument('doc-stale-orphan'), null, '목록 동기화 시 고아 문서가 자동 정리되어야 합니다.');

    console.log('✅ [Test 10 PASS] App.loadDocuments() 오프라인 비파괴 가드, IDB 목록 복원, 수정 감지 확인');
  }

  // =========================================================================
  // Test 11: Reader.open() 온라인 저장, 오프라인/outdated 배너, SWR 백그라운드 갱신
  // =========================================================================
  console.log('🧪 [Test 11] Reader.open() ZenStorage 영구 저장, 오프라인 폴백 및 배너 렌더링 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();

    const readerEl = reg.getEl('reader-content');

    // 11-A. Online open saves doc to ZenStorage
    setNavigatorOnline(true);
    global.fetch = async (url) => {
      assert.strictEqual(url, '/api/documents/doc-r1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          document: {
            id: 'doc-r1',
            title: '항생제 가이드',
            updatedAt: '2026-11-12T10:00:00.000Z',
            tags: ['감염'],
            blocks: [{ type: 'paragraph', text: '초기 저장 본문' }]
          }
        })
      };
    };

    await Reader.open('doc-r1', false);
    const savedInIdb = await storage.getDocument('doc-r1');
    assert.ok(savedInIdb, '온라인 열람 후 ZenStorage에 문서가 저장되어야 합니다.');
    assert.strictEqual(savedInIdb.title, '항생제 가이드');
    assert.strictEqual(App.offlineDocIds.has('doc-r1'), true);
    assert.strictEqual(readerEl.innerHTML.includes('초기 저장 본문'), true);
    assert.strictEqual(readerEl.innerHTML.includes('reader-cache-banner'), false, '정상 최신 온라인 본문에는 오프라인/구버전 배너가 노출되지 않아야 합니다.');
    Reader.cleanup();

    // 11-B. Offline open renders cached doc immediately with banner-offline
    setNavigatorOnline(false);
    global.fetch = async () => { throw new Error('Should not fetch when offline with cache'); };
    await Reader.open('doc-r1', false);
    assert.strictEqual(readerEl.innerHTML.includes('초기 저장 본문'), true);
    assert.strictEqual(readerEl.innerHTML.includes('reader-cache-banner banner-offline'), true, '오프라인 열람 시 banner-offline 배너가 렌더링되어야 합니다.');
    assert.strictEqual(readerEl.innerHTML.includes('오프라인 저장본 열람 중'), true);
    Reader.cleanup();

    // 11-C. Outdated doc when fetch fails (or returns SW offline JSON) falls back with banner-outdated
    setNavigatorOnline(true);
    App.documents = [{ id: 'doc-r1', title: '항생제 가이드', updatedAt: '2026-11-15T00:00:00.000Z', hasUpdate: true }];
    global.fetch = async (url) => {
      assert.strictEqual(url, '/api/documents/doc-r1?refresh=true', 'hasUpdate=true 문서는 ?refresh=true로 요청해야 합니다.');
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: false, offline: true, message: '오프라인 상태입니다.' })
      };
    };
    await Reader.open('doc-r1', false);
    assert.strictEqual(readerEl.innerHTML.includes('초기 저장 본문'), true);
    assert.strictEqual(readerEl.innerHTML.includes('reader-cache-banner banner-outdated'), true, '수정본 미동기화 폴백 시 banner-outdated 배너가 렌더링되어야 합니다.');
    assert.strictEqual(readerEl.innerHTML.includes('Reader.refreshCurrentDoc()'), true);
    assert.strictEqual(App.documents[0].hasUpdate, true, '폴백 시에는 hasUpdate=true가 유지되어야 합니다.');
    Reader.cleanup();

    // 11-D. Online 0ms SWR + background revalidation updates ZenStorage & DOM
    App.documents[0].hasUpdate = false;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        document: {
          id: 'doc-r1',
          title: '항생제 가이드',
          updatedAt: '2026-11-15T01:00:00.000Z',
          tags: ['감염'],
          blocks: [{ type: 'paragraph', text: '백그라운드 최신 본문' }]
        }
      })
    });
    await Reader.open('doc-r1', false);
    assert.strictEqual(readerEl.innerHTML.includes('초기 저장 본문'), true, 'SWR로 0ms에 캐시본이 먼저 렌더링되어야 합니다.');
    await Reader._revalidationPromise;
    assert.strictEqual(readerEl.innerHTML.includes('백그라운드 최신 본문'), true, '백그라운드 재검증 후 최신 본문으로 자동 갱신되어야 합니다.');
    const revalidated = await storage.getDocument('doc-r1');
    assert.strictEqual(revalidated.updatedAt, '2026-11-15T01:00:00.000Z');
    Reader.cleanup();

    console.log('✅ [Test 11 PASS] Reader.open() 온라인 영구저장, 오프라인/구버전 배너 및 SWR 백그라운드 갱신 확인');
  }

  // =========================================================================
  // Test 12: App.downloadAllForOffline(false) 증분 동기화 vs forceAll=true
  // =========================================================================
  console.log('🧪 [Test 12] App.downloadAllForOffline() 증분 동기화(Delta Sync) vs 전체 재다운로드 검증');
  {
    resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();

    setNavigatorOnline(true);
    global.confirm = () => true;

    await storage.saveDocument({
      id: 'd-up',
      title: '최신문서',
      updatedAt: '2026-11-10T00:00:00.000Z',
      blocks: [{ type: 'paragraph', text: 'ok' }]
    });
    await storage.saveDocument({
      id: 'd-out',
      title: '수정문서',
      updatedAt: '2026-11-10T00:00:00.000Z',
      blocks: [{ type: 'paragraph', text: 'old' }]
    });

    App.documents = [
      { id: 'd-up', title: '최신문서', updatedAt: '2026-11-10T00:00:00.000Z', hasUpdate: false },
      { id: 'd-out', title: '수정문서', updatedAt: '2026-11-14T00:00:00.000Z', hasUpdate: true },
      { id: 'd-miss', title: '미저장문서', updatedAt: '2026-11-12T00:00:00.000Z', hasUpdate: false }
    ];

    let requestedUrls = [];
    global.fetch = async (url) => {
      requestedUrls.push(url);
      const id = url.replace('/api/documents/', '').split('?')[0];
      const remoteDoc = App.documents.find(d => d.id === id);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          document: {
            id,
            title: remoteDoc.title,
            updatedAt: remoteDoc.updatedAt,
            blocks: [{ type: 'paragraph', text: `synced-${id}` }]
          }
        })
      };
    };

    await App.downloadAllForOffline(false);
    assert.strictEqual(requestedUrls.length, 2, '증분 저장 시 이미 최신인 d-up은 건너뛰고 2건만 다운로드해야 합니다.');
    assert.strictEqual(requestedUrls.some(u => u.includes('/d-up')), false);
    assert.strictEqual(requestedUrls.some(u => u.includes('/d-out?refresh=true')), true);
    assert.strictEqual(requestedUrls.some(u => u.includes('/d-miss')), true);
    assert.ok(await storage.getDocument('d-miss'), 'd-miss가 ZenStorage에 저장되어야 합니다.');
    assert.strictEqual((await storage.getDocument('d-out')).updatedAt, '2026-11-14T00:00:00.000Z');

    // Second incremental run should skip all
    requestedUrls = [];
    await App.downloadAllForOffline(false);
    assert.strictEqual(requestedUrls.length, 0, '모두 최신 상태일 때 증분 저장은 네트워크 요청 없이 종료되어야 합니다.');

    // forceAll = true downloads all 3 with ?refresh=true
    requestedUrls = [];
    await App.downloadAllForOffline(true);
    assert.strictEqual(requestedUrls.length, 3, 'forceAll=true 시 전체 3건 모두 재다운로드해야 합니다.');
    assert.ok(requestedUrls.every(u => u.includes('?refresh=true')), 'forceAll=true 시 모든 요청에 ?refresh=true가 포함되어야 합니다.');

    console.log('✅ [Test 12 PASS] App.downloadAllForOffline() 증분 동기화 및 forceAll 분기 확인');
  }

  // =========================================================================
  // Test 13: sw.js / index.html / offline.js / app.css 정적 무결성 검증
  // =========================================================================
  console.log('🧪 [Test 13] sw.js, index.html, offline.js, app.css 정적 계약 및 버전 정렬 검증');
  {
    const swSrc = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf-8');
    const htmlSrc = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
    const offlineSrc = fs.readFileSync(realOfflineCodePath, 'utf-8');
    const cssSrc = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf-8');
    const notionSrc = fs.readFileSync(path.join(__dirname, '../api/lib/notion.js'), 'utf-8');

    assert.ok(swSrc.includes("const CACHE_NAME = 'zen-reader-v22'"), 'sw.js CACHE_NAME이 zen-reader-v22여야 합니다.');
    assert.ok(swSrc.includes("'/js/vendor/mermaid.min.js'"), 'sw.js STATIC_ASSETS에 /js/vendor/mermaid.min.js가 포함되어야 합니다.');
    assert.ok(swSrc.includes("const DATA_CACHE_NAME = 'zen-data-v1'"), 'sw.js DATA_CACHE_NAME이 zen-data-v1이어야 합니다.');
    assert.ok(
      swSrc.includes('PRESERVED_CACHES = [CACHE_NAME, DATA_CACHE_NAME, IMAGE_CACHE_NAME]'),
      'sw.js activate 단계에서 DATA_CACHE_NAME이 PRESERVED_CACHES에 보존되어야 합니다.'
    );
    assert.ok(swSrc.includes('event.waitUntil(cacheWritePromise)'), 'sw.js /api/* 캐시 쓰기가 event.waitUntil로 감싸져야 합니다.');
    assert.ok(
      swSrc.includes('if (isCodeAsset)') &&
      swSrc.includes('caches.match(event.request, { ignoreSearch: true })') &&
      swSrc.includes("status: 503"),
      'sw.js Section C는 JS/CSS 오프라인 폴백 시 ignoreSearch를 사용하고 /index.html 대신 503을 반환해야 합니다.'
    );
    assert.ok(
      swSrc.includes("if (event.request.mode === 'navigate')"),
      'sw.js Section D는 navigate 요청일 때만 /index.html로 폴백해야 합니다.'
    );

    assert.strictEqual(htmlSrc.includes('v20261108_v17'), false, 'index.html에 구버전 v17 쿼리스트링이 남아있으면 안 됩니다.');
    assert.strictEqual(htmlSrc.includes('v20261115_v18'), false, 'index.html에 구버전 v18 쿼리스트링이 남아있으면 안 됩니다.');
    assert.strictEqual(htmlSrc.includes('v20261115_v19'), false, 'index.html에 구버전 v19 쿼리스트링이 남아있으면 안 됩니다.');
    assert.strictEqual(htmlSrc.includes('v20261115_v20'), false, 'index.html에 구버전 v20 쿼리스트링이 남아있으면 안 됩니다.');
    assert.strictEqual(htmlSrc.includes('v20261115_v21'), false, 'index.html에 구버전 v21 쿼리스트링이 남아있으면 안 됩니다.');
    const v22Matches = htmlSrc.match(/\?v=20261115_v22/g) || [];
    assert.strictEqual(v22Matches.length, 8, 'index.html의 app.css + mermaid + 6개 script 태그 모두 ?v=20261115_v22여야 합니다.');
    assert.ok(swSrc.includes("const CACHE_NAME = 'zen-reader-v22';"), 'sw.js CACHE_NAME이 zen-reader-v22여야 합니다.');
    assert.ok(htmlSrc.includes('id="header-resume-btn"'), 'index.html 우상단에 이어 읽기 버튼(#header-resume-btn)이 있어야 합니다.');
    assert.ok(htmlSrc.includes('id="mermaid-zoom-modal"'), 'index.html에 Mermaid 확대 모달(#mermaid-zoom-modal)이 있어야 합니다.');
    assert.ok(cssSrc.includes('.zen-mermaid-card') && cssSrc.includes('.tok-kw'), 'app.css에 Mermaid 카드 및 구문 강조 스타일이 포함되어야 합니다.');

    assert.ok(/DB_VERSION:\s*2\b/.test(offlineSrc), 'offline.js의 DB_VERSION이 2여야 합니다.');
    assert.ok(offlineSrc.includes('ZenStorage.openDB()'), 'offline.js가 ZenStorage.openDB()에 위임해야 합니다.');

    [
      '.doc-card.card-offline-unavailable',
      '.badge-doc-uncached',
      '.reader-cache-banner',
      '.reader-cache-banner.banner-offline',
      '.reader-cache-banner.banner-outdated',
      '.cache-stats-grid',
      '.cache-stat-pill',
      '.cache-actions-row',
      '.offline-filter-pill',
      '.zen-dock-feedback-popover',
      '.btn-feedback-easy.active',
      '.study-checkin-status',
      '.is-loading',
      '.icon-spin-target',
      '.view-enter',
      '.status-dot',
      '.pin-modal-icon',
      '.doc-card-header-row',
      '.doc-card-badges'
    ].forEach(cls => {
      assert.ok(cssSrc.includes(cls), `app.css에 ${cls} 스타일이 정의되어 있어야 합니다.`);
    });
    assert.ok(cssSrc.includes('min-width: 96px'), 'app.css .doc-card-badges에 최소 슬롯 너비가 고정되어 있어야 합니다.');
    assert.ok(cssSrc.includes('-webkit-line-clamp: 2'), 'app.css .doc-card-title은 최대 2행(-webkit-line-clamp: 2)으로 제한되어야 합니다.');
    assert.ok(!/\.offline-filter-pill:active\s*\{[\s\S]*?\}\s*color:\s*var\(--text-primary\)/.test(cssSrc), 'app.css에 깨진 CSS 중괄호 잔재가 없어야 합니다.');

    assert.ok(notionSrc.includes('createConcurrencyLimiter(3)'), 'api/lib/notion.js에 동시성 3 제한기가 적용되어 있어야 합니다.');

    console.log('✅ [Test 13 PASS] sw.js, index.html, offline.js, app.css, notion.js 정적 무결성 확인');
  }

  // =========================================================================
  // Test 14: Settings.load / render / pruneOrphans / clearDocCacheOnly 통합 검증
  // =========================================================================
  console.log('🧪 [Test 14] Settings 탭 캐시 요약/고아 정리/studyLogs 보존 초기화 통합 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();
    const settingsSrc = fs.readFileSync(realSettingsCodePath, 'utf-8');
    eval(settingsSrc.replace('const Settings =', 'global.Settings ='));

    const mockIdb = createMockIndexedDB([
      { id: 1, docId: 'doc-1', docTitle: '약물1', reviewCount: 1, readAt: '2026-11-10T00:00:00.000Z', timestamp: '2026-11-10T00:00:00.000Z' }
    ]);
    global.window.indexedDB = mockIdb.indexedDB;
    global.OfflineManager = { isPersisted: false, getQueue: () => [] };
    setNavigatorOnline(true);
    global.confirm = () => true;

    await storage.openDB();
    await storage.saveDocument({ id: 'doc-1', title: '약물1', updatedAt: '2026-11-10T00:00:00.000Z', blocks: [{ type: 'paragraph', text: 'A' }] });
    await storage.saveDocument({ id: 'doc-orphan', title: '고아', updatedAt: '2026-11-08T00:00:00.000Z', blocks: [{ type: 'paragraph', text: 'B' }] });

    App.documents = [
      { id: 'doc-1', title: '약물1', updatedAt: '2026-11-10T00:00:00.000Z' },
      { id: 'doc-2', title: '약물2', updatedAt: '2026-11-11T00:00:00.000Z' }
    ];

    const settingsEl = reg.getEl('settings-content');
    await Settings.load();
    assert.strictEqual(settingsEl.innerHTML.includes('일반 보존 (요청 대기)'), true, 'isPersisted=false일 때 일반 보존 (요청 대기)가 표시되어야 합니다.');
    assert.strictEqual(settingsEl.innerHTML.includes('저장 완료: <strong>2 / 2건</strong> (미저장 1건, 업데이트 필요 0건)'), true, '캐시 요약 수치가 정확히 표시되어야 합니다.');
    assert.strictEqual(settingsEl.innerHTML.includes('고아 문서 1건 정리 가능'), true);
    assert.strictEqual(settingsEl.innerHTML.includes('Settings.pruneOrphans()'), true);
    assert.strictEqual(settingsEl.innerHTML.includes('Settings.clearDocCacheOnly()'), true);

    const deletedOrphans = await Settings.pruneOrphans();
    assert.strictEqual(deletedOrphans, 1, 'Settings.pruneOrphans()가 고아 문서 1건을 정리해야 합니다.');
    assert.strictEqual(await storage.getDocument('doc-orphan'), null);

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, documents: App.documents })
    });
    await Settings.clearDocCacheOnly();
    assert.strictEqual(await storage.getDocument('doc-1'), null, '문서 캐시 비우기 후 doc-1 본문이 삭제되어야 합니다.');
    const logsAfterClear = await storage.getAllLogs();
    assert.strictEqual(logsAfterClear.length, 1, 'Settings.clearDocCacheOnly() 실행 후에도 학습 기록(studyLogs)은 100% 보존되어야 합니다.');

    delete global.window.indexedDB;
    console.log('✅ [Test 14 PASS] Settings 오프라인 캐시 관리 패널, 고아 정리, studyLogs 보존 검증 완료');
  }

  // =========================================================================
  // Test 15: 플로팅 독 완료 버튼 피드백 팝오버 선택 검증
  // =========================================================================
  console.log('🧪 [Test 15] 플로팅 독 완료 버튼 -> 기억체감도 팝오버 선택 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();
    const mockIdb = createMockIndexedDB();
    global.window.indexedDB = mockIdb.indexedDB;
    global.localStorage._store = {};
    await storage.openDB();

    global.OfflineManager = {
      isOnline: true,
      sendStudyLog: async () => ({ success: true }),
      updateStudyLogFeedback: async () => ({ success: true })
    };

    App.documents = [{ id: 'doc-fb1', title: '고혈압 약제', reviewCount: 2 }];
    Reader.currentDoc = { id: 'doc-fb1', title: '고혈압 약제', reviewCount: 2 };
    Reader.hasLoggedStudy = false;
    Reader.currentFeedback = null;
    Reader.isDockFeedbackOpen = false;
    Reader.durationSeconds = 95;

    Reader.toggleDockFeedbackPicker();
    const popover = reg.getEl('zen-dock-feedback-popover');
    assert.strictEqual(Reader.isDockFeedbackOpen, true, '팝오버가 열려야 합니다.');
    assert.strictEqual(popover.style.display, 'block', '팝오버 display가 block이어야 합니다.');
    assert.strictEqual(reg.getEl('dock-feedback-popover-title').innerText, '기억 체감도 선택');

    await Reader.selectFeedbackFromDock('hard');
    assert.strictEqual(Reader.isDockFeedbackOpen, false, '피드백 선택 후 팝오버가 자동으로 닫혀야 합니다.');
    assert.strictEqual(Reader.hasLoggedStudy, true, '체크인이 완료되어야 합니다.');
    assert.strictEqual(Reader.currentFeedback, 'hard', '선택한 기억체감도(hard)가 기록되어야 합니다.');
    assert.strictEqual(Reader.currentDoc.reviewCount, 3, '최초 선택 시 회독수가 2 -> 3으로 1회만 증가해야 합니다.');

    const logs = await storage.getAllLogs();
    assert.strictEqual(logs.length, 1, 'IDB 로그가 정확히 1건만 생성되어야 합니다.');
    assert.strictEqual(logs[0].feedback, 'hard', 'IDB 로그에 hard 피드백이 저장되어야 합니다.');
    assert.ok(reg.getEl('dock-checkin-btn').innerHTML.includes('헷갈림'), '플로팅 독 완료 버튼 라벨에 선택한 체감도가 반영되어야 합니다.');

    delete global.window.indexedDB;
    console.log('✅ [Test 15 PASS] 플로팅 독 기억체감도 팝오버 선택 및 1회 기록 검증 완료');
  }

  // =========================================================================
  // Test 16: 동일 세션 내 기억체감도 정정 (실수 클릭 변경 & 오프라인 큐 제자리 갱신)
  // =========================================================================
  console.log('🧪 [Test 16] 실수 선택 정정 시 회독수 유지 및 오프라인 큐 제자리 수정 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();
    const offlineSrc = fs.readFileSync(realOfflineCodePath, 'utf-8');
    eval(offlineSrc.replace('const OfflineManager =', 'global.OfflineManager ='));

    const mockIdb = createMockIndexedDB();
    global.window.indexedDB = mockIdb.indexedDB;
    global.localStorage._store = {};
    setNavigatorOnline(false);
    OfflineManager.isOnline = false;
    await storage.openDB();

    Reader.currentDoc = { id: 'doc-fb2', title: '당뇨병 GLP-1', reviewCount: 0 };
    Reader.hasLoggedStudy = false;
    Reader.currentLogId = null;
    Reader.currentClientLogId = null;
    Reader.currentFeedback = null;
    Reader.durationSeconds = 120;

    // 1차 실수 선택: easy
    await Reader.triggerManualCheckin('easy');
    assert.strictEqual(Reader.currentDoc.reviewCount, 1);
    assert.strictEqual(Reader.currentFeedback, 'easy');
    assert.strictEqual(OfflineManager.getQueue().length, 1, '오프라인 큐에 1건이 적재되어야 합니다.');
    assert.strictEqual(OfflineManager.getQueue()[0].feedback, 'easy');

    // 2차 정정 선택: hard (회독수 및 큐 길이 증가 금지!)
    await Reader.triggerManualCheckin('hard');
    assert.strictEqual(Reader.currentDoc.reviewCount, 1, '피드백 정정 시 회독수가 중복 증가하면 안 됩니다.');
    assert.strictEqual(Reader.currentFeedback, 'hard', '현재 세션 피드백이 hard로 갱신되어야 합니다.');

    const queue = OfflineManager.getQueue();
    assert.strictEqual(queue.length, 1, '오프라인 큐 항목 수가 1건으로 유지(제자리 갱신)되어야 합니다.');
    assert.strictEqual(queue[0].feedback, 'hard', '큐 항목의 feedback이 hard로 수정되어야 합니다.');

    const logs = await storage.getAllLogs();
    assert.strictEqual(logs.length, 1, 'IndexedDB 로그 건수도 1건으로 유지되어야 합니다.');
    assert.strictEqual(logs[0].feedback, 'hard', 'IndexedDB 로그의 feedback이 hard로 갱신되어야 합니다.');

    assert.strictEqual(reg.getEl('fb-btn-easy').classList.contains('active'), false);
    assert.strictEqual(reg.getEl('fb-btn-hard').classList.contains('active'), true);
    assert.ok(reg.getEl('study-checkin-status').innerHTML.includes('헷갈림'), '상태 안내 문구도 hard 기준으로 갱신되어야 합니다.');

    // 팝오버 타이틀도 정정 모드로 전환되어야 함
    Reader.toggleDockFeedbackPicker(true);
    assert.strictEqual(reg.getEl('dock-feedback-popover-title').innerText, '기억 체감도 변경 (실수 정정)');

    delete global.window.indexedDB;
    console.log('✅ [Test 16 PASS] 피드백 실수 정정 시 IDB/오프라인 큐/UI 무중복 갱신 검증 완료');
  }

  // =========================================================================
  // Test 17: 서재 탭 "오프라인만 보기" 필터 조합 및 카운트 검증
  // =========================================================================
  console.log('🧪 [Test 17] 서재 탭 오프라인 열람 가능 문서 모아보기 필터 검증');
  {
    const reg = resetDomMocks();
    loadFreshZenStorage();
    loadFreshAppAndReader();
    global.localStorage._store = {};

    App.documents = [
      { id: 'd-off-1', title: '저장됨-완료', status: '완료', createdAt: '2026-11-10T00:00:00Z', isCachedLocally: true },
      { id: 'd-on-2', title: '미저장-완료', status: '완료', createdAt: '2026-11-11T00:00:00Z', isCachedLocally: false },
      { id: 'd-off-3', title: '저장됨-진행', status: '진행 중', createdAt: '2026-11-12T00:00:00Z', isCachedLocally: false }
    ];
    App.offlineDocIds = new Set(['d-off-1', 'd-off-3']);
    App.selectedStatus = 'all';
    App.onlyOfflineCached = false;

    App.updateStatusPillCounts();
    assert.strictEqual(String(reg.getEl('count-all').innerText), '3');
    assert.strictEqual(String(reg.getEl('count-offline').innerText), '2');

    // 오프라인만 토글 ON
    App.toggleOfflineOnlyFilter();
    assert.strictEqual(App.onlyOfflineCached, true);
    assert.strictEqual(global.localStorage.getItem('zen_filter_offline_only'), 'true');
    assert.strictEqual(reg.getEl('btn-offline-only-filter').classList.contains('active'), true);
    assert.strictEqual(App.filteredDocuments.length, 2, '오프라인 저장된 2개 문서만 노출되어야 합니다.');
    assert.deepStrictEqual(App.filteredDocuments.map(d => d.id), ['d-off-3', 'd-off-1']);
    assert.strictEqual(String(reg.getEl('count-all').innerText), '2', '오프라인만 모드에서는 상태 카운트도 오프라인 모수로 연동됩니다.');
    assert.strictEqual(String(reg.getEl('count-offline').innerText), '2', '전체 오프라인 저장 개수는 유지되어야 합니다.');

    // 상태 필터('완료')와 교차 조합
    App.setStatusFilter('완료');
    assert.strictEqual(App.filteredDocuments.length, 1);
    assert.strictEqual(App.filteredDocuments[0].id, 'd-off-1');

    // 필터 해제 시 원상복구
    App.toggleOfflineOnlyFilter(false);
    assert.strictEqual(App.onlyOfflineCached, false);
    assert.strictEqual(reg.getEl('btn-offline-only-filter').classList.contains('active'), false);
    assert.strictEqual(App.filteredDocuments.length, 2, '오프라인 필터 해제 시 상태(완료)에 해당하는 2개 모두 노출되어야 합니다.');

    console.log('✅ [Test 17 PASS] 서재 탭 오프라인만 모아보기 및 교차 필터링 검증 완료');
  }

  // =========================================================================
  // Test 18: 서버 storage.js updateLogFeedback 및 중복 ID 방지 검증
  // =========================================================================
  console.log('🧪 [Test 18] 서버 api/lib/storage.js updateLogFeedback 및 clientLogId 중복 방지 검증');
  {
    const logFilePath = path.join(__dirname, '../data/study-logs.json');
    const hadFile = fs.existsSync(logFilePath);
    const originalContent = hadFile ? fs.readFileSync(logFilePath, 'utf-8') : null;

    try {
      const storageApi = require('../api/lib/storage');
      const testId = 'log-test-v19-' + Date.now();
      const first = storageApi.saveLog({
        id: testId,
        docId: 'doc-api-test',
        docTitle: 'API 피드백 정정 테스트',
        durationSeconds: 45,
        reviewCount: 1,
        feedback: 'easy'
      });
      assert.strictEqual(first.id, testId);
      assert.strictEqual(first.feedback, 'easy');

      // 동일 id로 updateLogFeedback 호출
      const res = storageApi.updateLogFeedback({ id: testId, docId: 'doc-api-test', feedback: 'hard' });
      assert.strictEqual(res.updated, true);
      assert.strictEqual(res.log.feedback, 'hard');

      // 동일 id 재전송 시 중복 추가 없이 갱신
      const afterDuplicateSave = storageApi.saveLog({
        id: testId,
        docId: 'doc-api-test',
        feedback: 'good'
      });
      assert.strictEqual(afterDuplicateSave.id, testId);
      assert.strictEqual(afterDuplicateSave.feedback, 'good');

      const allAfter = storageApi.readAllLogs().filter(l => l.id === testId);
      assert.strictEqual(allAfter.length, 1, '동일 clientLogId 로그는 서버에도 단 1건만 유지되어야 합니다.');

      console.log('✅ [Test 18 PASS] 서버 측 피드백 수정 및 동일 clientLogId 중복 방지 검증 완료');
    } finally {
      if (hadFile) {
        fs.writeFileSync(logFilePath, originalContent, 'utf-8');
      } else if (fs.existsSync(logFilePath)) {
        fs.unlinkSync(logFilePath);
      }
    }
  }

  // =========================================================================
  // Test 19: v20 새로고침 중복 연타 방지 락 & .is-loading 피드백 상태 정리 검증
  // =========================================================================
  console.log('🧪 [Test 19] 수동 새로고침 연타 방지 락(_isRefreshingDocs / _isRefreshingCurrent) 및 로딩 상태 복구 검증');
  {
    const reg = resetDomMocks();
    loadFreshZenStorage();
    loadFreshAppAndReader();
    setNavigatorOnline(true);

    const headerRefreshBtn = reg.getEl('header-refresh-btn');
    const readerRefreshBtn = reg.getEl('btn-reader-pinpoint-refresh');

    // Mock fetch that holds open until released
    let releaseDocsFetch;
    let docsFetchCount = 0;
    global.fetch = (url) => {
      if (url.startsWith('/api/documents?')) {
        docsFetchCount++;
        return new Promise(resolve => {
          releaseDocsFetch = () => resolve({
            ok: true,
            status: 200,
            json: async () => ({ documents: [{ id: 'd1', title: '테스트 문서', tags: [], updatedAt: '2026-11-15T00:00:00.000Z' }] })
          });
        });
      }
      if (url === '/api/study-log') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ stats: {} }) });
      }
      if (url.startsWith('/api/documents/d1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            document: { id: 'd1', title: '테스트 문서', updatedAt: '2026-11-15T01:00:00.000Z', blocks: [] }
          })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    };

    const p1 = App.loadDocuments(true, headerRefreshBtn);
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(App._isRefreshingDocs, true, '수동 새로고침 진행 중에는 _isRefreshingDocs가 true여야 합니다.');
    assert.strictEqual(headerRefreshBtn.disabled, true, '새로고침 진행 중에는 헤더 버튼이 disabled 상태여야 합니다.');
    assert.ok(headerRefreshBtn.classList.contains('is-loading'), '새로고침 진행 중에는 .is-loading 클래스가 부여되어야 합니다.');

    // 중복 연타 호출 -> 즉시 무시되어야 함
    await App.loadDocuments(true, headerRefreshBtn);
    assert.strictEqual(docsFetchCount, 1, '진행 중인 수동 새로고침 중 연타 시 추가 API 호출이 차단되어야 합니다.');

    releaseDocsFetch();
    await p1;
    assert.strictEqual(App._isRefreshingDocs, false, '완료 후 _isRefreshingDocs 락이 해제되어야 합니다.');
    assert.strictEqual(headerRefreshBtn.disabled, false, '완료 후 헤더 버튼 disabled가 해제되어야 합니다.');
    assert.strictEqual(headerRefreshBtn.classList.contains('is-loading'), false, '완료 후 .is-loading 클래스가 제거되어야 합니다.');

    // 뷰어 핀포인트 새로고침 락 검증
    Reader.currentDoc = { id: 'd1', title: '테스트 문서', updatedAt: '2026-11-15T00:00:00.000Z', blocks: [] };
    let releaseReaderFetch;
    let readerFetchCount = 0;
    global.fetch = (url) => {
      if (url.startsWith('/api/documents/d1')) {
        readerFetchCount++;
        return new Promise(resolve => {
          releaseReaderFetch = () => resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              document: { id: 'd1', title: '테스트 문서', updatedAt: '2026-11-15T02:00:00.000Z', blocks: [] }
            })
          });
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    };

    const r1 = Reader.refreshCurrentDoc();
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(Reader._isRefreshingCurrent, true, '뷰어 새로고침 진행 중 _isRefreshingCurrent가 true여야 합니다.');
    assert.strictEqual(readerRefreshBtn.disabled, true, '뷰어 새로고침 버튼이 disabled 상태여야 합니다.');
    await Reader.refreshCurrentDoc();
    assert.strictEqual(readerFetchCount, 1, '뷰어 새로고침 중 연타 시 추가 API 요청이 차단되어야 합니다.');

    releaseReaderFetch();
    await r1;
    assert.strictEqual(Reader._isRefreshingCurrent, false, '완료 후 _isRefreshingCurrent 락이 해제되어야 합니다.');
    assert.strictEqual(readerRefreshBtn.disabled, false, '완료 후 뷰어 새로고침 버튼 disabled가 해제되어야 합니다.');

    console.log('✅ [Test 19 PASS] 수동 새로고침 중복 연타 방지 및 로딩 상태 정리 검증 완료');
  }

  // =========================================================================
  // Test 20: v21 서재 카드 헤더 통일(.doc-card-header-row) & 이어 읽기(openLastReadDoc) 검증
  // =========================================================================
  console.log('🧪 [Test 20] v21 카드 우측 뱃지 슬롯 통일 및 우상단 이어 읽기 동작 검증');
  {
    const reg = resetDomMocks();
    const storage = loadFreshZenStorage();
    loadFreshAppAndReader();

    await storage.saveDocument({
      id: 'doc-cinn',
      title: '신나리진 어지럼증 전정기능장애 감별 및 1차 약물 선택 기준 페이지',
      updatedAt: '2026-11-15T00:00:00.000Z',
      blocks: []
    });

    App.documents = [
      { id: 'doc-cinn', title: '신나리진 어지럼증 전정기능장애 감별 및 1차 약물 선택 기준 페이지', status: '시작 전', reviewCount: 0, createdAt: '2026-11-14T00:00:00.000Z', tags: ['이비인후과'] },
      { id: 'doc-betahist', title: '베타히스틴 메니에르병 장기 유지 요법 핵심 정리 페이지', status: '완료', reviewCount: 2, createdAt: '2026-11-13T00:00:00.000Z', tags: ['이비인후과'] }
    ];
    App.filteredDocuments = [...App.documents];
    App.renderDocumentList();

    const listHtml = reg.getEl('doc-card-list').innerHTML;
    const headerRowMatches = listHtml.match(/class="doc-card-header-row"/g) || [];
    const badgeSlotMatches = listHtml.match(/class="doc-card-badges"/g) || [];
    assert.strictEqual(headerRowMatches.length, 2, '회독 유무와 관계없이 모든 카드가 doc-card-header-row로 렌더링되어야 합니다.');
    assert.strictEqual(badgeSlotMatches.length, 2, '회독 유무와 관계없이 모든 카드가 고정폭 doc-card-badges 슬롯을 가져야 합니다.');

    // 최근 학습 이어 읽기 검증
    let openedIds = [];
    const origOpen = Reader.open.bind(Reader);
    Reader.open = async (id) => {
      openedIds.push(id);
      localStorage.setItem('zen_last_read_doc_id', id);
    };

    // 이력 없을 때는 미완료 우선 문서 오픈
    App.openLastReadDoc();
    assert.strictEqual(openedIds[0], 'doc-cinn', '최근 열람 이력이 없을 때 미완료 첫 문서로 폴백해야 합니다.');

    // 특정 문서 열람 후 이어 읽기 호출 시 해당 문서 오픈
    await Reader.open('doc-betahist');
    App.openLastReadDoc();
    assert.strictEqual(openedIds[openedIds.length - 1], 'doc-betahist', '최근 열람 문서 ID(zen_last_read_doc_id)를 우선 열람해야 합니다.');
    Reader.open = origOpen;

    console.log('✅ [Test 20 PASS] 카드 제목 영역 통일 및 이어 읽기 동작 검증 완료');
  }

  // =========================================================================
  // Test 21: v22 Mermaid 다이어그램 카드, 코드/마크다운 구문 강조, heading_4, Callout 색상
  // =========================================================================
  console.log('🧪 [Test 21] v22 Mermaid 카드, 코드 구문 강조(XSS 포함), heading_4 및 Callout 색상 검증');
  {
    Reader.headingsList = [];
    Reader.headingCounter = 0;
    Reader.mermaidCounter = 0;
    Reader._mermaidSources = {};

    const sampleBlocks = [
      { type: 'heading_4', text: 'Table 2: 핵심 평가변수', html: 'Table 2: 핵심 평가변수' },
      { type: 'callout', icon: '🎨', color: 'blue_background', text: '색상 범례', html: '<strong>색상 범례</strong>', children: [] },
      { type: 'code', language: 'mermaid', code: 'flowchart TD\n    A["CKD (eGFR >=20)"] -->|"권고 1A"| B["SGLT2i 개시"]' },
      { type: 'code', language: 'markdown', code: '# CKD 2027 요약\n> 핵심 권고: `SGLT2i` **1A**\n- K+ <=4.8 mmol/L --> 개시 가능\n<script>alert(1)</script>' }
    ];

    const rendered = Reader.renderBlocks(sampleBlocks);

    assert.ok(rendered.includes('<h4 id="zen-heading-1">Table 2: 핵심 평가변수</h4>'), 'heading_4가 h4 태그로 렌더링되어야 합니다.');
    assert.strictEqual(Reader.headingsList.length, 0, 'heading_4는 우측 플로팅 TOC dot 레일에 중복 적재되지 않아야 합니다.');
    assert.ok(rendered.includes('zen-callout notion-callout-blue_background'), 'callout 블록 배경색 클래스가 반영되어야 합니다.');
    assert.ok(rendered.includes('zen-mermaid-card'), 'mermaid 코드 블록이 다이어그램 카드(.zen-mermaid-card)로 변환되어야 합니다.');
    assert.ok(rendered.includes('FLOWCHART TD'), 'Mermaid 헤더에 다이어그램 유형 뱃지가 표시되어야 합니다.');
    assert.ok(rendered.includes('Reader.openMermaidModal('), 'Mermaid 확대 모달 버튼이 포함되어야 합니다.');
    assert.ok(rendered.includes('Reader.toggleMermaidFit(') && rendered.includes('둘러보기'), 'Mermaid 카드에 터치 둘러보기 전환 버튼이 포함되어야 합니다.');
    assert.ok(rendered.includes('zen-mermaid-stage'), 'Mermaid 카드에 2D 팬·줌 스테이지(.zen-mermaid-stage)가 포함되어야 합니다.');
    assert.ok(rendered.includes('tok-heading') && rendered.includes('tok-str') && rendered.includes('tok-kw') && rendered.includes('tok-op'), 'Markdown 코드 블록에 다중 색상 구문 강조 토큰 클래스가 적용되어야 합니다.');
    assert.ok(!rendered.includes('<script>') && rendered.includes('&lt;script&gt;') && rendered.includes('&lt;/script&gt;'), '구문 강조 후에도 XSS 태그가 안전하게 이스케이프되어야 합니다.');

    console.log('✅ [Test 21 PASS] v22 Mermaid 카드, 코드 구문 강조 및 정합성 패치 검증 완료');
  }

  // =========================================================================
  // Test 22: v22 2D 팬·줌 엔진 & 우측 반투명 TOC 패스트 스크롤 계약 검증
  // =========================================================================
  console.log('🧪 [Test 22] Mermaid 2D 팬·줌, TOC 레일 반투명 대기, 패스트 스크롤 및 스와이프 충돌 가드 검증');
  {
    const readerSrc = fs.readFileSync(path.join(__dirname, '../public/js/reader.js'), 'utf-8');
    const cssSrc = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf-8');

    assert.strictEqual(typeof Reader.bindPanZoomSurface, 'function', 'Reader.bindPanZoomSurface 메서드가 존재해야 합니다.');
    assert.strictEqual(typeof Reader.setMermaidCardExplore, 'function', 'Reader.setMermaidCardExplore 메서드가 존재해야 합니다.');
    assert.strictEqual(typeof Reader.toggleMermaidModalRotate, 'function', 'Reader.toggleMermaidModalRotate 메서드가 존재해야 합니다.');
    assert.strictEqual(typeof Reader.fitMermaidModal, 'function', 'Reader.fitMermaidModal 메서드가 존재해야 합니다.');
    assert.strictEqual(typeof Reader.wakeTocRail, 'function', 'Reader.wakeTocRail 메서드가 존재해야 합니다.');
    assert.strictEqual(typeof Reader.scrubTocToClientY, 'function', 'Reader.scrubTocToClientY 메서드가 존재해야 합니다.');

    assert.ok(cssSrc.includes('.zen-toc-rail.is-idle') && cssSrc.includes('.zen-toc-scrub-pill.visible'), 'app.css에 TOC 레일 반투명 상태 및 실시간 스크러버 말풍선 스타일이 있어야 합니다.');
    assert.ok(cssSrc.includes('.zen-mermaid-card.is-explore .zen-mermaid-viewport') && cssSrc.includes('touch-action: none'), 'app.css에 카드 내 2D 탐색 모드(touch-action: none) 스타일이 있어야 합니다.');
    assert.ok(cssSrc.includes('.mermaid-zoom-box.is-rotated') && cssSrc.includes('rotate(90deg)'), 'app.css에 다이어그램 뷰어 전용 90도 가로 회전 스타일이 있어야 합니다.');
    assert.ok(readerSrc.includes("tgt.closest('#zen-toc-rail, .zen-mermaid-card.is-explore, #mermaid-zoom-modal')"), '가장자리 스와이프 뒤로가기(setupSwipeToBack)가 TOC 스크러버/다이어그램 탐색 중 오작동을 차단해야 합니다.');

    console.log('✅ [Test 22 PASS] Mermaid 2D 팬·줌 및 우측 반투명 TOC 패스트 스크롤 검증 완료');
  }
}
