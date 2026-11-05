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
      feedback: entry.feedback || 'good', // 'easy' | 'good' | 'hard'
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
  }
};
