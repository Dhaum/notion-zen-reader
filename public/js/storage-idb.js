// public/js/storage-idb.js - 알도큐브 태블릿 PWA 전용 영구 IndexedDB 스토리지 매니저
// Vercel 서버리스의 휘발성 파일시스템 한계를 완벽히 극복하고 태블릿 기기 내부(SSD)에 영구 보존합니다.

const ZenStorage = {
  DB_NAME: 'ZenReaderDB',
  DB_VERSION: 2,
  STORE_NAME: 'studyLogs',
  DOCS_STORE_NAME: 'documents',
  META_STORE_NAME: 'meta',
  db: null,
  _openPromise: null,
  isPersisted: false,
  _memDocs: new Map(),
  _memList: null,

  _hasIndexedDB() {
    return typeof window !== 'undefined' && !!window.indexedDB;
  },

  // 1. IndexedDB 초기화 및 안드로이드 OS 영구 보존 락(Persist) 요청
  async init() {
    await this.requestPersistentStorage();
    await this.openDB();
    await this.migrateFromLocalStorage();
  },

  // 안드로이드 OS 및 크롬이 용량 부족 시에도 데이터를 임의 삭제하지 못하도록 영구 락 설정
  async requestPersistentStorage() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) {
          this.isPersisted = true;
          console.log('[ZenStorage] 🔒 영구 보존 락(Persistent Storage) 이미 활성화됨');
        } else {
          const granted = await navigator.storage.persist();
          this.isPersisted = granted;
          console.log(`[ZenStorage] 🔒 영구 보존 락(Persistent Storage) 요청 결과: ${granted ? '승인 완료' : '일반 보존'}`);
        }
      } catch (err) {
        console.warn('[ZenStorage] Persist 요청 실패:', err);
      }
    }
  },

  // IndexedDB 데이터베이스 열기 (기존 studyLogs 스토어와 100% 호환 + documents/meta v2 스토어)
  openDB() {
    if (this.db) return Promise.resolve(this.db);
    if (!this._hasIndexedDB()) {
      return Promise.resolve(null);
    }
    if (this._openPromise) return this._openPromise;

    this._openPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const tx = event.target.transaction || request.transaction;

        let studyStore;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          studyStore = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
        } else if (tx) {
          studyStore = tx.objectStore(this.STORE_NAME);
        }
        if (studyStore) {
          ['docId', 'timestamp', 'readAt', 'reviewCount', 'synced'].forEach((idx) => {
            if (!studyStore.indexNames.contains(idx)) {
              studyStore.createIndex(idx, idx, { unique: false });
            }
          });
        }

        let docStore;
        if (!db.objectStoreNames.contains(this.DOCS_STORE_NAME)) {
          docStore = db.createObjectStore(this.DOCS_STORE_NAME, {
            keyPath: 'id'
          });
        } else if (tx) {
          docStore = tx.objectStore(this.DOCS_STORE_NAME);
        }
        if (docStore) {
          ['updatedAt', 'cachedAt'].forEach((idx) => {
            if (!docStore.indexNames.contains(idx)) {
              docStore.createIndex(idx, idx, { unique: false });
            }
          });
        }

        if (!db.objectStoreNames.contains(this.META_STORE_NAME)) {
          db.createObjectStore(this.META_STORE_NAME, {
            keyPath: 'key'
          });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          if (this.db) {
            this.db.close();
            this.db = null;
            this._openPromise = null;
          }
        };
        this.db.onclose = () => {
          this.db = null;
          this._openPromise = null;
        };
        console.log('[ZenStorage] IndexedDB 연결 성공');
        resolve(this.db);
      };

      request.onerror = (event) => {
        this._openPromise = null;
        console.error('[ZenStorage] IndexedDB 연결 실패:', event.target.error);
        reject(event.target.error);
      };
    });

    return this._openPromise;
  },

  async _ensureDB() {
    if (this.db) return this.db;
    if (!this._hasIndexedDB()) return null;
    try {
      return await this.openDB();
    } catch (err) {
      console.warn('[ZenStorage] DB 오픈 실패, 인메모리 폴백 사용:', err);
      return null;
    }
  },

  _idbPut(db, storeName, value) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  _idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  _idbGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  _estimateSizeBytes(obj) {
    try {
      const json = JSON.stringify(obj);
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(json).length;
      }
      if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(json, 'utf8');
      }
      return json.length * 2;
    } catch (e) {
      return 0;
    }
  },

  async _getAllStoredDocuments() {
    const db = await this._ensureDB();
    if (db) {
      try {
        const docs = await this._idbGetAll(db, this.DOCS_STORE_NAME);
        if (Array.isArray(docs)) {
          return docs;
        }
      } catch (err) {
        console.warn('[ZenStorage] documents 스토어 조회 실패:', err);
      }
    }
    return Array.from(this._memDocs.values());
  },

  // 기존 localStorage에 보관 중이던 기록을 IndexedDB로 마이그레이션
  async migrateFromLocalStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('zen_permanent_logs');
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          const existingLogs = await this.getAllLogs();
          const existingIds = new Set(existingLogs.map(l => l.id || l.timestamp));

          for (const item of list) {
            const uniqueKey = item.id || item.timestamp;
            if (!uniqueKey || !existingIds.has(uniqueKey)) {
              await this.putLog({
                docId: item.docId,
                docTitle: item.docTitle || '제목 없음',
                readAt: item.readAt || item.timestamp || item.loggedAt || new Date().toISOString(),
                timestamp: item.timestamp || item.readAt || new Date().toISOString(),
                durationSeconds: Number(item.durationSeconds) || 60,
                reviewCount: item.reviewCount || 1,
                device: item.device || 'alldocube-tablet'
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[ZenStorage] 로컬 마이그레이션 중 오류:', e);
    }
  },

  putLog(logEntry) {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.put(logEntry);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  // 2. 새로운 학습 체크인 기록 저장
  async saveLog(entry) {
    if (!this.db) await this.openDB();
    const nowIso = new Date().toISOString();

    const newLog = {
      clientLogId: entry.clientLogId || entry.id || null,
      docId: entry.docId,
      docTitle: entry.docTitle || '제목 없음',
      readAt: entry.readAt || nowIso,
      timestamp: entry.timestamp || nowIso,
      durationSeconds: Number(entry.durationSeconds) || 60,
      reviewCount: Number(entry.reviewCount) || 1,
      feedback: entry.feedback || 'good', // 'easy' | 'good' | 'hard'
      device: entry.device || 'alldocube-iplay60'
    };

    const recordId = await this.putLog(newLog);
    if (recordId != null) {
      newLog.id = recordId;
    }

    // 2중 안전망: localStorage 미러링
    try {
      const raw = localStorage.getItem('zen_permanent_logs');
      const list = raw ? JSON.parse(raw) : [];
      list.unshift(newLog);
      localStorage.setItem('zen_permanent_logs', JSON.stringify(list.slice(0, 500)));
    } catch (e) {}

    console.log(`[ZenStorage] 태블릿 영구 저장 완료: ${newLog.docTitle} (회독: ${newLog.reviewCount})`);
    return newLog;
  },

  // 2-1. 직전/현재 세션 학습 로그의 기억 체감도 수정 (회독수 중복 증가 없음)
  async updateLogFeedback(logIdentifier, feedback) {
    const validFeedbacks = new Set(['easy', 'good', 'hard']);
    if (!validFeedbacks.has(feedback)) {
      return { updated: false, log: null };
    }

    const opts = (logIdentifier && typeof logIdentifier === 'object')
      ? logIdentifier
      : { id: logIdentifier, clientLogId: logIdentifier };
    const { id, clientLogId, docId } = opts;

    let updatedLog = null;
    try {
      if (!this.db) await this.openDB();
      const allLogs = await this.getAllLogs();
      let target = null;
      if (id != null) {
        target = allLogs.find(l => l.id === id) || null;
      }
      if (!target && clientLogId) {
        target = allLogs.find(l => l.clientLogId === clientLogId) || null;
      }
      if (!target && docId) {
        target = allLogs.find(l => l.docId === docId) || null;
      }
      if (target) {
        target.feedback = feedback;
        target.feedbackUpdatedAt = new Date().toISOString();
        await this.putLog(target);
        updatedLog = target;
      }
    } catch (err) {
      console.warn('[ZenStorage] IndexedDB 피드백 수정 실패:', err);
    }

    let lsUpdated = false;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('zen_permanent_logs');
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list) && list.length > 0) {
          let lsTarget = null;
          if (id != null) lsTarget = list.find(l => l.id === id) || null;
          if (!lsTarget && clientLogId) lsTarget = list.find(l => l.clientLogId === clientLogId) || null;
          if (!lsTarget && docId) lsTarget = list.find(l => l.docId === docId) || null;
          if (lsTarget) {
            lsTarget.feedback = feedback;
            lsTarget.feedbackUpdatedAt = new Date().toISOString();
            localStorage.setItem('zen_permanent_logs', JSON.stringify(list));
            lsUpdated = true;
          }
        }
      }
    } catch (e) {}

    return { updated: Boolean(updatedLog || lsUpdated), log: updatedLog };
  },

  // 3. 전체 학습 로그 불러오기 (최신순 정렬)
  getAllLogs() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve([]);
      }
      try {
        const tx = this.db.transaction([this.STORE_NAME], 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const logs = request.result || [];
          // 최신순 정렬
          logs.sort((a, b) => {
            const timeA = new Date(a.readAt || a.timestamp || 0).getTime();
            const timeB = new Date(b.readAt || b.timestamp || 0).getTime();
            return timeB - timeA;
          });
          resolve(logs);
        };

        request.onerror = () => reject(request.error);
      } catch (err) {
        console.warn('[ZenStorage] getAllLogs 실패:', err);
        resolve([]);
      }
    });
  },

  // 4. 서재 목록 렌더링용: 문서별 회독수 및 최근 복습일 맵 추출
  async getDocStatsMap() {
    const logs = await this.getAllLogs();
    const map = {};

    logs.forEach(log => {
      if (!log.docId) return;
      const logDate = log.readAt || log.timestamp || new Date().toISOString();

      if (!map[log.docId]) {
        map[log.docId] = {
          reviewCount: 0,
          lastReviewedAt: logDate
        };
      }
      map[log.docId].reviewCount++;
      // 최신 복습일 갱신
      if (new Date(logDate) > new Date(map[log.docId].lastReviewedAt)) {
        map[log.docId].lastReviewedAt = logDate;
      }
    });

    return map;
  },

  // 4-2. Clinical-SM2 회독 주기 산출 엔진 (임상 약학 롱폼 최적화)
  calculateSM2(historyLogs = []) {
    if (!historyLogs || historyLogs.length === 0) {
      return { reviewCount: 0, intervalDays: 1, easeFactor: 2.2, lastReviewedAt: null, dueDate: null };
    }

    let interval = 1;
    let ef = 2.2;
    const count = historyLogs.length;

    for (let i = 0; i < count; i++) {
      const feedback = historyLogs[i].feedback || 'good';
      if (feedback === 'hard') {
        interval = 1;
        ef = Math.max(1.3, ef - 0.2);
      } else {
        if (i === 0) interval = 1;
        else if (i === 1) interval = 3;
        else if (i === 2) interval = 7;
        else if (i === 3) interval = 14;
        else interval = Math.round(interval * ef);

        if (feedback === 'easy') {
          ef = Math.min(2.5, ef + 0.1);
        }
      }
    }

    const lastLog = historyLogs[historyLogs.length - 1];
    const lastDate = new Date(lastLog.readAt || lastLog.timestamp);
    const dueDate = new Date(lastDate.getTime() + interval * 24 * 60 * 60 * 1000);

    return {
      reviewCount: count,
      intervalDays: interval,
      easeFactor: Number(ef.toFixed(2)),
      lastReviewedAt: lastDate.toISOString(),
      dueDate: dueDate.toISOString()
    };
  },

  // 4-3. 140개 전체 문서 대상 통합 학습 통계 & 골든타임 큐 산출
  async calculateAdvancedStats(allDocuments = []) {
    const logs = await this.getAllLogs();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // 1) 문서별 로그 그룹화 및 히트맵 초기화
    const docLogsMap = {};
    const heatmap = {};
    let todayReviews = 0;
    let totalDurationSeconds = 0;

    for (let i = 89; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      heatmap[d.toISOString().slice(0, 10)] = 0;
    }

    logs.forEach(log => {
      const dateStr = (log.readAt || log.timestamp || '').slice(0, 10);
      if (dateStr === todayStr) todayReviews++;
      if (heatmap[dateStr] !== undefined) heatmap[dateStr]++;
      totalDurationSeconds += (Number(log.durationSeconds) || 0);

      if (!log.docId) return;
      if (!docLogsMap[log.docId]) docLogsMap[log.docId] = [];
      docLogsMap[log.docId].push(log);
    });

    // 로그 과거순 정렬 (SM-2 시뮬레이션용)
    Object.keys(docLogsMap).forEach(id => {
      docLogsMap[id].sort((a, b) => new Date(a.readAt || a.timestamp) - new Date(b.readAt || b.timestamp));
    });

    // 2) 스트릭(연속 학습일) 계산
    let currentStreak = 0;
    let checkDate = new Date(now);
    while (true) {
      const key = checkDate.toISOString().slice(0, 10);
      if ((heatmap[key] || 0) > 0) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        if (key === todayStr) {
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
        break;
      }
    }

    // 3) 전체 문서 대상 SM-2 결합 & 긴급도(Urgency Score) 산출
    const enrichedDocs = allDocuments.map(doc => {
      const history = docLogsMap[doc.id] || [];
      const sm2 = this.calculateSM2(history);
      const diffDays = sm2.lastReviewedAt 
        ? Math.floor((now - new Date(sm2.lastReviewedAt)) / (24 * 60 * 60 * 1000)) 
        : 999;

      let urgencyScore = 0;
      let urgencyBadge = 'STABLE';

      if (sm2.reviewCount === 0) {
        urgencyScore = 1.2;
        urgencyBadge = 'NEW';
      } else {
        urgencyScore = Number((diffDays / sm2.intervalDays).toFixed(2));
        if (urgencyScore >= 1.5) urgencyBadge = 'CRITICAL';
        else if (urgencyScore >= 1.0) urgencyBadge = 'DUE';
        else if (urgencyScore >= 0.7) urgencyBadge = 'APPROACHING';
      }

      return {
        ...doc,
        reviewCount: sm2.reviewCount,
        intervalDays: sm2.intervalDays,
        easeFactor: sm2.easeFactor,
        lastReviewedAt: sm2.lastReviewedAt,
        diffDays,
        urgencyScore,
        urgencyBadge
      };
    });

    // 4) 상태별 그룹화 (완료 vs 진행 중 vs 시작 전)
    const completedDocs = enrichedDocs.filter(d => d.status === '완료');
    const inProgressDocs = enrichedDocs.filter(d => d.status === '진행 중');
    const todoDocs = enrichedDocs.filter(d => d.status === '시작 전');
    // 실제 공부 대상 모수: '완료' 상태인 문서 (없으면 전체 폴백)
    const targetDocs = completedDocs.length > 0 ? completedDocs : enrichedDocs;
    const studiedCompletedDocs = targetDocs.filter(d => docLogsMap[d.id] && docLogsMap[d.id].length > 0);
    const studiedTotalDocs = enrichedDocs.filter(d => docLogsMap[d.id] && docLogsMap[d.id].length > 0);

    // 5) 오늘의 골든타임 복습 Top 5 큐 추출
    // 긴급/도래는 이미 공부했던 문서이므로 포함, 신규(NEW)는 오직 작성 '완료'된 문서에서만 선별
    const goldenQueue = enrichedDocs
      .filter(d => {
        if (d.urgencyBadge === 'CRITICAL' || d.urgencyBadge === 'DUE') return true;
        if (d.urgencyBadge === 'NEW') {
          return d.status === '완료'; // 미완성 초안은 추천에서 제외
        }
        return false;
      })
      .sort((a, b) => {
        const priorityOrder = { 'CRITICAL': 3, 'DUE': 2, 'NEW': 1, 'APPROACHING': 0, 'STABLE': 0 };
        const diffP = (priorityOrder[b.urgencyBadge] || 0) - (priorityOrder[a.urgencyBadge] || 0);
        if (diffP !== 0) return diffP;
        return b.urgencyScore - a.urgencyScore;
      })
      .slice(0, 5);

    // 6) 카테고리별 마스터리(숙련도) 집계 (완료된 공부 대상 노트 기준)
    const categoryStats = {};
    targetDocs.forEach(d => {
      const cat = d.category || '기타 지식';
      if (!categoryStats[cat]) {
        categoryStats[cat] = { total: 0, completedTotal: 0, level0: 0, level1: 0, level2: 0, level3: 0 };
      }
      categoryStats[cat].total++;
      if (d.status === '완료') {
        categoryStats[cat].completedTotal++;
      }
      if (d.reviewCount === 0) categoryStats[cat].level0++;
      else if (d.reviewCount <= 2) categoryStats[cat].level1++;
      else if (d.reviewCount <= 4) categoryStats[cat].level2++;
      else categoryStats[cat].level3++;
    });

    const coverageRate = targetDocs.length > 0
      ? Math.round((studiedCompletedDocs.length / targetDocs.length) * 100)
      : 0;

    return {
      summary: {
        totalDocuments: allDocuments.length || enrichedDocs.length,
        targetCompletedCount: targetDocs.length,
        studiedCompletedCount: studiedCompletedDocs.length,
        inProgressCount: inProgressDocs.length,
        todoCount: todoDocs.length,
        studiedDocsCount: studiedTotalDocs.length,
        coverageRate,
        todayReviews,
        totalReviews: logs.length,
        totalStudyMinutes: Math.round(totalDurationSeconds / 60),
        currentStreak
      },
      heatmap,
      goldenQueue,
      categoryStats,
      recentLogs: logs.slice(0, 15)
    };
  },

  // 5. 대시보드 통계 및 90일 복습 잔디 히트맵 산출 (클라이언트 사이드 고속 연산)
  async calculateStats() {
    const logs = await this.getAllLogs();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let todayReviews = 0;
    const docStats = {};
    const heatmap = {};

    // 최근 90일 히트맵 0으로 초기화
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      heatmap[key] = 0;
    }

    logs.forEach(log => {
      const dateStr = (log.readAt || log.timestamp || '').slice(0, 10);
      if (dateStr === todayStr) {
        todayReviews++;
      }
      if (heatmap[dateStr] !== undefined) {
        heatmap[dateStr]++;
      }

      if (!log.docId) return;

      if (!docStats[log.docId]) {
        docStats[log.docId] = {
          docId: log.docId,
          docTitle: log.docTitle || '제목 없음',
          reviewCount: 0,
          totalDurationSeconds: 0,
          lastReviewedAt: log.readAt || log.timestamp,
          history: []
        };
      }
      docStats[log.docId].reviewCount++;
      docStats[log.docId].totalDurationSeconds += (Number(log.durationSeconds) || 0);
      docStats[log.docId].history.push(log.readAt || log.timestamp);

      const logTime = new Date(log.readAt || log.timestamp);
      if (logTime > new Date(docStats[log.docId].lastReviewedAt)) {
        docStats[log.docId].lastReviewedAt = log.readAt || log.timestamp;
      }
    });

    const uniqueDocsCount = Object.keys(docStats).length;

    // 에빙하우스 망각 곡선 복습 추천 큐 (복습한 지 7일 이상 경과)
    const docList = Object.values(docStats);
    const recommendations = docList.map(doc => {
      const lastDate = new Date(doc.lastReviewedAt);
      const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      let urgency = "NORMAL";
      if (diffDays >= 14) urgency = "CRITICAL";
      else if (diffDays >= 7) urgency = "WARNING";

      return {
        docId: doc.docId,
        docTitle: doc.docTitle,
        reviewCount: doc.reviewCount,
        lastReviewedAt: doc.lastReviewedAt,
        diffDays,
        urgency
      };
    }).sort((a, b) => b.diffDays - a.diffDays);

    return {
      summary: {
        totalReviews: logs.length,
        todayReviews,
        uniqueDocsCount,
        totalStudyMinutes: Math.round(logs.reduce((acc, cur) => acc + (Number(cur.durationSeconds) || 0), 0) / 60)
      },
      heatmap,
      docStats,
      recommendations,
      recentLogs: logs.slice(0, 30)
    };
  },

  // 6. 데이터 백업: JSON 파일 다운로드
  async exportBackupJSON() {
    const logs = await this.getAllLogs();
    const backupData = {
      app: 'notion-zen-reader',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      count: logs.length,
      logs
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `zen-reader-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // 7. 데이터 복원: JSON 파일 가져오기
  async importBackupJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = JSON.parse(e.target.result);
          const logs = Array.isArray(content) ? content : (content.logs || []);
          if (!Array.isArray(logs)) {
            throw new Error('유효한 JSON 학습 기록 데이터가 아닙니다.');
          }

          let importedCount = 0;
          for (const item of logs) {
            if (item.docId) {
              await this.putLog({
                docId: item.docId,
                docTitle: item.docTitle || '제목 없음',
                readAt: item.readAt || item.timestamp || new Date().toISOString(),
                timestamp: item.timestamp || item.readAt || new Date().toISOString(),
                durationSeconds: Number(item.durationSeconds) || 60,
                reviewCount: Number(item.reviewCount) || 1,
                device: item.device || 'backup-restore'
              });
              importedCount++;
            }
          }
          resolve(importedCount);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  },

  // 8. 오프라인 문서 본문 저장 (IndexedDB 'documents' 스토어 + 인메모리 폴백)
  async saveDocument(doc) {
    if (!doc || !doc.id) {
      throw new Error('유효한 문서 객체(doc.id)가 필요합니다.');
    }

    const nowIso = new Date().toISOString();
    const savedDoc = {
      ...doc,
      id: doc.id,
      updatedAt: doc.updatedAt || nowIso,
      cachedAt: nowIso
    };

    this._memDocs.set(savedDoc.id, savedDoc);

    const db = await this._ensureDB();
    if (db) {
      try {
        await this._idbPut(db, this.DOCS_STORE_NAME, savedDoc);
      } catch (err) {
        console.warn('[ZenStorage] saveDocument IDB 저장 경고:', err);
      }
    }

    return savedDoc;
  },

  // 9. 오프라인 문서 본문 조회
  async getDocument(docId) {
    if (!docId) return null;

    const db = await this._ensureDB();
    if (db) {
      try {
        const doc = await this._idbGet(db, this.DOCS_STORE_NAME, docId);
        if (doc) return doc;
      } catch (err) {
        console.warn('[ZenStorage] getDocument IDB 조회 경고:', err);
      }
    }

    return this._memDocs.get(docId) || null;
  },

  // 10. 서재 문서 목록 메타데이터 저장 ('meta' 스토어 key: 'documentList')
  async saveDocumentList(docs) {
    const entry = {
      key: 'documentList',
      documents: Array.isArray(docs) ? docs : [],
      updatedAt: new Date().toISOString()
    };

    this._memList = entry;

    const db = await this._ensureDB();
    if (db) {
      try {
        await this._idbPut(db, this.META_STORE_NAME, entry);
      } catch (err) {
        console.warn('[ZenStorage] saveDocumentList IDB 저장 경고:', err);
      }
    }

    return entry;
  },

  // 11. 서재 문서 목록 메타데이터 조회
  async getDocumentList() {
    const db = await this._ensureDB();
    if (db) {
      try {
        const record = await this._idbGet(db, this.META_STORE_NAME, 'documentList');
        if (record && Array.isArray(record.documents)) {
          return record.documents;
        }
      } catch (err) {
        console.warn('[ZenStorage] getDocumentList IDB 조회 경고:', err);
      }
    }

    if (Array.isArray(this._memList)) {
      return this._memList;
    }
    if (this._memList && Array.isArray(this._memList.documents)) {
      return this._memList.documents;
    }
    return null;
  },

  // 12. 캐싱된 전체 문서 경량 메타 요약 목록 조회
  async getAllCachedDocsMeta() {
    const docs = await this._getAllStoredDocuments();
    return docs
      .filter(doc => doc && doc.id)
      .map(doc => ({
        id: doc.id,
        title: doc.title || '제목 없음',
        updatedAt: doc.updatedAt || null,
        cachedAt: doc.cachedAt || null,
        blockCount: Array.isArray(doc.blocks) ? doc.blocks.length : (Number(doc.blockCount) || 0),
        sizeBytes: typeof doc.sizeBytes === 'number' ? doc.sizeBytes : this._estimateSizeBytes(doc)
      }));
  },

  // 13. 본문(blocks 배열 또는 content)이 실제로 저장된 문서 ID Set 반환
  async getCachedDocIds() {
    const docs = await this._getAllStoredDocuments();
    const idSet = new Set();
    for (const doc of docs) {
      if (doc && doc.id && (Array.isArray(doc.blocks) || Boolean(doc.content))) {
        idSet.add(doc.id);
      }
    }
    return idSet;
  },

  // 14. 원격 문서 목록 대비 로컬 오프라인 캐시 정합성/용량 요약 산출
  async getOfflineCacheSummary(remoteDocs = []) {
    const list = Array.isArray(remoteDocs) ? remoteDocs : [];
    const cachedMetaList = await this.getAllCachedDocsMeta();
    const cachedMap = new Map();

    let totalBytes = 0;
    let lastCachedMs = 0;
    let lastCachedAt = null;

    for (const item of cachedMetaList) {
      if (!item || !item.id) continue;
      cachedMap.set(item.id, item);
      totalBytes += Number(item.sizeBytes) || 0;
      if (item.cachedAt) {
        const cachedMs = new Date(item.cachedAt).getTime();
        if (!Number.isNaN(cachedMs) && cachedMs > lastCachedMs) {
          lastCachedMs = cachedMs;
          lastCachedAt = item.cachedAt;
        }
      }
    }

    let upToDateCount = 0;
    let outdatedCount = 0;
    let missingCount = 0;
    const remoteIdSet = new Set();

    for (const remote of list) {
      if (!remote || !remote.id) continue;
      remoteIdSet.add(remote.id);
      const cached = cachedMap.get(remote.id);
      if (!cached) {
        missingCount++;
        continue;
      }

      if (!remote.updatedAt || !cached.updatedAt) {
        upToDateCount++;
        continue;
      }

      const remoteTime = new Date(remote.updatedAt).getTime();
      const cachedTime = new Date(cached.updatedAt).getTime();
      if (Number.isNaN(remoteTime) || Number.isNaN(cachedTime) || cachedTime >= remoteTime) {
        upToDateCount++;
      } else {
        outdatedCount++;
      }
    }

    let orphanCount = 0;
    if (list.length > 0) {
      for (const cached of cachedMetaList) {
        if (cached && cached.id && !remoteIdSet.has(cached.id)) {
          orphanCount++;
        }
      }
    }

    const approxSizeKB = totalBytes > 0 ? Math.max(1, Math.round(totalBytes / 1024)) : 0;

    return {
      totalRemote: list.length,
      cachedCount: cachedMetaList.length,
      upToDateCount,
      outdatedCount,
      missingCount,
      orphanCount,
      approxSizeKB,
      lastCachedAt
    };
  },

  // 15. 원격 목록에 없는 고아 문서 캐시 정리 (studyLogs는 절대 건드리지 않음)
  async pruneOrphanDocuments(validDocIds) {
    const validSet = validDocIds instanceof Set
      ? validDocIds
      : new Set(Array.isArray(validDocIds) ? validDocIds.filter(Boolean) : []);

    if (validSet.size === 0) {
      return 0;
    }

    const storedDocs = await this._getAllStoredDocuments();
    const orphanIds = new Set();
    for (const doc of storedDocs) {
      if (doc && doc.id && !validSet.has(doc.id)) {
        orphanIds.add(doc.id);
      }
    }
    for (const id of this._memDocs.keys()) {
      if (!validSet.has(id)) {
        orphanIds.add(id);
      }
    }

    if (orphanIds.size === 0) {
      return 0;
    }

    for (const id of orphanIds) {
      this._memDocs.delete(id);
    }

    const db = await this._ensureDB();
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction([this.DOCS_STORE_NAME], 'readwrite');
          const store = tx.objectStore(this.DOCS_STORE_NAME);
          let pending = orphanIds.size;
          let settled = false;

          for (const id of orphanIds) {
            const req = store.delete(id);
            req.onsuccess = () => {
              pending--;
              if (pending <= 0 && !settled) {
                settled = true;
                resolve();
              }
            };
            req.onerror = () => {
              if (!settled) {
                settled = true;
                reject(req.error);
              }
            };
          }
        });
      } catch (err) {
        console.warn('[ZenStorage] pruneOrphanDocuments IDB 삭제 경고:', err);
      }
    }

    return orphanIds.size;
  },

  // 16. 문서/이미지 캐시만 안전 초기화 (studyLogs 학습 기록 100% 보존)
  async clearDocumentCache() {
    const storedDocs = await this._getAllStoredDocuments();
    const allIds = new Set(storedDocs.map(doc => doc && doc.id).filter(Boolean));
    for (const id of this._memDocs.keys()) {
      allIds.add(id);
    }
    const clearedDocsCount = allIds.size;

    this._memDocs.clear();
    this._memList = null;

    const db = await this._ensureDB();
    if (db) {
      try {
        const storesToTouch = [];
        if (db.objectStoreNames.contains(this.DOCS_STORE_NAME)) storesToTouch.push(this.DOCS_STORE_NAME);
        if (db.objectStoreNames.contains(this.META_STORE_NAME)) storesToTouch.push(this.META_STORE_NAME);

        if (storesToTouch.length > 0) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storesToTouch, 'readwrite');
            let pending = storesToTouch.length;
            let settled = false;

            const done = () => {
              pending--;
              if (pending <= 0 && !settled) {
                settled = true;
                resolve();
              }
            };
            const fail = (err) => {
              if (!settled) {
                settled = true;
                reject(err);
              }
            };

            if (db.objectStoreNames.contains(this.DOCS_STORE_NAME)) {
              const req = tx.objectStore(this.DOCS_STORE_NAME).clear();
              req.onsuccess = done;
              req.onerror = () => fail(req.error);
            }
            if (db.objectStoreNames.contains(this.META_STORE_NAME)) {
              const req = tx.objectStore(this.META_STORE_NAME).delete('documentList');
              req.onsuccess = done;
              req.onerror = () => fail(req.error);
            }
          });
        }
      } catch (err) {
        console.warn('[ZenStorage] clearDocumentCache IDB 정리 경고:', err);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('zen_doc_sync_map');
        localStorage.removeItem('zen_cached_documents');
      } catch (e) {}
    }

    if (typeof caches !== 'undefined' && typeof caches.delete === 'function') {
      try {
        await Promise.all([
          caches.delete('zen-data-v1').catch(() => false),
          caches.delete('zen-images-v1').catch(() => false)
        ]);
      } catch (e) {}
    }

    return { clearedDocsCount };
  },

  // 17. 문서 내 이미지 URL 재귀 추출 및 중복 캐시 스킵 기반 배치 프리패치
  async prefetchDocumentImages(doc, concurrency = 3) {
    if (!doc || !Array.isArray(doc.blocks)) {
      return { total: 0, skipped: 0, fetched: 0 };
    }
    if (typeof fetch !== 'function' || typeof navigator === 'undefined' || navigator.onLine === false) {
      return { total: 0, skipped: 0, fetched: 0 };
    }

    const uniqueUrls = new Set();
    const extract = (blocks) => {
      if (!Array.isArray(blocks)) return;
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (typeof b.imageUrl === 'string') {
          const trimmed = b.imageUrl.trim();
          if (/^https?:\/\//i.test(trimmed)) {
            uniqueUrls.add(trimmed);
          }
        }
        if (Array.isArray(b.children) && b.children.length > 0) {
          extract(b.children);
        }
      }
    };
    extract(doc.blocks);

    if (uniqueUrls.size === 0) {
      return { total: 0, skipped: 0, fetched: 0 };
    }

    const missingUrls = [];
    let skipped = 0;

    let imageCache = null;
    if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
      try {
        imageCache = await caches.open('zen-images-v1');
      } catch (e) {
        imageCache = null;
      }
    }

    let cachedPathnames = null;

    for (const url of uniqueUrls) {
      let alreadyCached = false;
      if (imageCache) {
        try {
          let match = await imageCache.match(url);
          if (!match) {
            match = await imageCache.match(url, { ignoreSearch: true });
          }
          if (!match) {
            if (cachedPathnames === null && typeof imageCache.keys === 'function') {
              cachedPathnames = new Set();
              const keys = await imageCache.keys();
              for (const k of keys) {
                try {
                  const keyHref = typeof k === 'string' ? k : (k && k.url);
                  if (keyHref) {
                    cachedPathnames.add(new URL(keyHref).pathname);
                  }
                } catch (e) {}
              }
            }
            if (cachedPathnames && cachedPathnames.size > 0) {
              try {
                const targetPathname = new URL(url).pathname;
                if (cachedPathnames.has(targetPathname)) {
                  match = true;
                }
              } catch (e) {}
            }
          }
          alreadyCached = Boolean(match);
        } catch (e) {
          alreadyCached = false;
        }
      }

      if (alreadyCached) {
        skipped++;
      } else {
        missingUrls.push(url);
      }
    }

    const batchSize = Math.max(1, Number(concurrency) || 3);
    let fetched = 0;
    for (let i = 0; i < missingUrls.length; i += batchSize) {
      const batch = missingUrls.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(url => fetch(url, { mode: 'no-cors' }))
      );
      for (const res of results) {
        if (res.status === 'fulfilled') {
          fetched++;
        }
      }
    }

    return { total: uniqueUrls.size, skipped, fetched };
  }
};

if (typeof window !== 'undefined') {
  window.ZenStorage = ZenStorage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZenStorage;
}
