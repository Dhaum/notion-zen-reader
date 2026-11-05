// public/js/dashboard.js - 데스크탑 학습 대시보드 및 잔디 히트맵
const Dashboard = {
  async load() {
    const container = document.getElementById('dashboard-content');
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">학습 통계를 불러오는 중입니다...</div>';

    try {
      // 1. 태블릿 영구 스토리지(IndexedDB) 우선 집계 (0초 딜레이, 영구 보존 잔디)
      if (typeof ZenStorage !== 'undefined') {
        const localStats = await ZenStorage.calculateStats();
        if (localStats && (localStats.summary.totalReviews > 0 || !navigator.onLine)) {
          this.render(localStats, false);
          return;
        }
      }

      // 2. 로컬 기록이 아직 0건일 때 서버 통계 시도
      const response = await fetch('/api/study-stats', {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
        }
      });
      if (response.status === 401) {
        if (typeof App !== 'undefined' && App.handleUnauthorized) {
          App.handleUnauthorized();
        }
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }
      const data = await response.json();
      if (data.success && data.stats) {
        this.render(data.stats);
        return;
      }

      // 3. 서버 응답이 없으면 빈 로컬 통계 렌더링
      if (typeof ZenStorage !== 'undefined') {
        const localStats = await ZenStorage.calculateStats();
        this.render(localStats, false);
      }
    } catch (err) {
      console.warn('[Dashboard] 통계 로딩 처리 중 오류, 로컬 스토리지로 렌더링:', err);
      if (typeof ZenStorage !== 'undefined') {
        const localStats = await ZenStorage.calculateStats();
        this.render(localStats, false);
        return;
      }

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>통계 로딩 실패</h3>
          <p style="margin: 10px 0; color: var(--text-muted);">${err.message}</p>
        </div>
      `;
    }
  },

  // 로컬 영구 저장소(IndexedDB 및 localStorage)를 기반으로 오프라인 통계 생성
  async buildOfflineStats() {
    try {
      let logs = [];
      if (window.OfflineManager && typeof OfflineManager.getAllFromIndexedDB === 'function') {
        logs = await OfflineManager.getAllFromIndexedDB();
      }
      if (!logs || logs.length === 0) {
        const raw = localStorage.getItem('zen_permanent_logs');
        logs = raw ? JSON.parse(raw) : [];
      }
      if (!logs || logs.length === 0) return null;

      const todayStr = new Date().toISOString().slice(0, 10);
      let todayCount = 0;
      let totalDuration = 0;
      const uniqueDocs = new Set();
      const heatmap = {};

      // 90일 기본 히트맵
      const now = new Date();
      for (let i = 89; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        heatmap[d.toISOString().slice(0, 10)] = 0;
      }

      logs.forEach(log => {
        const dateStr = (log.readAt || log.timestamp || '').slice(0, 10);
        if (dateStr === todayStr) todayCount++;
        totalDuration += log.durationSeconds || 0;
        if (log.docId) uniqueDocs.add(log.docId);
        if (heatmap[dateStr] !== undefined) {
          heatmap[dateStr] = (heatmap[dateStr] || 0) + 1;
        }
      });

      return {
        summary: {
          todayReviews: todayCount,
          totalReviews: logs.length,
          uniqueDocsCount: uniqueDocs.size,
          totalStudyMinutes: Math.round(totalDuration / 60)
        },
        heatmap,
        recommendations: [],
        recentLogs: logs.slice(0, 15)
      };
    } catch (e) {
      console.warn('[Dashboard] 오프라인 통계 빌드 실패:', e);
      return null;
    }
  },

  render(stats, isOfflineMode = false) {
    const container = document.getElementById('dashboard-content');
    const { summary, heatmap, recommendations, recentLogs } = stats;

    let html = '';

    if (isOfflineMode) {
      html += `
        <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid var(--warning); border-radius: 12px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; color: var(--warning); font-size: 0.88rem;">
          <span style="font-size: 1.2rem;">🔒</span>
          <div>
            <strong>오프라인 영구 저장소 모드</strong>: 태블릿 기기 로컬 IndexedDB에 영구 보존된 학습 기록으로 대시보드를 표시 중입니다. (온라인 연결 시 중앙 서버와 자동 동기화)
          </div>
        </div>
      `;
    }

    html += `
      <!-- 1. 핵심 요약 카드 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${summary.todayReviews}</div>
          <div class="stat-label">오늘 복습한 문서</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${summary.totalReviews}</div>
          <div class="stat-label">총 누적 복습 횟수</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${summary.uniqueDocsCount}</div>
          <div class="stat-label">학습한 지식 문서</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${summary.totalStudyMinutes}분</div>
          <div class="stat-label">누적 집중 시간</div>
        </div>
      </div>

      <!-- 2. 잔디 히트맵 (최근 90일) -->
      <div class="heatmap-container">
        <div class="heatmap-title">
          <span>📅 최근 90일 복습 잔디 (Study Heatmap)</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">총 ${summary.totalReviews}회 학습 기록됨</span>
        </div>
        <div class="heatmap-grid" id="heatmap-grid-cells">
    `;

    // 히트맵 셀 생성
    const dateKeys = Object.keys(heatmap).sort();
    dateKeys.forEach(date => {
      const count = heatmap[date];
      let level = 0;
      if (count >= 4) level = 4;
      else if (count >= 2) level = 3;
      else if (count >= 1) level = 2;

      html += `
        <div class="heatmap-cell level-${level}" title="${date}: ${count}회 복습"></div>
      `;
    });

    html += `
        </div>
      </div>

      <!-- 3. 망각 곡선 복습 추천 큐 -->
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          🔔 에빙하우스 망각 곡선 복습 추천
          <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">(복습 주기가 도래한 문서)</span>
        </h3>
        <div class="recommend-list">
    `;

    if (recommendations && recommendations.length > 0) {
      recommendations.slice(0, 6).forEach(item => {
        let badgeClass = "urgency-NORMAL";
        let urgencyText = `${item.diffDays}일 전 복습`;
        if (item.diffDays >= 14) {
          badgeClass = "urgency-CRITICAL";
          urgencyText = `🚨 ${item.diffDays}일 경과 (시급)`;
        } else if (item.diffDays >= 7) {
          badgeClass = "urgency-WARNING";
          urgencyText = `⚠️ ${item.diffDays}일 경과 (권장)`;
        }

        html += `
          <div class="recommend-item">
            <div>
              <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 4px;">
                ${this.escapeHtml(item.docTitle)}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">
                누적 ${item.reviewCount}회독 | 마지막 복습: ${new Date(item.lastReviewedAt).toLocaleDateString()}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="urgency-badge ${badgeClass}">${urgencyText}</span>
              <button class="btn btn-primary" style="font-size: 0.8rem; padding: 5px 12px;" onclick="Reader.open('${item.docId}')">
                복습하기
              </button>
            </div>
          </div>
        `;
      });
    } else {
      html += '<div style="color: var(--text-muted); padding: 16px; text-align: center;">추천할 복습 문서가 없습니다. 새로운 지식을 탐색해 보세요!</div>';
    }

    html += `
        </div>
      </div>

      <!-- 4. 최근 복습 타임라인 로그 -->
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px;">
          📜 최근 복습 히스토리
        </h3>
        <div style="background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden;">
    `;

    if (recentLogs && recentLogs.length > 0) {
      recentLogs.slice(0, 10).forEach((log, idx) => {
        const timeStr = new Date(log.readAt).toLocaleString();
        html += `
          <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; font-size: 0.88rem;">
            <div>
              <span style="color: var(--accent); font-weight: 600;">[${log.device || '태블릿'}]</span>
              <span style="font-weight: 500; margin-left: 6px;">${this.escapeHtml(log.docTitle)}</span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.8rem;">
              ${timeStr} (${Math.round(log.durationSeconds / 60)}분)
            </div>
          </div>
        `;
      });
    } else {
      html += '<div style="padding: 20px; text-align: center; color: var(--text-muted);">아직 학습 로그가 없습니다.</div>';
    }

    html += `
        </div>
      </div>

      <!-- 5. 태블릿 데이터 백업 및 복원 (영구 보존 세이프티 넷) -->
      <div style="margin-top: 24px; padding: 16px 20px; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            <span>🛡️ 태블릿 로컬 데이터 관리</span>
            <span style="font-size: 0.75rem; background: var(--bg-secondary); padding: 2px 6px; border-radius: 4px; color: var(--success); font-weight: normal;">IndexedDB 영구 보존 활성화</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            기기 변경이나 백업이 필요할 때 JSON 파일로 안전하게 보관하세요.
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn" style="font-size: 0.82rem; padding: 6px 14px;" onclick="ZenStorage.exportBackupJSON()">
            📦 백업 다운로드
          </button>
          <label class="btn" style="font-size: 0.82rem; padding: 6px 14px; cursor: pointer; margin-bottom: 0;">
            📥 백업 복원
            <input type="file" accept=".json" style="display: none;" onchange="Dashboard.handleImportBackup(this)">
          </label>
        </div>
      </div>
    `;

    container.innerHTML = html;
  },

  async handleImportBackup(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    try {
      const count = await ZenStorage.importBackupJSON(file);
      App.showToast(`✨ ${count}건의 학습 기록이 성공적으로 복원되었습니다!`);
      this.load();
      if (typeof App !== 'undefined' && App.loadDocuments) {
        App.loadDocuments();
      }
    } catch (err) {
      alert('백업 파일 복원 실패: ' + err.message);
    }
    input.value = '';
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};
