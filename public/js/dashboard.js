// public/js/dashboard.js - Clinical-SM2 에빙하우스 망각곡선 & Bento Grid 학습 대시보드
const Dashboard = {
  async load() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">골든타임 복습 데이터 및 마스터리를 분석하는 중입니다...</div>';

    try {
      // 1. 전체 140개 문서 모수 확보
      const allDocs = (typeof App !== 'undefined' && App.documents) ? App.documents : [];
      
      // 2. 태블릿 IndexedDB 기반 Clinical-SM2 고급 통계 산출
      if (typeof ZenStorage !== 'undefined') {
        const advStats = await ZenStorage.calculateAdvancedStats(allDocs);
        this.render(advStats);
        return;
      }

      // 3. 만약 ZenStorage가 없으면 서버 API 폴백
      const response = await fetch('/api/study-stats', {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
        }
      });
      if (response.status === 401 && typeof App !== 'undefined') {
        App.handleUnauthorized();
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }
      const data = await response.json();
      if (data.success && data.stats) {
        this.render(data.stats);
      } else {
        throw new Error(data.error || "통계 로딩 실패");
      }
    } catch (err) {
      console.warn('[Dashboard] 통계 로딩 실패:', err);
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>통계 로딩 실패</h3>
          <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.88rem;">${err.message}</p>
          <button class="btn btn-primary" onclick="Dashboard.load()">다시 시도</button>
        </div>
      `;
    }
  },

  render(stats) {
    const container = document.getElementById('dashboard-content');
    if (!container) return;

    const summary = stats.summary || {
      currentStreak: 1,
      totalReviews: 0,
      totalDocuments: 140,
      targetCompletedCount: 38,
      studiedCompletedCount: 0,
      inProgressCount: 65,
      todoCount: 37,
      studiedDocsCount: 0,
      coverageRate: 0,
      todayReviews: 0,
      totalStudyMinutes: 0
    };
    const heatmap = stats.heatmap || {};
    const goldenQueue = stats.goldenQueue || [];
    const categoryStats = stats.categoryStats || {};
    const recentLogs = stats.recentLogs || [];

    let html = `
      <!-- A. 최상단 스트릭 및 핵심 요약 벤토 배너 -->
      <div class="dash-summary-banner">
        <div class="streak-badge">
          <span style="font-size: 2rem;">🔥</span>
          <div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 8px;">
              <span>${summary.currentStreak || 1}일 연속 학습 중</span>
              <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; background: rgba(245, 158, 11, 0.18); color: #f59e0b; font-weight: 600;">Long-term Streak</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
              작성 완료된 <strong>${summary.targetCompletedCount || 38}개</strong> 노트를 우선 마스터하세요. (집필 중 ${summary.inProgressCount || 65}개, 시작 전 ${summary.todoCount || 37}개 제외)
            </div>
          </div>
        </div>
        <div class="summary-pills">
          <div class="pill-item">
            <span class="label">총 회독수</span>
            <span class="val highlight">${summary.totalReviews}회</span>
          </div>
          <div class="pill-item" style="min-width: 130px;">
            <span class="label">공부 대상 커버리지</span>
            <span class="val highlight">${summary.studiedCompletedCount || 0} / ${summary.targetCompletedCount || 38} <span style="font-size: 0.75rem; color: var(--accent); font-weight: 700;">(${summary.coverageRate || 0}%)</span></span>
          </div>
          <div class="pill-item">
            <span class="label">오늘 복습</span>
            <span class="val">${summary.todayReviews}개</span>
          </div>
          <div class="pill-item">
            <span class="label">누적 집중 시간</span>
            <span class="val">${summary.totalStudyMinutes}분</span>
          </div>
        </div>
      </div>

      <!-- B. 2열 Bento Grid 반응형 레이아웃 (태블릿 가로 & 데스크탑) -->
      <div class="dash-responsive-layout">
        
        <!-- 좌측 열: 오늘의 골든타임 Top 5 큐 + 카테고리 마스터리 -->
        <div class="dash-col-primary">
          
          <!-- 1. 오늘의 골든타임 복습 Top 5 큐 -->
          <div class="dash-panel">
            <div class="panel-header">
              <div>
                <span class="title">🎯 오늘의 골든타임 복습 Top 5</span>
                <span class="subtitle">작성 완료(38개) 대상 망각 곡선 우선순위</span>
              </div>
              <span style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">Clinical-SM2</span>
            </div>
            <div class="golden-queue-list">
    `;

    if (goldenQueue && goldenQueue.length > 0) {
      goldenQueue.forEach((doc, idx) => {
        let badgeHtml = '';
        if (doc.urgencyBadge === 'CRITICAL') {
          badgeHtml = `<span class="badge-urgent-critical">🚨 긴급 (${doc.diffDays}일 전)</span>`;
        } else if (doc.urgencyBadge === 'DUE') {
          badgeHtml = `<span class="badge-urgent-due">⚠️ 도래 (${doc.diffDays}일 전)</span>`;
        } else if (doc.urgencyBadge === 'NEW') {
          badgeHtml = `<span class="badge-urgent-new">🆕 신규 미학습</span>`;
        } else {
          badgeHtml = `<span class="badge-urgent-stable">🟢 주기 ${doc.intervalDays || 1}일</span>`;
        }

        html += `
          <div class="queue-card">
            <div class="queue-card-left">
              <div class="queue-idx">${idx + 1}</div>
              <div class="queue-info">
                <div class="queue-title" title="${this.escapeHtml(doc.title)}">${this.escapeHtml(doc.title)}</div>
                <div class="queue-meta">
                  <span class="cat-tag">${this.escapeHtml(doc.category || '임상약학')}</span>
                  <span>누적 ${doc.reviewCount || 0}회독</span>
                  <span>권장 주기: ${doc.intervalDays || 1}일</span>
                </div>
              </div>
            </div>
            <div class="queue-card-right">
              ${badgeHtml}
              <button class="btn btn-primary btn-sm touch-target" onclick="Reader.open('${doc.id}')">
                원터치 복습
              </button>
            </div>
          </div>
        `;
      });
    } else {
      html += `
        <div style="text-align: center; padding: 32px 16px; color: var(--text-muted); background: var(--bg-secondary); border-radius: 10px;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">🎉</div>
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">오늘의 골든타임 복습을 모두 달성했습니다!</div>
          <div style="font-size: 0.8rem;">아래 임상 카테고리에서 미착수(Level 0) 노트를 골라 새로운 지식을 정복해보세요.</div>
        </div>
      `;
    }

    html += `
            </div>
          </div>

          <!-- 2. 임상 도메인별 마스터리 (4단계 스택트 프로그레스) -->
          <div class="dash-panel" style="margin-top: 20px;">
            <div class="panel-header">
              <div>
                <span class="title">📊 임상 도메인별 마스터리</span>
                <span class="subtitle">140개 노트 4단계 회독 숙련도 분포</span>
              </div>
            </div>
            <div class="category-bars-list">
    `;

    const catKeys = Object.keys(categoryStats);
    if (catKeys.length > 0) {
      catKeys.forEach(cat => {
        const c = categoryStats[cat];
        const masterPct = Math.round(((c.level1 + c.level2 + c.level3) / c.total) * 100);
        const isWeak = (c.level0 / c.total) >= 0.4;

        html += `
          <div class="category-item">
            <div class="category-info-row">
              <span class="cat-name">
                <strong>${this.escapeHtml(cat)}</strong>
                <span style="color: var(--text-muted); font-size: 0.78rem; margin-left: 4px;">(${c.total}개)</span>
                ${isWeak ? '<span class="weak-badge">⚠️ 취약 영역: 보완 권장</span>' : ''}
              </span>
              <span class="cat-pct">${masterPct}% 착수</span>
            </div>
            <div class="stacked-progress-bar">
              <div class="bar-segment seg-l3" style="width: ${(c.level3 / c.total) * 100}%;" title="마스터(5회독+): ${c.level3}개"></div>
              <div class="bar-segment seg-l2" style="width: ${(c.level2 / c.total) * 100}%;" title="정착기(3-4회독): ${c.level2}개"></div>
              <div class="bar-segment seg-l1" style="width: ${(c.level1 / c.total) * 100}%;" title="입문(1-2회독): ${c.level1}개"></div>
              <div class="bar-segment seg-l0" style="width: ${(c.level0 / c.total) * 100}%;" title="미착수: ${c.level0}개"></div>
            </div>
          </div>
        `;
      });
    } else {
      html += '<div style="color: var(--text-muted); padding: 16px; text-align: center;">카테고리 정보를 분석 중입니다...</div>';
    }

    html += `
              <div class="mastery-legend">
                <span class="legend-dot"><span class="dot-box seg-l3"></span>마스터 (5회독+)</span>
                <span class="legend-dot"><span class="dot-box seg-l2"></span>정착기 (3~4회독)</span>
                <span class="legend-dot"><span class="dot-box seg-l1"></span>입문 (1~2회독)</span>
                <span class="legend-dot"><span class="dot-box seg-l0"></span>미착수 (0회독)</span>
              </div>
            </div>
          </div>

        </div>

        <!-- 우측 열: 90일 복습 잔디 히트맵 + 최근 기록 + 백업/복원 -->
        <div class="dash-col-secondary">
          
          <!-- 3. 복습 잔디 히트맵 -->
          <div class="dash-panel">
            <div class="panel-header">
              <div>
                <span class="title">📅 최근 90일 복습 잔디</span>
                <span class="subtitle">누적 ${summary.totalReviews}회 학습 기록</span>
              </div>
            </div>
            <div class="heatmap-container" style="margin-bottom: 0;">
              <div class="heatmap-grid" id="heatmap-grid-cells">
    `;

    Object.keys(heatmap).sort().forEach(date => {
      const count = heatmap[date];
      let level = 0;
      if (count >= 4) level = 4;
      else if (count >= 2) level = 3;
      else if (count >= 1) level = 2;
      html += `<div class="heatmap-cell level-${level}" title="${date}: ${count}회 복습"></div>`;
    });

    html += `
              </div>
            </div>
          </div>

          <!-- 4. 최근 복습 타임라인 로그 -->
          <div class="dash-panel" style="margin-top: 20px;">
            <div class="panel-header">
              <span class="title">📜 최근 복습 로그</span>
            </div>
            <div class="recent-logs-box">
    `;

    if (recentLogs && recentLogs.length > 0) {
      recentLogs.slice(0, 8).forEach(l => {
        const t = new Date(l.readAt || l.timestamp).toLocaleDateString();
        const mins = Math.max(1, Math.round((Number(l.durationSeconds) || 60) / 60));
        let feedbackLabel = '🔵 적정';
        if (l.feedback === 'easy') feedbackLabel = '🟢 수월함';
        else if (l.feedback === 'hard') feedbackLabel = '🔴 헷갈림';

        html += `
          <div class="recent-log-row">
            <div class="recent-log-main">
              <span class="log-title">${this.escapeHtml(l.docTitle || '제목 없음')}</span>
              <span class="log-meta">${t} · ${mins}분 체류 · ${feedbackLabel}</span>
            </div>
            <button class="btn btn-sm" style="padding: 3px 8px; font-size: 0.75rem;" onclick="Reader.open('${l.docId}')">열기</button>
          </div>
        `;
      });
    } else {
      html += '<div style="color: var(--text-muted); padding: 16px; text-align: center; font-size: 0.85rem;">아직 기록된 복습 로그가 없습니다.</div>';
    }

    html += `
            </div>
          </div>

          <!-- 5. 데이터 백업 및 오프라인 관리 바로가기 -->
          <div class="dash-panel" style="margin-top: 20px; background: rgba(30, 41, 59, 0.4);">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
              <div>
                <div style="font-weight: 700; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                  <span>🛡️ 태블릿 SSD 로컬 보존</span>
                  <span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 6px; border-radius: 4px; font-weight: 600;">IndexedDB Persist</span>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">
                  전체 학습 기록 백업/복원 및 오프라인 동기화는 설정 탭에서 관리할 수 있습니다.
                </div>
              </div>
              <div>
                <button class="btn btn-sm btn-primary" onclick="App.showView('settings')">
                  ⚙️ 데이터 및 설정 열기 →
                </button>
              </div>
            </div>
          </div>

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
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast(`✨ ${count}건의 학습 기록이 성공적으로 복원되었습니다!`);
      }
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
