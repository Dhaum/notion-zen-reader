// public/js/offline.js - 태블릿 PWA 영구 저장소(IndexedDB + Persistent Storage 락) 및 오프라인 동기화 매니저
const OfflineManager = {
  isOnline: navigator.onLine,
  QUEUE_KEY: 'zen_offline_study_queue',
  LOCAL_LOGS_KEY: 'zen_permanent_logs',
  DB_NAME: 'ZenReaderDB',
  DB_VERSION: 1,
  STORE_NAME: 'studyLogs',
  isPersisted: false,
  dbInstance: null,

  async init() {
    this.updateStatusBadge();

    // 1. 브라우저 영구 보존 락(Persistent Storage) 획득
    await this.requestPersistentStorage();

    // 2. 브라우저 내부 IndexedDB 초기화
    await this.initIndexedDB();

    // 3. 온라인/오프라인 네트워크 상태 이벤트 감지
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateStatusBadge();
      this.flushQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateStatusBadge();
    });

    // 앱 기동 시 큐에 대기 중인 항목이 있다면 자동 플러시 시도
    if (this.isOnline) {
      setTimeout(() => this.flushQueue(), 1500);
    }
  },

  // 태블릿 크롬이 저장공간 부족 시 임의로 캐시/데이터를 날리지 못하도록 영구 보존 락 요청
  async requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) {
          this.isPersisted = true;
          console.log('[Storage Lock] 🔒 영구 스토리지(Persistent Storage) 보존 락이 이미 승인되어 있습니다.');
        } else {
          const granted = await navigator.storage.persist();
          this.isPersisted = granted;
          if (granted) {
            console.log('[Storage Lock] 🔒 영구 스토리지(Persistent Storage) 보존 락 승인 획득 완료! (OS 캐시 자동 청소 면제)');
          } else {
            console.warn('[Storage Lock] ⚠️ 브라우저가 영구 스토리지 요청을 수락하지 않았습니다 (Best-effort 유지).');
          }
        }

        // 스토리지 사용량 및 할당량 로깅
        if (navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
          const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(2);
          console.log(`[Storage Estimate] 현재 사용량: ${usedMB} MB / 총 할당량: ${quotaMB} MB`);
        }

        return this.isPersisted;
      } catch (err) {
        console.warn('[Storage Lock] 영구 보존 락 요청 중 오류:', err);
        return false;
      }
    } else {
      console.log('[Storage Lock] 현재 브라우저 환경에서는 navigator.storage.persist를 지원하지 않습니다.');
      return false;
    }
  },

  // IndexedDB 비동기 영구 저장소 열기
  openDB() {
    return new Promise((resolve, reject) => {
      if (this.dbInstance) {
        return resolve(this.dbInstance);
      }

      if (!window.indexedDB) {
        console.warn('[IndexedDB] 브라우저가 IndexedDB를 지원하지 않습니다.');
        return reject(new Error('IndexedDB not supported'));
      }

      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          console.log(`[IndexedDB] 신규 스토어 '${this.STORE_NAME}' 생성`);
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('docId', 'docId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('readAt', 'readAt', { unique: false });
          store.createIndex('reviewCount', 'reviewCount', { unique: false });
          store.createIndex('synced', 'synced', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.dbInstance = event.target.result;
        resolve(this.dbInstance);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] 데이터베이스 오픈 실패:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  async initIndexedDB() {
    try {
      await this.openDB();
      console.log(`[IndexedDB] '${this.DB_NAME}.${this.STORE_NAME}' 데이터베이스 초기화 완료`);
    } catch (err) {
      console.warn('[IndexedDB] 초기화 실패:', err);
    }
  },

  // IndexedDB에 단일 학습 로그 기록
  async saveToIndexedDB(record) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] 로그 저장 오류:', err);
      return null;
    }
  },

  // IndexedDB에 보존된 전체 학습 로그 조회
  async getAllFromIndexedDB() {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn('[IndexedDB] 로그 전체 조회 오류:', err);
      return [];
    }
  },

  updateStatusBadge() {
    const badge = document.getElementById('network-status-badge');
    if (!badge) return;
    if (this.isOnline) {
      badge.className = 'badge-status badge-online';
      badge.innerHTML = '● 온라인';
    } else {
      badge.className = 'badge-status badge-offline';
      badge.innerHTML = '● 오프라인 (캐시)';
    }
  },

  // 학습 로그 전송 (로컬 기기 2중 영구 저장 + 오프라인 큐 보관)
  async sendStudyLog(payload) {
    // 1. 태블릿 브라우저 2중 안전망 (IndexedDB + localStorage) 영구 저장
    await this.savePermanentLocalLog(payload);

    if (!this.isOnline) {
      console.log('[offline] 오프라인 상태: 학습 로그를 로컬 큐에 임시 저장합니다.', payload);
      this.addToQueue(payload);
      return { success: true, queued: true };
    }

    try {
      const response = await fetch('/api/study-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zen-pin': localStorage.getItem('zen_pin_code') || '1234'
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return data;
    } catch (err) {
      console.warn('[offline] 서버 전송 실패, 로컬 큐로 전환:', err.message);
      this.addToQueue(payload);
      return { success: true, queued: true };
    }
  },

  // 2중 로컬 안전망: 브라우저 샌드박스 내부 IndexedDB + localStorage 동시 미러링
  async savePermanentLocalLog(payload) {
    const nowIso = new Date().toISOString();
    const logRecord = {
      docId: payload.docId,
      docTitle: payload.docTitle,
      durationSeconds: payload.durationSeconds || 0,
      reviewCount: payload.reviewCount || 1,
      device: payload.device || 'alldocube-iplay60',
      timestamp: nowIso,
      readAt: nowIso,
      synced: this.isOnline
    };

    // 1단계 안전망: IndexedDB 비동기 영구 저장 (ZenReaderDB -> studyLogs)
    try {
      const insertedId = await this.saveToIndexedDB(logRecord);
      logRecord.indexedDbId = insertedId;
      console.log(`[Storage] 1단계 IndexedDB 영구 저장 완료 (ID: ${insertedId}):`, logRecord.docTitle);
    } catch (err) {
      console.warn('[Storage] 1단계 IndexedDB 저장 실패:', err);
    }

    // 2단계 안전망: localStorage 동기 미러링 (zen_permanent_logs)
    try {
      const raw = localStorage.getItem(this.LOCAL_LOGS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.unshift(logRecord);
      // 최근 1000개 보존
      if (list.length > 1000) {
        list.length = 1000;
      }
      localStorage.setItem(this.LOCAL_LOGS_KEY, JSON.stringify(list));
      console.log(`[Storage] 2단계 localStorage 미러링 완료 (총 ${list.length}건 보관)`);
    } catch (err) {
      console.warn('[Storage] 2단계 localStorage 미러링 실패:', err);
    }
  },

  addToQueue(payload) {
    const queue = this.getQueue();
    queue.push({
      ...payload,
      queuedAt: new Date().toISOString()
    });
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
  },

  getQueue() {
    try {
      const raw = localStorage.getItem(this.QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  // 다시 인터넷이 연결되면 쌓여있던 큐 일괄 전송
  async flushQueue() {
    const queue = this.getQueue();
    if (queue.length === 0) return;

    console.log(`[offline] 온라인 복구: 대기 중인 ${queue.length}건의 학습 로그를 동기화합니다.`);
    const remaining = [];

    for (const item of queue) {
      try {
        await fetch('/api/study-log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-zen-pin': localStorage.getItem('zen_pin_code') || '1234'
          },
          body: JSON.stringify(item)
        });
      } catch (err) {
        remaining.push(item);
      }
    }

    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(remaining));
    if (remaining.length === 0) {
      if (window.App && typeof App.showToast === 'function') {
        App.showToast(`✨ 오프라인에서 학습한 ${queue.length}건이 동기화되었습니다!`);
      }
      // 대시보드 새로고침
      if (window.App && App.currentView === 'dashboard' && window.Dashboard) {
        Dashboard.load();
      }
    }
  }
};
