// api/lib/storage.js - 노션을 건드리지 않는 독자적 학습 추적 스토리지
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'study-logs.json');

// 기본 목(Mock) 학습 로그 (초기 기동 시 시각적 확인용)
const DEFAULT_LOGS = [
  {
    id: "log-1",
    docId: "mock-doc-001",
    docTitle: "신경계 약리학: 도파민 및 세로토닌 경로와 수용체 작용기전",
    readAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    durationSeconds: 195,
    device: "iplay60-tablet"
  },
  {
    id: "log-2",
    docId: "mock-doc-001",
    docTitle: "신경계 약리학: 도파민 및 세로토닌 경로와 수용체 작용기전",
    readAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    durationSeconds: 240,
    device: "iplay60-tablet"
  },
  {
    id: "log-3",
    docId: "mock-doc-002",
    docTitle: "컴퓨터 시스템 아키텍처: 가상 메모리와 페이징(Paging) 기법",
    readAt: new Date().toISOString(),
    durationSeconds: 310,
    device: "iplay60-tablet"
  }
];

// 메모리 캐시 (서버리스 람다 환경 대응)
let inMemoryLogs = null;

function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, JSON.stringify(DEFAULT_LOGS, null, 2), 'utf8');
      inMemoryLogs = [...DEFAULT_LOGS];
    }
  } catch (err) {
    console.warn('[study-tracker] 파일 시스템 쓰기 제한 (서버리스 메모리 모드 동작):', err.message);
    if (!inMemoryLogs) inMemoryLogs = [...DEFAULT_LOGS];
  }
}

function readAllLogs() {
  ensureDataFile();
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, 'utf8');
      inMemoryLogs = JSON.parse(data);
      return inMemoryLogs;
    }
  } catch (err) {
    console.warn('[study-tracker] 로그 파일 읽기 실패, 메모리 캐시 사용:', err.message);
  }
  return inMemoryLogs || [...DEFAULT_LOGS];
}

function saveLog(entry) {
  const logs = readAllLogs();
  const newLog = {
    id: 'log-' + Date.now(),
    docId: entry.docId,
    docTitle: entry.docTitle || "제목 없음",
    readAt: entry.readAt || new Date().toISOString(),
    durationSeconds: Number(entry.durationSeconds) || 60,
    device: entry.device || "alldocube-tablet"
  };

  logs.unshift(newLog); // 최신순 삽입
  inMemoryLogs = logs;

  try {
    if (fs.existsSync(DATA_DIR)) {
      fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('[study-tracker] 로그 파일 쓰기 실패 (메모리만 갱신):', err.message);
  }

  return newLog;
}

// 통계 분석 엔진 (데스크탑 대시보드 및 복습 추천 산출)
function calculateStats() {
  const logs = readAllLogs();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let todayReviews = 0;
  const docStats = {};
  const heatmap = {}; // { "2026-11-06": 4, "2026-11-05": 2 }

  // 최근 90일 히트맵 0으로 초기화
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    heatmap[key] = 0;
  }

  logs.forEach(log => {
    const dateStr = log.readAt.slice(0, 10);
    if (dateStr === todayStr) {
      todayReviews++;
    }
    if (heatmap[dateStr] !== undefined) {
      heatmap[dateStr]++;
    }

    // 문서별 집계
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
    docStats[log.docId].totalDurationSeconds += log.durationSeconds;
    docStats[log.docId].history.push(log.readAt);
  });

  const uniqueDocsCount = Object.keys(docStats).length;

  // 에빙하우스 망각 곡선 복습 추천 큐 (복습한 지 7일 이상 지났거나 회독수가 낮은 문서)
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
      totalStudyMinutes: Math.round(logs.reduce((acc, cur) => acc + cur.durationSeconds, 0) / 60)
    },
    heatmap,
    docStats,
    recommendations,
    recentLogs: logs.slice(0, 20)
  };
}

module.exports = {
  readAllLogs,
  saveLog,
  calculateStats
};
