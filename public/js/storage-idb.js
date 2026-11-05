// public/js/storage-idb.js - 알도큐브 태블릿 PWA 전용 영구 IndexedDB 스토리지 매니저
// Vercel 서버리스의 휘발성 파일시스템 한계를 극복하고 기기 내부(SSD)에 영구 보존합니다.

const ZenStorage = {
  DB_NAME: 'ZenReaderDB',
  DB_VERSION: 1,
  STORE_NAME: 'study_logs',
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
        const isPersisted = await navigator.storage.persist();
        this.isPersisted = isPersisted;
        console.log(`[ZenStorage] 브라우저 영구 보존 락(Persist) 상태: ${isPersisted ? '🔒 획득 완료 (OS 삭제 방지)' : '일반 보존'}`);
      } catch (err) {
        console.warn('[ZenStorage] Persist 요청 실패:', err);
      }
    }
  },

  // IndexedDB 데이터베이스 열기
  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('docId', 'docId', { unique: false });
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

  // 기존 localStorage에 임시 저장되어 있던 기록이 있다면 IndexedDB로 마이그레이션
  async migrateFromLocalStorage() {
    try {
      const raw = localStorage.getItem('zen_permanent_logs');
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          console.log(`[ZenStorage] 기존 localStorage 로그 ${list.length}건을 IndexedDB로 이관합니다.`);
          for (const item of list) {
            const logEntry = {
              id: item.id || ('log-' + (item.loggedAt ? new Date(item.loggedAt).getTime() : Date.now()) + '-' + Math.random().toString(36).substr(2, 4)),
              docId: item.docId,
              docTitle: item.docTitle || '제목 없음',
              readAt: item.readAt || item.loggedAt || new Date().toISOString(),
              durationSeconds: Number(item.durationSeconds) || 60,
              device: item.device || 'alldocube-tablet'
            };
            await this.putLog(logEntry);
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
      const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.put(logEntry);
      request.onsuccess = () => resolve(logEntry);
      request.onerror = () => reject(request.error);
    });
  },

  // 2. 새로운 학습 체크인 기록 저장
  async saveLog(entry) {
    if (!this.db) await this.openDB();

    const newLog = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      docId: entry.docId,
      docTitle: entry.docTitle || '제목 없음',
      readAt: entry.readAt || new Date().toISOString(),
      durationSeconds: Number(entry.durationSeconds) || 60,
      device: entry.device || 'alldocube-iplay60'
    };

    await this.putLog(newLog);

    // 2중 안전망: localStorage에도 동기화 복사본 유지
    try {
      const raw = localStorage.getItem('zen_permanent_logs');
      const list = raw ? JSON.parse(raw) : [];
      list.unshift(newLog);
      localStorage.setItem('zen_permanent_logs', JSON.stringify(list.slice(0, 100))); // 최근 100건 보존
    } catch (e) {}

    console.log(`[ZenStorage] IndexedDB 저장 완료: ${newLog.docTitle} (${newLog.docId})`);
    return newLog;
  },

  // 3. 전체 학습 로그 불러오기 (최신순 정렬)
  getAllLogs() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve([]);
      }
      const tx = this.db.transaction([this.STORE_NAME], 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const logs = request.result || [];
        // 최신순 정렬
        logs.sort((a, b) => new Date(b.readAt).getTime() - new Date(a.readAt).getTime());
        resolve(logs);
      };

      request.onerror = () => reject(request.error);
    });
  },

  // 4. 서재 목록 렌더링용: 문서별 회독수 및 최근 복습일 맵 추출
  async getDocStatsMap() {
    const logs = await this.getAllLogs();
    const map = {};

    logs.forEach(log => {
      if (!map[log.docId]) {
        map[log.docId] = {
          reviewCount: 0,
          lastReviewedAt: log.readAt
        };
      }
      map[log.docId].reviewCount++;
      // 최신 복습일 갱신
      if (new Date(log.readAt) > new Date(map[log.docId].lastReviewedAt)) {
        map[log.docId].lastReviewedAt = log.readAt;
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
      const dateStr = (log.readAt || '').slice(0, 10);
      if (dateStr === todayStr) {
        todayReviews++;
      }
      if (heatmap[dateStr] !== undefined) {
        heatmap[dateStr]++;
      }

      if (!docStats[log.docId]) {
        docStats[log.docId] = {
          docId: log.docId,
          docTitle: log.docTitle,
          reviewCount: 0,
          totalDurationSeconds: 0,
          lastReviewedAt: log.readAt,
          history: []
        };
      }
      docStats[log.docId].reviewCount++;
      docStats[log.docId].totalDurationSeconds += (Number(log.durationSeconds) || 0);
      docStats[log.docId].history.push(log.readAt);
      if (new Date(log.readAt) > new Date(docStats[log.docId].lastReviewedAt)) {
        docStats[log.docId].lastReviewedAt = log.readAt;
      }
    });

    const uniqueDocsCount = Object.keys(docStats).length;

    // 에빙하우스 망각 곡선 복습 추천 큐 (복습한 지 7일 이상 경과 또는 미완료)
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
                id: item.id || ('log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4)),
                docId: item.docId,
                docTitle: item.docTitle || '제목 없음',
                readAt: item.readAt || new Date().toISOString(),
                durationSeconds: Number(item.durationSeconds) || 60,
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
