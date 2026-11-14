// public/js/settings.js - 신규 [⚙️ 데이터 및 설정] 탭 통합 컨트롤러
const Settings = {
  async load() {
    const container = document.getElementById('settings-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">설정 및 저장소 데이터를 집계하는 중입니다...</div>';

    try {
      // 1. 오프라인 대기 큐 확인
      const queue = (typeof OfflineManager !== 'undefined' && OfflineManager.getQueue) ? OfflineManager.getQueue() : [];

      // 2. 태블릿 IndexedDB 스토리지 추정치 및 영구 락 확인
      let storageEstimate = { usageMB: '0.00', quotaMB: '0.00' };
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          storageEstimate.usageMB = ((est.usage || 0) / (1024 * 1024)).toFixed(2);
          storageEstimate.quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
        } catch (e) {}
      }

      const isPersisted = (typeof OfflineManager !== 'undefined') ? Boolean(OfflineManager.isPersisted) : false;

      // 3. 누적 로컬 로그 수 확인
      let localLogsCount = 0;
      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.getAllLogs === 'function') {
        const logs = await ZenStorage.getAllLogs();
        localLogsCount = logs.length;
      }

      // 3-1. 오프라인 문서 본문 캐시 요약 집계
      let cacheSummary = null;
      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.getOfflineCacheSummary === 'function') {
        try {
          cacheSummary = await ZenStorage.getOfflineCacheSummary(
            (typeof App !== 'undefined' && Array.isArray(App.documents)) ? App.documents : []
          );
        } catch (e) {
          console.warn('[Settings] 오프라인 캐시 요약 조회 실패:', e);
        }
      }

      // 4. 현재 테마 및 글자 크기
      const currentTheme = localStorage.getItem('zen_theme') || 'theme-dark';
      const currentFontSize = localStorage.getItem('zen_font_size') || 'font-md';

      this.render({
        queue,
        storageEstimate,
        isPersisted,
        localLogsCount,
        cacheSummary,
        currentTheme,
        currentFontSize,
        isOnline: (typeof navigator !== 'undefined' && navigator.onLine !== undefined) ? navigator.onLine : true,
        docsCount: (typeof App !== 'undefined' && Array.isArray(App.documents)) ? App.documents.length : 0
      });
    } catch (err) {
      console.error('[Settings] 설정 화면 로딩 오류:', err);
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>설정 화면을 불러오지 못했습니다</h3>
          <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.88rem;">${err.message}</p>
          <button class="btn btn-primary" onclick="Settings.load()">다시 시도</button>
        </div>
      `;
    }
  },

  render(data) {
    const container = document.getElementById('settings-content');
    if (!container) return;

    const queue = Array.isArray(data.queue) ? data.queue : [];
    const queueCount = queue.length;
    const isOnline = Boolean(data.isOnline);
    const storageEstimate = data.storageEstimate || { usageMB: '0.00', quotaMB: '0.00' };
    const localLogsCount = Number(data.localLogsCount || 0);
    const isPersisted = Boolean(data.isPersisted);

    const summary = data.cacheSummary || {
      totalRemote: data.docsCount || 0,
      cachedCount: 0,
      upToDateCount: 0,
      outdatedCount: 0,
      missingCount: data.docsCount || 0,
      orphanCount: 0,
      approxSizeKB: 0,
      lastCachedAt: null
    };
    const totalRemote = Number(summary.totalRemote || 0);
    const cachedCount = Number(summary.cachedCount || 0);
    const upToDateCount = Number(summary.upToDateCount || 0);
    const outdatedCount = Number(summary.outdatedCount || 0);
    const missingCount = Number(summary.missingCount || 0);
    const orphanCount = Number(summary.orphanCount || 0);
    const approxSizeKB = Number(summary.approxSizeKB || 0);
    const lastCachedLabel = summary.lastCachedAt
      ? new Date(summary.lastCachedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '없음';

    let html = `
      <div class="settings-container">
        
        <!-- 1. 화면 모드 (에버그린 / 메도우 그린 프로파일 탑재) -->
        <div class="settings-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">🎨</span>
              <h2 class="panel-title">화면 모드 (안구 피로도 방어 프로파일)</h2>
            </div>
            <span class="theme-accent-badge">신규 에버그린 탑재</span>
          </div>
          <p class="panel-desc">
            장시간 약학 및 의학 롱폼 독서 시 눈의 피로를 최소화하는 4대 컬러 프로파일을 제공합니다.
          </p>

          <!-- 4대 테마 선택 그리드 -->
          <div class="theme-card-grid">
            <!-- 다크 -->
            <button onclick="Settings.selectTheme('theme-dark')" class="theme-card ${data.currentTheme === 'theme-dark' ? 'active' : ''}" style="background: #0c0f17; color: #f1f5f9; border-color: rgba(255,255,255,0.12);">
              <div class="theme-card-header">
                <span class="theme-name">🌙 딥 다크</span>
                <span class="theme-tag">OLED 절전</span>
              </div>
              <div class="theme-swatch" style="background: #18202f;"></div>
            </button>

            <!-- 라이트 -->
            <button onclick="Settings.selectTheme('theme-light')" class="theme-card ${data.currentTheme === 'theme-light' ? 'active' : ''}" style="background: #f7f4ee; color: #1e293b; border-color: rgba(0,0,0,0.1);">
              <div class="theme-card-header">
                <span class="theme-name">☀️ 문켄 라이트</span>
                <span class="theme-tag">서적 질감</span>
              </div>
              <div class="theme-swatch" style="background: #ffffff; border: 1px solid #ebe6dc;"></div>
            </button>

            <!-- 세피아 -->
            <button onclick="Settings.selectTheme('theme-sepia')" class="theme-card ${data.currentTheme === 'theme-sepia' ? 'active' : ''}" style="background: #f2e8d5; color: #2d2417; border-color: #d8c9a8;">
              <div class="theme-card-header">
                <span class="theme-name">☕ 킨들 세피아</span>
                <span class="theme-tag">2700K 웜</span>
              </div>
              <div class="theme-swatch" style="background: #f9f2e4; border: 1px solid #d8c9a8;"></div>
            </button>

            <!-- 에버그린 (신규) -->
            <button onclick="Settings.selectTheme('theme-green')" class="theme-card theme-card-green ${data.currentTheme === 'theme-green' ? 'active' : ''}" style="background: #eef5e8; color: #19331e; border-color: #a3cca2;">
              <div class="theme-card-header">
                <span class="theme-name font-bold">🌲 에버그린</span>
                <span class="theme-tag" style="background: #8bc34a; color: #19331e; font-weight: 700;">자연 초록</span>
              </div>
              <div class="green-swatches-row">
                <span style="background: #b5d692;" title="에버그린 1 (#b5d692)"></span>
                <span style="background: #a3cca2;" title="에버그린 2 (#a3cca2)"></span>
                <span style="background: #8bc34a;" title="메도우 그린 (#8bc34a)"></span>
              </div>
            </button>
          </div>

          <!-- 폰트 크기 조절 프리셋 -->
          <div class="font-settings-row">
            <div class="font-label-wrap">
              <span>🔤 태블릿 독서 글자 크기:</span>
              <strong id="settings-font-label" style="color: var(--accent); margin-left: 6px;">
                ${data.currentFontSize === 'font-sm' ? '작게 (15px)' : (data.currentFontSize === 'font-lg' ? '크게 (20.5px)' : '보통 (17.5px)')}
              </strong>
            </div>
            <div class="font-btn-group">
              <button onclick="Settings.selectFontSize('font-sm', '작게 (15px)')" class="btn btn-sm ${data.currentFontSize === 'font-sm' ? 'btn-primary' : 'btn-secondary'}">작게</button>
              <button onclick="Settings.selectFontSize('font-md', '보통 (17.5px)')" class="btn btn-sm ${data.currentFontSize === 'font-md' ? 'btn-primary' : 'btn-secondary'}">보통</button>
              <button onclick="Settings.selectFontSize('font-lg', '크게 (20.5px - 8.4인치 권장)')" class="btn btn-sm ${data.currentFontSize === 'font-lg' ? 'btn-primary' : 'btn-secondary'}">크게 (권장)</button>
            </div>
          </div>
        </div>

        <!-- 2. 오프라인 동기화 센터 -->
        <div class="settings-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">🔄</span>
              <h2 class="panel-title">오프라인 동기화 센터</h2>
            </div>
            <span class="queue-status-pill ${queueCount > 0 ? 'pill-warning' : 'pill-success'}">
              ${queueCount > 0 ? `대기 중: ${queueCount}건` : '모두 동기화됨'}
            </span>
          </div>
          <p class="panel-desc">
            네트워크가 단절된 야외나 기내에서 학습한 기록이 기기 큐에 보존되어 있습니다. 와이파이 연결 시 자동 전송되며, 지금 수동으로 즉시 쏠 수도 있습니다.
          </p>

          <!-- 대기 큐 미리보기 목록 -->
          <div class="queue-box">
            ${queueCount > 0 ? queue.slice(0, 5).map(item => `
              <div class="queue-item">
                <div class="queue-item-left">
                  <span class="queue-icon">⏳</span>
                  <span class="queue-title">${this.escapeHtml(item.docTitle || '문서')}</span>
                </div>
                <div class="queue-item-right">
                  <span class="queue-badge">${item.reviewCount || 1}회독</span>
                  <span class="queue-feedback">${item.feedback === 'easy' ? '🟢 수월함' : (item.feedback === 'hard' ? '🔴 헷갈림' : '🔵 적정')}</span>
                </div>
              </div>
            `).join('') : `
              <div class="queue-empty">
                ✨ 현재 대기 중인 오프라인 학습 기록이 없습니다. (모든 기록이 서버와 100% 일치)
              </div>
            `}
          </div>

          <div class="panel-footer-actions">
            <div class="footer-meta-text">
              네트워크: <strong>${isOnline ? '● 온라인' : '● 오프라인 (캐시)'}</strong>
            </div>
            <div class="footer-btn-group">
              <button onclick="Settings.flushOfflineQueueNow()" id="btn-settings-sync-now" class="btn btn-primary" ${queueCount === 0 ? 'disabled' : ''}>
                ⚡ 대기 ${queueCount}건 즉시 서버 업로드
              </button>
              <button onclick="App.loadDocuments(true)" class="btn btn-secondary">
                🔄 노션 대조
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 태블릿 SSD 저장소 & 물리 백업 -->
        <div class="settings-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">🛡️</span>
              <h2 class="panel-title">태블릿 SSD 영구 보존 및 물리 백업</h2>
            </div>
            <span class="lock-status-badge ${isPersisted ? '' : 'lock-status-pending'}">
              ${isPersisted ? '🔒 Persistent Lock 승인' : '⚠️ 일반 보존 (대기)'}
            </span>
          </div>
          <p class="panel-desc">
            Vercel 서버리스의 휘발성 제한과 무관하게, 태블릿 내부 <strong>IndexedDB (ZenReaderDB)</strong>에 안전하게 영구 보존됩니다.
          </p>

          <div class="storage-metrics-grid">
            <div class="metric-card">
              <span class="metric-label">로컬 누적 로그</span>
              <span class="metric-val">${localLogsCount}건 기록됨</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">스토리지 사용량</span>
              <span class="metric-val">${storageEstimate.usageMB} MB / SSD</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">OS 캐시 정리 방어</span>
              <span class="metric-val" style="color: ${isPersisted ? 'var(--success)' : 'var(--warning)'};">
                ${isPersisted ? '면제 승인 완료' : '일반 보존 (요청 대기)'}
              </span>
            </div>
          </div>

          <div class="panel-footer-actions">
            <div class="footer-meta-text">
              타 기기나 데스크탑 PC로 데이터를 옮기거나 영구 소장할 때 활용하세요.
            </div>
            <div class="footer-btn-group">
              <button onclick="ZenStorage.exportBackupJSON()" class="btn btn-secondary">
                📦 백업 JSON 다운로드
              </button>
              <label class="btn btn-secondary" style="cursor: pointer; margin-bottom: 0;">
                📥 백업 파일 복원
                <input type="file" accept=".json" style="display: none;" onchange="Settings.handleImportBackup(this)">
              </label>
            </div>
          </div>
        </div>

        <!-- 4. 오프라인 문서 본문 캐시 & 증분 저장소 관리 -->
        <div class="settings-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">📦</span>
              <h2 class="panel-title">오프라인 문서 본문 캐시 관리</h2>
            </div>
            <span class="queue-status-pill ${totalRemote > 0 && missingCount === 0 && outdatedCount === 0 ? 'pill-success' : 'pill-warning'}">
              ${totalRemote > 0 && missingCount === 0 && outdatedCount === 0 ? '전 문서 최신 저장됨' : `미저장 ${missingCount} · 수정 ${outdatedCount}`}
            </span>
          </div>
          <p class="panel-desc">
            IndexedDB(<code>ZenReaderDB</code>)에 저장된 문서 본문·이미지 캐시 현황입니다. 미저장·수정 문서만 골라 증분 저장하거나, 학습 기록(회독수/히트맵)을 100% 유지한 채 문서 캐시만 비울 수 있습니다.
          </p>

          <div class="cache-summary-text">
            <div>저장 완료: <strong>${cachedCount} / ${totalRemote}건</strong> (미저장 ${missingCount}건, 업데이트 필요 ${outdatedCount}건)</div>
            <div>문서 본문 캐시 용량: <strong>약 ${approxSizeKB} KB</strong>${orphanCount > 0 ? ` · <span class="cache-orphan-warn">고아 문서 ${orphanCount}건 정리 가능</span>` : ''}</div>
          </div>

          <div class="cache-stats-grid">
            <div class="cache-stat-pill pill-accent">
              <span class="cache-stat-label">저장 완료 / 전체</span>
              <span class="cache-stat-value">${cachedCount} / ${totalRemote}건</span>
            </div>
            <div class="cache-stat-pill">
              <span class="cache-stat-label">최신 본문</span>
              <span class="cache-stat-value">${upToDateCount}건</span>
            </div>
            <div class="cache-stat-pill ${outdatedCount > 0 || missingCount > 0 ? 'pill-warn' : ''}">
              <span class="cache-stat-label">미저장 / 업데이트 필요</span>
              <span class="cache-stat-value">${missingCount}건 / ${outdatedCount}건</span>
            </div>
            <div class="cache-stat-pill ${orphanCount > 0 ? 'pill-warn' : ''}">
              <span class="cache-stat-label">캐시 용량 / 고아 문서</span>
              <span class="cache-stat-value">약 ${approxSizeKB} KB · ${orphanCount}건</span>
            </div>
          </div>

          <div class="cache-actions-row">
            <button onclick="App.downloadAllForOffline(false)" class="btn btn-primary">
              📥 미저장·수정 문서 증분 저장
            </button>
            <button onclick="App.downloadAllForOffline(true)" class="btn btn-secondary">
              🔄 전체 강제 재다운로드
            </button>
            <button onclick="Settings.pruneOrphans()" class="btn btn-secondary" ${orphanCount === 0 ? 'disabled' : ''}>
              🧹 고아 문서 정리
            </button>
            <button onclick="Settings.clearDocCacheOnly()" class="btn btn-danger-subtle">
              🗑️ 문서 캐시만 비우기 (학습기록 보존)
            </button>
          </div>
          <div class="footer-meta-text" style="margin-top: 10px;">
            최근 본문 캐시 시각: <strong>${this.escapeHtml(lastCachedLabel)}</strong>
          </div>
        </div>

        <!-- 5. PIN 보안 게이트 관리 -->
        <div class="settings-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">🔐</span>
              <h2 class="panel-title">PIN 보안 게이트 관리</h2>
            </div>
          </div>
          <div class="panel-footer-actions" style="padding-top: 0;">
            <div class="footer-meta-text">
              현재 PIN 번호로 안전하게 인증된 상태입니다. 타인 공유 시 즉시 잠글 수 있습니다.
            </div>
            <button onclick="Settings.lockApp()" class="btn btn-danger-subtle">
              🔒 서재 즉시 잠그기 (로그아웃)
            </button>
          </div>
        </div>

      </div>
    `;

    container.innerHTML = html;
  },

  selectTheme(theme) {
    App.setTheme(theme);
    this.updateThemeButtons(theme);
    const names = {
      'theme-dark': '🌙 딥 다크 모드 (OLED 절전)',
      'theme-light': '☀️ 문켄 라이트 모드 (북유럽 서적 질감)',
      'theme-sepia': '☕ 킨들 세피아 모드 (2700K 웜톤)',
      'theme-green': '🌲 에버그린 자연 초록 모드 (#b5d692, #a3cca2, #8bc34a)'
    };
    App.showToast((names[theme] || theme) + '가 적용되었습니다!');
  },

  updateThemeButtons(theme) {
    const cards = document.querySelectorAll('.theme-card');
    cards.forEach(card => card.classList.remove('active'));
    const targetMap = {
      'theme-dark': 0,
      'theme-light': 1,
      'theme-sepia': 2,
      'theme-green': 3
    };
    if (cards[targetMap[theme]]) {
      cards[targetMap[theme]].classList.add('active');
    }
  },

  selectFontSize(size, label) {
    App.setFontSize(size);
    this.updateFontButtons(size, label);
    App.showToast(`🔤 글자 크기가 ${label}로 설정되었습니다.`);
  },

  updateFontButtons(size, label) {
    const lbl = document.getElementById('settings-font-label');
    if (lbl) {
      lbl.innerText = label || (size === 'font-sm' ? '작게 (15px)' : (size === 'font-lg' ? '크게 (20.5px)' : '보통 (17.5px)'));
    }
  },

  async flushOfflineQueueNow() {
    if (!navigator.onLine) {
      App.showToast('⚠️ 오프라인 상태입니다. 네트워크 연결 후 전송할 수 있습니다.');
      return;
    }

    const btn = document.getElementById('btn-settings-sync-now');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span><span>서버 전송 중...</span>';
    }

    try {
      if (typeof OfflineManager !== 'undefined' && OfflineManager.flushQueue) {
        await OfflineManager.flushQueue();
      }
      this.load();
      App.showToast('🎉 오프라인 학습 기록이 Vercel 서버로 동기화 완료되었습니다!');
    } catch (err) {
      App.showToast('⚠️ 동기화 실패: ' + err.message);
      if (btn) btn.disabled = false;
    }
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

  async pruneOrphans() {
    if (typeof ZenStorage === 'undefined' || typeof ZenStorage.pruneOrphanDocuments !== 'function') {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('⚠️ 저장소 모듈이 아직 초기화되지 않았습니다.');
      }
      return 0;
    }

    const validIds = (typeof App !== 'undefined' && Array.isArray(App.documents))
      ? App.documents.map(d => d.id)
      : [];

    if (validIds.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('⚠️ 유효한 원격 문서 목록이 없어 고아 문서 정리를 건너뛰었습니다.');
      }
      return 0;
    }

    try {
      const deletedCount = await ZenStorage.pruneOrphanDocuments(validIds);
      if (typeof App !== 'undefined' && typeof App.refreshOfflineDocIds === 'function') {
        await App.refreshOfflineDocIds();
      }
      await this.load();
      if (typeof App !== 'undefined' && App.showToast) {
        if (deletedCount > 0) {
          App.showToast(`🧹 노션에서 삭제된 고아 문서 캐시 ${deletedCount}건을 정리했습니다.`);
        } else {
          App.showToast('✨ 정리할 고아 문서가 없습니다.');
        }
      }
      return deletedCount;
    } catch (err) {
      console.error('[Settings] 고아 문서 정리 오류:', err);
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('⚠️ 고아 문서 정리 실패: ' + err.message);
      }
      return 0;
    }
  },

  async clearDocCacheOnly() {
    if (typeof ZenStorage === 'undefined' || typeof ZenStorage.clearDocumentCache !== 'function') {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('⚠️ 저장소 모듈이 아직 초기화되지 않았습니다.');
      }
      return null;
    }

    const confirmed = (typeof confirm === 'function')
      ? confirm(
        '다운로드된 문서 본문·이미지 캐시만 삭제하시겠습니까?\n\n' +
        '✅ 학습 기록(회독수, 공부 시간, 잔디 히트맵, 복습 일정)은 100% 그대로 보존됩니다.\n' +
        '🗑️ 다운로드된 문서 본문·이미지 캐시만 비워지며, 온라인 시 언제든 다시 저장할 수 있습니다.'
      )
      : true;
    if (!confirmed) return false;

    try {
      const result = await ZenStorage.clearDocumentCache();
      const clearedCount = result && typeof result.clearedDocsCount === 'number' ? result.clearedDocsCount : 0;

      if (typeof App !== 'undefined') {
        if (Array.isArray(App.documents)) {
          App.documents.forEach(doc => {
            doc.hasUpdate = false;
            doc.isCachedLocally = false;
          });
        }
        if (typeof App.refreshOfflineDocIds === 'function') {
          await App.refreshOfflineDocIds();
        }
        if (typeof App.loadDocuments === 'function') {
          try {
            await App.loadDocuments();
          } catch (loadErr) {
            console.warn('[Settings] 캐시 삭제 후 목록 재조회 건너뜀:', loadErr);
          }
        }
      }

      await this.load();
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast(`🗑️ 문서 캐시 ${clearedCount}건을 비웠습니다. (학습 기록 100% 보존됨)`);
      }
      return result;
    } catch (err) {
      console.error('[Settings] 문서 캐시 비우기 오류:', err);
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('⚠️ 문서 캐시 비우기 실패: ' + err.message);
      }
      return null;
    }
  },

  lockApp() {
    localStorage.removeItem('zen_pin_verified');
    localStorage.removeItem('zen_pin_code');
    const modal = document.getElementById('pin-modal');
    if (modal) modal.style.display = 'flex';
    App.showToast('🔒 서재가 잠금 처리되었습니다. 올바른 PIN 번호가 필요합니다.');
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

if (typeof window !== 'undefined') {
  window.Settings = Settings;
}
