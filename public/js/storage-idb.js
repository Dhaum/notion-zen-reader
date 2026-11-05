// public/js/storage-idb.js - 알도큐브 태블릿 PWA 전용 영구 IndexedDB 스토리지 매니저
// Vercel 서버리스의 휘발성 파일시스템 한계를 완벽히 극복하고 태블릿 기기 내부(SSD)에 영구 보존합니다.

const ZenStorage = {
  DB_NAME: 'ZenReaderDB',
  DB_VERSION: 1,
  STORE_NAME: 'studyLogs',
  db: null,
  isPersisted: false,

  // 1. IndexedDB 초기화 및 안드로이드 OS 영구 보존 락(Persist) 요청
  async init() {
    await this.requestPersistentStorage();
    await this.openDB();
    await this.migrateFromLocalStorage();
  },

  // 안드로이드 OS 및 크롬이 용량 부족 시에도 데이터를 임의 삭제하지 못하도록 영구 락 설정
  async requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
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

  // IndexedDB 데이터베이스 열기 (기존 studyLogs 스토어와 100% 호환)
  openDB() {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);
      if (!window.indexedDB) {
        console.warn('[ZenStorage] 브라우저가 IndexedDB를 지원하지 않습니다.');
        return reject(new Error('IndexedDB not supported'));
      }

      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('docId', 'docId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('readAt', 'readAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[ZenStorage] IndexedDB 연결 성공');
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[ZenStorage] IndexedDB 연결 실패:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // 기존 localStorage에 보관 중이던 기록을 IndexedDB로 마이그레이션
  async migrateFromLocalStorage() {
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
      docId: entry.docId,
      docTitle: entry.docTitle || '제목 없음',
      readAt: entry.readAt || nowIso,
      timestamp: entry.timestamp || nowIso,
      durationSeconds: Number(entry.durationSeconds) || 60,
      reviewCount: Number(entry.reviewCount) || 1,
      device: entry.device || 'alldocube-iplay60'
    };

    const recordId = await this.putLog(newLog);
    newLog.id = recordId;

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
  }
};
