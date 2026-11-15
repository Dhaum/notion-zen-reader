// public/js/reader.js - Stageshow 인체공학 썸 존 독 & 3단계 기억 피드백 리더
const Reader = {
  currentDoc: null,
  readingStartTime: 0,
  readingTimer: null,
  durationSeconds: 0,
  hasLoggedStudy: false,
  currentLogId: null,
  currentClientLogId: null,
  currentFeedback: null,
  isDockFeedbackOpen: false,
  lastScrollY: 0,
  scrollThreshold: 15,
  isAllTogglesExpanded: false,
  headingsList: [],
  headingCounter: 0,
  mermaidCounter: 0,
  _mermaidSources: {},
  _mermaidRenderPass: 0,
  _mermaidZoomScale: 1,
  _mermaidModalDiagramId: null,
  _mermaidModalRotated: false,
  _panZoomStates: {},
  _tocIdleTimer: null,
  _tocPillTimer: null,
  _isScrubbingToc: false,
  _suppressSwipeBack: false,
  touchStartX: 0,
  touchStartY: 0,
  touchStartTime: 0,
  swipeHandlerAttached: false,

  // 통합 뒤로가기 핸들러 (History API 스택 감지하여 바탕화면 튕김 차단)
  goBack() {
    this.closeDockFeedbackPicker();
    if (typeof history !== 'undefined' && history.length > 1 && history.state?.view === 'reader') {
      history.back();
    } else if (typeof App !== 'undefined') {
      App.showView('list');
    }
  },

  _openSeq: 0,

  async applyLocalMetadata(docId, doc, { markSynced = true } = {}) {
    if (!doc) return;

    // 태블릿 로컬 IndexedDB의 회독수 및 복습일자 반영
    if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.getDocStatsMap === 'function') {
      try {
        const statsMap = await ZenStorage.getDocStatsMap();
        if (statsMap && statsMap[docId]) {
          doc.reviewCount = Math.max(doc.reviewCount || 0, statsMap[docId].reviewCount || 0);
          if (statsMap[docId].lastReviewedAt) {
            doc.lastReviewedAt = statsMap[docId].lastReviewedAt;
          }
        }
      } catch (e) {
        console.warn('[Reader] 로컬 통계 맵 조회 실패:', e);
      }
    }

    // 로컬 동기화 타임스탬프 및 오프라인 캐시 상태 갱신
    if (typeof App !== 'undefined') {
      if (App.offlineDocIds && typeof App.offlineDocIds.add === 'function') {
        App.offlineDocIds.add(docId);
      }
      if (markSynced) {
        if (typeof App.setDocSyncMap === 'function') {
          App.setDocSyncMap(docId, doc.updatedAt);
        }
        if (Array.isArray(App.documents)) {
          const target = App.documents.find(d => d.id === docId);
          if (target) {
            target.hasUpdate = false;
            target.isCachedLocally = true;
            if (doc.updatedAt) target.updatedAt = doc.updatedAt;
          }
        }
      }
    }
  },

  async open(docId, pushHistory = true) {
    const openToken = ++this._openSeq;
    try {
      if (typeof localStorage !== 'undefined' && docId) {
        localStorage.setItem('zen_last_read_doc_id', docId);
      }
    } catch (e) {}

    if (typeof App !== 'undefined' && typeof App.showView === 'function') {
      App.showView('reader', false);
    }
    if (pushHistory && typeof history !== 'undefined' && history.pushState) {
      history.pushState({ view: 'reader', docId }, '', `#read/${docId}`);
    }

    const container = (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById('reader-content')
      : null;
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">문서를 불러오는 중입니다...</div>';

    // 타이머 및 상태 초기화
    this.hasLoggedStudy = false;
    this.currentLogId = null;
    this.currentClientLogId = null;
    this.currentFeedback = null;
    this.isDockFeedbackOpen = false;
    this.closeDockFeedbackPicker();
    this.resetDockCheckinButton();
    this.readingStartTime = Date.now();
    this.durationSeconds = 0;
    this.isAllTogglesExpanded = false;
    this.headingsList = [];
    this.headingCounter = 0;
    this.mermaidCounter = 0;
    this._mermaidSources = {};
    if (this.readingTimer) clearInterval(this.readingTimer);
    this.readingTimer = setInterval(() => {
      this.durationSeconds++;
      this.updateTimerDisplay();
    }, 1000);
    if (this.readingTimer && typeof this.readingTimer.unref === 'function') {
      this.readingTimer.unref();
    }

    // 플로팅 독 표시
    this.showFloatingDock(true);

    const cachedDoc = (typeof ZenStorage !== 'undefined' && typeof ZenStorage.getDocument === 'function')
      ? await ZenStorage.getDocument(docId).catch(() => null)
      : null;
    const listDoc = (typeof App !== 'undefined' && Array.isArray(App.documents))
      ? App.documents.find(d => d.id === docId)
      : null;
    const isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false);

    // 1) 오프라인 & 로컬 캐시 존재: 즉시 오프라인 렌더링 (네트워크 대기 0ms)
    if (isOffline && cachedDoc) {
      const cacheStatus = (listDoc && listDoc.hasUpdate) ? 'outdated' : 'offline';
      this.currentDoc = cachedDoc;
      await this.applyLocalMetadata(docId, this.currentDoc, { markSynced: cacheStatus !== 'outdated' });
      this.render(this.currentDoc, { cacheStatus });
      this.renderTocRail();
      this.setupSwipeToBack();
      this.setupSmartScroll();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0);
      }
      return;
    }

    // 2) 온라인 & 로컬 캐시 최신본 존재: 0ms SWR 즉시 렌더링 후 백그라운드 재검증
    if (!isOffline && cachedDoc && !(listDoc && listDoc.hasUpdate)) {
      this.currentDoc = cachedDoc;
      await this.applyLocalMetadata(docId, this.currentDoc);
      this.render(this.currentDoc, { cacheStatus: 'synced' });
      this.renderTocRail();
      this.setupSwipeToBack();
      this.setupSmartScroll();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0);
      }

      this._revalidationPromise = (async () => {
        try {
          const response = await fetch(`/api/documents/${docId}`, {
            headers: {
              'x-zen-pin': (typeof localStorage !== 'undefined' && localStorage.getItem('zen_pin_code')) || ''
            }
          });
          if (!response || response.ok === false || response.status === 401) return;
          const data = await response.json();
          if (!data || !data.success || !data.document) return;

          const remoteDoc = data.document;
          const remoteTime = remoteDoc.updatedAt ? new Date(remoteDoc.updatedAt).getTime() : 0;
          const localTime = cachedDoc.updatedAt ? new Date(cachedDoc.updatedAt).getTime() : 0;
          if (!isNaN(remoteTime) && !isNaN(localTime) && remoteTime > localTime) {
            if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.saveDocument === 'function') {
              await ZenStorage.saveDocument(remoteDoc);
            }
            if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.prefetchDocumentImages === 'function') {
              ZenStorage.prefetchDocumentImages(remoteDoc, 3).catch(() => {});
            }
            if (this._openSeq === openToken && this.currentDoc && this.currentDoc.id === docId) {
              const prevScrollY = (typeof window !== 'undefined' && typeof window.scrollY === 'number') ? window.scrollY : 0;
              const prevReviewCount = this.currentDoc.reviewCount;
              const prevLastReviewedAt = this.currentDoc.lastReviewedAt;

              this.currentDoc = remoteDoc;
              if (prevReviewCount) {
                this.currentDoc.reviewCount = Math.max(this.currentDoc.reviewCount || 0, prevReviewCount);
              }
              if (prevLastReviewedAt && !this.currentDoc.lastReviewedAt) {
                this.currentDoc.lastReviewedAt = prevLastReviewedAt;
              }
              await this.applyLocalMetadata(docId, this.currentDoc);
              this.render(this.currentDoc, { cacheStatus: 'synced' });
              this.renderTocRail();
              this.setupSmartScroll();
              if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                window.scrollTo(0, prevScrollY);
              }
              if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
                App.showToast('✨ 최신 노션 내용으로 업데이트되었습니다.');
              }
            }
          }
        } catch (_) {
          // 백그라운드 재검증 실패 시 로컬 캐시 유지
        }
      })();
      return;
    }

    // 3) 미저장 문서 또는 수정 감지 문서: 네트워크 Fetch 후 로컬 영구 저장 (실패 시 cachedDoc 폴백)
    try {
      const needsRefresh = Boolean(listDoc && listDoc.hasUpdate);
      const response = await fetch(`/api/documents/${docId}${needsRefresh ? '?refresh=true' : ''}`, {
        headers: {
          'x-zen-pin': (typeof localStorage !== 'undefined' && localStorage.getItem('zen_pin_code')) || ''
        }
      });
      if (response.status === 401 && typeof App !== 'undefined' && typeof App.handleUnauthorized === 'function') {
        App.handleUnauthorized();
        const authErr = new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
        authErr.isUnauthorized = true;
        throw authErr;
      }
      if (response.ok === false) {
        let errBody = {};
        try { errBody = await response.json(); } catch (_) {}
        throw new Error(errBody.error || errBody.message || `서버 오류 (${response.status})`);
      }
      const data = await response.json();
      if (!data || !data.success || !data.document) {
        throw new Error((data && (data.error || data.message)) || "문서를 찾을 수 없습니다.");
      }

      this.currentDoc = data.document;

      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.saveDocument === 'function') {
        try {
          await ZenStorage.saveDocument(this.currentDoc);
        } catch (e) {
          console.warn('[Reader] ZenStorage 문서 저장 실패:', e);
        }
      }
      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.prefetchDocumentImages === 'function') {
        ZenStorage.prefetchDocumentImages(this.currentDoc, 3).catch(() => {});
      }

      await this.applyLocalMetadata(docId, this.currentDoc);

      this.render(this.currentDoc, { cacheStatus: 'synced' });
      this.renderTocRail();
      this.setupSwipeToBack();
      this.setupSmartScroll();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0);
      }
    } catch (err) {
      if (!err.isUnauthorized && cachedDoc) {
        const cacheStatus = (listDoc && listDoc.hasUpdate) ? 'outdated' : 'offline';
        this.currentDoc = cachedDoc;
        await this.applyLocalMetadata(docId, this.currentDoc, { markSynced: cacheStatus !== 'outdated' });
        this.render(this.currentDoc, { cacheStatus });
        this.renderTocRail();
        this.setupSwipeToBack();
        this.setupSmartScroll();
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo(0, 0);
        }
        if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
          App.showToast('📡 오프라인 저장본을 열람합니다.');
        }
        return;
      }

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>문서를 불러올 수 없습니다</h3>
          <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.88rem;">${this.escapeHtml(err.message)}</p>
          <button class="btn" onclick="Reader.goBack()">← 서재로 돌아가기</button>
        </div>
      `;
      this.showFloatingDock(false);
    }
  },

  formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  },

  updateTimerDisplay() {
    const formatted = this.formatDuration(this.durationSeconds);
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) timerDisplay.innerText = formatted;
    const headerTimer = document.getElementById('header-timer-display');
    if (headerTimer) headerTimer.innerText = formatted;
    const dockTimer = document.getElementById('dock-timer-display');
    if (dockTimer) dockTimer.innerText = formatted;
  },

  // 하단 플로팅 아일랜드 독 노출/숨김
  showFloatingDock(visible) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const dock = document.getElementById('zen-floating-dock');
    if (!dock) return;
    if (visible) {
      if (dock.style) dock.style.display = 'flex';
      const t = setTimeout(() => {
        if (dock.classList && typeof dock.classList.add === 'function') dock.classList.add('visible');
      }, 50);
      if (t && typeof t.unref === 'function') t.unref();
    } else {
      if (dock.classList && typeof dock.classList.remove === 'function') dock.classList.remove('visible');
      const t = setTimeout(() => {
        if (dock.style) dock.style.display = 'none';
      }, 280);
      if (t && typeof t.unref === 'function') t.unref();
    }
  },

  // 셀프 테스트 암기 토글 전체 일괄 열기/닫기
  toggleAllSelfTests() {
    const details = document.querySelectorAll('#reader-content details.zen-toggle');
    this.isAllTogglesExpanded = !this.isAllTogglesExpanded;
    details.forEach(el => { el.open = this.isAllTogglesExpanded; });

    const label = document.getElementById('dock-toggle-label');
    const icon = document.getElementById('dock-toggle-icon');
    if (label) label.innerText = this.isAllTogglesExpanded ? '접기' : '토글';
    if (icon) {
      icon.innerHTML = this.isAllTogglesExpanded
        ? '<svg class="zen-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
        : '<svg class="zen-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
      App.showToast(this.isAllTogglesExpanded ? '모든 셀프테스트 토글을 열었습니다.' : '모든 셀프테스트 토글을 닫았습니다.');
    }
  },

  // 현재 열람 중인 단일 문서만 노션 API에서 실시간 1:1 핀포인트 최신화 (~0.4초 소요)
  async refreshCurrentDoc() {
    if (!this.currentDoc || !this.currentDoc.id) {
      if (typeof App !== 'undefined' && typeof App.showToast === 'function') App.showToast('새로고침할 문서가 없습니다.');
      return;
    }
    if (this._isRefreshingCurrent) {
      if (typeof App !== 'undefined' && typeof App.showToast === 'function') App.showToast('이미 최신 내용을 확인하는 중입니다.');
      return;
    }
    this._isRefreshingCurrent = true;

    const docId = this.currentDoc.id;
    const docTitle = this.currentDoc.title || '문서';
    const shortTitle = docTitle.length > 18 ? docTitle.slice(0, 18) + '...' : docTitle;
    const refreshBtn = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('btn-reader-pinpoint-refresh') : null;
    const headerRefreshBtn = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('header-refresh-btn') : null;

    if (refreshBtn) {
      refreshBtn.disabled = true;
      if (refreshBtn.classList) {
        refreshBtn.classList.add('spinning');
        refreshBtn.classList.add('is-loading');
      }
    }
    if (headerRefreshBtn) {
      headerRefreshBtn.disabled = true;
      if (headerRefreshBtn.classList) {
        headerRefreshBtn.classList.add('spinning');
        headerRefreshBtn.classList.add('is-loading');
      }
    }
    if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
      App.showToast(`[${shortTitle}] 노션 최신 내용 대조 중...`);
    }

    try {
      const response = await fetch(`/api/documents/${docId}?refresh=true`, {
        headers: {
          'x-zen-pin': (typeof localStorage !== 'undefined' && localStorage.getItem('zen_pin_code')) || ''
        }
      });

      if (response.status === 401 && typeof App !== 'undefined' && typeof App.handleUnauthorized === 'function') {
        App.handleUnauthorized();
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }
      if (response.ok === false) {
        let errBody = {};
        try { errBody = await response.json(); } catch (_) {}
        throw new Error(errBody.error || errBody.message || `서버 오류 (${response.status})`);
      }

      const data = await response.json();
      if (!data || !data.success || !data.document) {
        throw new Error((data && (data.error || data.message)) || "최신 문서를 불러오지 못했습니다.");
      }

      // 회독수 및 복습일자 보존
      const prevReviewCount = this.currentDoc.reviewCount;
      const prevLastReviewedAt = this.currentDoc.lastReviewedAt;
      const prevUpdatedAt = this.currentDoc.updatedAt;

      // 실제 노션에서 수정 여부 정밀 대조 (팝업과 실제 작동 100% 일치)
      const syncMap = (typeof App !== 'undefined' && App.getDocSyncMap) ? App.getDocSyncMap() : {};
      const localCachedTime = syncMap[docId]?.cachedUpdatedAt || prevUpdatedAt;
      let isModifiedInNotion = false;
      if (localCachedTime && data.document.updatedAt) {
        isModifiedInNotion = new Date(data.document.updatedAt).getTime() > new Date(localCachedTime).getTime();
      }

      this.currentDoc = data.document;
      this.currentDoc.reviewCount = Math.max(this.currentDoc.reviewCount || 0, prevReviewCount || 0);
      if (prevLastReviewedAt) {
        this.currentDoc.lastReviewedAt = prevLastReviewedAt;
      }

      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.saveDocument === 'function') {
        try {
          await ZenStorage.saveDocument(this.currentDoc);
        } catch (e) {
          console.warn('[Reader] ZenStorage 문서 갱신 저장 실패:', e);
        }
      }
      if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.prefetchDocumentImages === 'function') {
        ZenStorage.prefetchDocumentImages(this.currentDoc, 3).catch(() => {});
      }

      await this.applyLocalMetadata(docId, this.currentDoc);

      // 4대 안전장치: 독서 타이머(durationSeconds, readingStartTime)는 절대 초기화하지 않고 연속 유지!
      const currentScrollY = (typeof window !== 'undefined' && typeof window.scrollY === 'number') ? window.scrollY : 0;

      // 본문 및 목차 재렌더링
      this.render(this.currentDoc, { cacheStatus: 'synced' });
      this.renderTocRail();
      this.setupSmartScroll();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, currentScrollY);
      }

      // 실제 작동 상태에 따른 1:1 정밀 팝업 (혼선 원천 방지)
      if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
        if (isModifiedInNotion) {
          App.showToast(`[${shortTitle}] 노션 최신 수정본으로 실시간 갱신되었습니다!`);
        } else {
          App.showToast(`[${shortTitle}] 이미 최신 상태입니다. (노션에 추가 변경사항 없음)`);
        }
      }
    } catch (err) {
      console.error('[Reader] 실시간 동기화 오류:', err);
      if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
        App.showToast(`실시간 동기화 실패: ${err.message}`);
      }
    } finally {
      this._isRefreshingCurrent = false;
      if (refreshBtn) {
        refreshBtn.disabled = false;
        if (refreshBtn.classList) {
          refreshBtn.classList.remove('spinning');
          refreshBtn.classList.remove('is-loading');
        }
      }
      if (headerRefreshBtn) {
        headerRefreshBtn.disabled = false;
        if (headerRefreshBtn.classList) {
          headerRefreshBtn.classList.remove('spinning');
          headerRefreshBtn.classList.remove('is-loading');
        }
      }
    }
  },

  render(doc, options = {}) {
    const container = (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById('reader-content')
      : null;
    if (!container) return;

    this.headingsList = [];
    this.headingCounter = 0;
    this.mermaidCounter = 0;
    this._mermaidSources = {};

    const lastDate = doc.lastReviewedAt ? new Date(doc.lastReviewedAt).toLocaleDateString() : '기록 없음';
    const cacheStatus = (options && options.cacheStatus) ? options.cacheStatus : null;

    let cacheBannerHtml = '';
    if (cacheStatus === 'outdated') {
      cacheBannerHtml = `
        <div class="reader-cache-banner banner-outdated">
          <span><span class="status-dot dot-warn" style="margin-right: 6px;" aria-hidden="true"></span>로컬 캐시본 열람 중 (노션에 최신 수정본이 있습니다)</span>
          <button class="btn btn-sm" onclick="Reader.refreshCurrentDoc()">최신본 동기화</button>
        </div>
      `;
    } else if (cacheStatus === 'offline') {
      const refRaw = doc.cachedAt || doc.updatedAt;
      const refDateObj = refRaw ? new Date(refRaw) : null;
      const refDateStr = (refDateObj && !isNaN(refDateObj.getTime())) ? refDateObj.toLocaleDateString() : '로컬 저장소';
      cacheBannerHtml = `
        <div class="reader-cache-banner banner-offline">
          <span>오프라인 저장본 열람 중 (기준: ${this.escapeHtml(refDateStr)})</span>
        </div>
      `;
    }

    const refreshSvg = '<svg class="zen-svg icon-spin-target" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';

    let html = `
      <div class="reader-header">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px;">
          <button class="btn btn-icon" onclick="Reader.goBack()" title="서재 목록으로 돌아가기">← 서재</button>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <button id="btn-reader-pinpoint-refresh" class="btn btn-icon" onclick="Reader.refreshCurrentDoc()" title="노션 실시간 최신 내용 새로고침">
              ${refreshSvg}
              <span style="font-size: 0.76rem; font-weight: 600;">갱신</span>
            </button>
            <span id="header-timer-display" style="font-size: 0.82rem; color: var(--text-muted); font-family: var(--font-family-mono);">00:00</span>
            <button id="top-checkin-btn" class="btn btn-primary" style="font-size: 0.78rem; padding: 4px 10px;" onclick="Reader.toggleDockFeedbackPicker()">
              1회독 완료
            </button>
          </div>
        </div>
        <h1 class="reader-title">${this.escapeHtml(doc.title)}</h1>
        <div class="reader-meta-bar">
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
            ${(doc.tags || []).map(t => `<span class="doc-tag">#${this.escapeHtml(t)}</span>`).join(' ')}
            <span style="font-size: 0.78rem; color: var(--text-muted); margin-left: 4px;">최근 복습: <strong>${lastDate}</strong></span>
          </div>
          <div id="reader-review-badge" class="doc-review-badge">
            누적 ${doc.reviewCount || 0}회독
          </div>
        </div>
        ${cacheBannerHtml}
      </div>
      <div class="reader-body">
    `;

    // 블록 렌더링
    if (doc.blocks && doc.blocks.length > 0) {
      html += this.renderBlocks(doc.blocks);
    } else {
      html += '<p style="color: var(--text-muted); padding: 40px 0; text-align: center;">본문 내용이 비어 있습니다.</p>';
    }

    // 문서 맨 아래 3단계 피드백 스터디 완료 카드
    html += `
      </div>
      <div class="study-completion-card">
        <h3 style="margin-bottom: 4px; font-size: 1.08rem; font-weight: 700;">이 문서 학습을 마치셨나요?</h3>
        <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.55; margin-bottom: 14px;">
          집중 시간 <strong id="timer-display" style="color: var(--accent); font-family: var(--font-family-mono);">00:00</strong> · 기억 체감도를 선택하면 다음 복습 주기가 자동 계산됩니다.
        </p>
        
        <div class="feedback-buttons-row">
          <button id="fb-btn-easy" class="btn btn-feedback btn-feedback-easy" onclick="Reader.triggerManualCheckin('easy')">
            <span class="fb-dot dot-easy" aria-hidden="true"></span><span>수월함 · 주기 연장</span>
          </button>
          <button id="fb-btn-good" class="btn btn-feedback btn-feedback-good" onclick="Reader.triggerManualCheckin('good')">
            <span class="fb-dot dot-good" aria-hidden="true"></span><span>적정 · 권장 주기</span>
          </button>
          <button id="fb-btn-hard" class="btn btn-feedback btn-feedback-hard" onclick="Reader.triggerManualCheckin('hard')">
            <span class="fb-dot dot-hard" aria-hidden="true"></span><span>헷갈림 · 내일 다시</span>
          </button>
        </div>
        <div id="study-checkin-status" class="study-checkin-status" style="display: none;"></div>
      </div>
    `;

    container.innerHTML = html;
    this.updateTimerDisplay();
    if (this.hasLoggedStudy && this.currentFeedback) {
      this.renderCompletionCardState();
    }
    this.renderMermaidDiagrams();
  },

  renderBlocks(blocks) {
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return '';
    let out = '';
    let i = 0;

    while (i < blocks.length) {
      const b = blocks[i];
      const contentHtml = b.html || this.escapeHtml(b.text || '');

      // 1. 연속된 불렛 리스트 그룹핑 및 하위 블록(children) 재귀 렌더링
      if (b.type === 'bulleted_list_item') {
        out += '<ul class="zen-list">';
        while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
          const item = blocks[i];
          const itemHtml = item.html || this.escapeHtml(item.text || '');
          out += `<li><div>${itemHtml}</div>`;
          if (item.children && item.children.length > 0) {
            out += this.renderBlocks(item.children);
          }
          out += `</li>`;
          i++;
        }
        out += '</ul>';
        continue;
      }

      // 2. 연속된 번호 매김 리스트 그룹핑 및 하위 블록(children) 재귀 렌더링
      if (b.type === 'numbered_list_item') {
        out += '<ol class="zen-numbered-list">';
        while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
          const item = blocks[i];
          const itemHtml = item.html || this.escapeHtml(item.text || '');
          out += `<li><div>${itemHtml}</div>`;
          if (item.children && item.children.length > 0) {
            out += this.renderBlocks(item.children);
          }
          out += `</li>`;
          i++;
        }
        out += '</ol>';
        continue;
      }

      // 3. 개별 블록 렌더링
      switch (b.type) {
        case 'heading_1':
        case 'heading_2':
        case 'heading_3':
        case 'heading_4':
          const hTag = b.type === 'heading_1' ? 'h1' : (b.type === 'heading_2' ? 'h2' : (b.type === 'heading_3' ? 'h3' : 'h4'));
          const headingIdx = ++this.headingCounter;
          const headingId = `zen-heading-${headingIdx}`;
          const plainHeadingText = (b.text || '').trim();
          if (plainHeadingText && hTag !== 'h4') {
            this.headingsList.push({
              id: headingId,
              text: plainHeadingText,
              tag: hTag
            });
          }

          if (b.isToggleable && b.children && b.children.length > 0) {
            out += `
              <details class="zen-toggle zen-heading-toggle">
                <summary><${hTag} id="${headingId}" style="display: inline; margin: 0;">${contentHtml}</${hTag}></summary>
                <div class="zen-toggle-content">
                  ${this.renderBlocks(b.children)}
                </div>
              </details>
            `;
          } else {
            out += `<${hTag} id="${headingId}">${contentHtml}</${hTag}>`;
            if (b.children && b.children.length > 0) {
              out += this.renderBlocks(b.children);
            }
          }
          break;

        case 'code': {
          const codeText = b.code || b.text || '';
          const langRaw = (b.language || 'plain text').trim();
          const langLower = langRaw.toLowerCase();

          if (langLower === 'mermaid') {
            const mermaidIdx = ++this.mermaidCounter;
            const diagramId = `zen-mermaid-${mermaidIdx}`;
            this._mermaidSources[diagramId] = codeText;
            const firstLine = (codeText.split(/\r?\n/)[0] || '').trim().replace(/\s+/g, ' ');
            const diagramTypeHint = firstLine.length <= 28 ? firstLine.toUpperCase() : 'MERMAID';

            out += `
              <div class="zen-mermaid-card is-fit" id="${diagramId}-card" data-diagram-id="${diagramId}">
                <div class="zen-mermaid-header">
                  <div class="zen-mermaid-label">
                    <span class="zen-mermaid-dot" aria-hidden="true"></span>
                    <span>알고리즘 다이어그램</span>
                    <span class="zen-mermaid-type">${this.escapeHtml(diagramTypeHint)}</span>
                  </div>
                  <div class="zen-mermaid-actions">
                    <div class="zen-mermaid-zoom-group" id="${diagramId}-zoom-group" style="display: none;">
                      <button type="button" class="zen-mermaid-btn" onclick="Reader.zoomMermaidCard('${diagramId}', -0.25)" aria-label="축소">－</button>
                      <span id="${diagramId}-scale-label" class="zen-mermaid-scale-badge">100%</span>
                      <button type="button" class="zen-mermaid-btn" onclick="Reader.zoomMermaidCard('${diagramId}', 0.25)" aria-label="확대">＋</button>
                    </div>
                    <button type="button" id="${diagramId}-fit-btn" class="zen-mermaid-btn" onclick="Reader.toggleMermaidFit('${diagramId}', this)">둘러보기</button>
                    <button type="button" class="zen-mermaid-btn" onclick="Reader.openMermaidModal('${diagramId}', { rotated: true })" title="다이어그램 뷰어만 가로 90도 회전">가로</button>
                    <button type="button" class="zen-mermaid-btn" onclick="Reader.toggleMermaidSource('${diagramId}', this)">원본 코드</button>
                    <button type="button" class="zen-mermaid-btn zen-mermaid-btn-primary" onclick="Reader.openMermaidModal('${diagramId}')">확대</button>
                  </div>
                </div>
                <div id="${diagramId}-viewport" class="zen-mermaid-viewport" onclick="Reader.handleMermaidViewportClick('${diagramId}')">
                  <div id="${diagramId}-stage" class="zen-mermaid-stage">
                    <div id="${diagramId}-render" class="zen-mermaid-render" data-mermaid-id="${diagramId}">
                      <div class="zen-mermaid-loading">다이어그램을 불러오는 중...</div>
                    </div>
                  </div>
                  <div id="${diagramId}-hint" class="zen-mermaid-hint">핀치·둘러보기: 터치 이동 | 탭: 전체 확대</div>
                </div>
                <pre id="${diagramId}-source" class="zen-code-block zen-mermaid-source" style="display: none;"><code>${this.highlightCode(codeText, 'mermaid')}</code></pre>
              </div>
            `;
            break;
          }

          const langBadge = (langRaw && langLower !== 'plain text')
            ? `<div class="zen-code-lang">${this.escapeHtml(langRaw)}</div>`
            : '';
          out += `
            <div class="zen-code-wrapper">
              ${langBadge}
              <pre class="zen-code-block zen-code-highlighted"><code>${this.highlightCode(codeText, langRaw)}</code></pre>
            </div>
          `;
          break;
        }

        case 'divider':
          out += `<hr class="zen-divider">`;
          break;

        case 'paragraph':
          if (contentHtml) {
            out += `<p>${contentHtml}</p>`;
          }
          if (b.children && b.children.length > 0) {
            out += `<div class="zen-indented-block">${this.renderBlocks(b.children)}</div>`;
          }
          break;

        case 'callout': {
          const calloutColorClass = (b.color && b.color !== 'default') ? ` notion-callout-${b.color}` : '';
          out += `
            <div class="zen-callout${calloutColorClass}">
              <span class="zen-callout-icon">${b.icon || '📌'}</span>
              <div class="zen-callout-content" style="flex: 1; min-width: 0;">
                ${contentHtml ? `<div class="zen-callout-title">${contentHtml}</div>` : ''}
                ${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}
              </div>
            </div>
          `;
          break;
        }

        case 'quote':
          out += `
            <blockquote class="zen-quote">
              <div>${contentHtml}</div>
              ${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}
            </blockquote>
          `;
          break;

        case 'toggle':
          const summaryHtml = b.summaryHtml || this.escapeHtml(b.summary || b.text || '셀프 테스트 (열기/닫기)');
          out += `
            <details class="zen-toggle">
              <summary>${summaryHtml}</summary>
              <div class="zen-toggle-content">
                ${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : `<p>${contentHtml}</p>`}
              </div>
            </details>
          `;
          break;

        case 'table':
          const rows = b.children || [];
          if (rows.length === 0) {
            out += '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">(빈 표)</div>';
            break;
          }
          const hasColHeader = b.hasColumnHeader;
          out += '<div class="zen-table-wrapper"><table class="zen-table"><tbody>';
          rows.forEach((row, rowIndex) => {
            const isHeader = hasColHeader && rowIndex === 0;
            out += '<tr>';
            (row.cells || []).forEach(cell => {
              const cellHtml = cell.html || this.escapeHtml(cell.text || '');
              if (isHeader) {
                out += `<th>${cellHtml}</th>`;
              } else {
                out += `<td>${cellHtml}</td>`;
              }
            });
            out += '</tr>';
          });
          out += '</tbody></table></div>';
          break;

        case 'to_do':
          out += `
            <div class="zen-todo-item" style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
              <input type="checkbox" ${b.checked ? 'checked' : ''} style="width: 18px; height: 18px; margin-top: 3px; accent-color: var(--accent);">
              <div style="flex: 1;">${contentHtml}</div>
            </div>
          `;
          if (b.children && b.children.length > 0) {
            out += `<div class="zen-indented-block">${this.renderBlocks(b.children)}</div>`;
          }
          break;

        case 'image':
          if (b.imageUrl) {
            out += `
              <div style="margin: 20px 0; text-align: center;">
                <img src="${b.imageUrl}" alt="노션 이미지" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--border-color);" loading="lazy">
              </div>
            `;
          }
          break;

        case 'column_list':
          out += `<div class="zen-columns">${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}</div>`;
          break;

        case 'column':
          out += `<div class="zen-column">${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}</div>`;
          break;

        case 'synced_block':
          if (b.children && b.children.length > 0) {
            out += this.renderBlocks(b.children);
          }
          break;

        default:
          if (contentHtml) {
            out += `<p>${contentHtml}</p>`;
          }
          if (b.children && b.children.length > 0) {
            out += this.renderBlocks(b.children);
          }
          break;
      }

      i++;
    }

    return out;
  },

  // 스마트 스크롤: 헤더 자동 숨김 & 앰비언트 진행률 바 & 마이크로 목차 스크롤 스파이
  setupSmartScroll() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    this.lastScrollY = window.scrollY || 0;
    const header = document.querySelector ? document.querySelector('.zen-header') : null;
    const progressBar = document.getElementById ? document.getElementById('reading-progress-bar') : null;

    window.onscroll = () => {
      const currentY = window.scrollY;
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = totalHeight > 0 ? (currentY / totalHeight) * 100 : 0;

      // 1) 2px 앰비언트 프로그레스 라인 업데이트
      if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;

      // 2) 스마트 헤더 Auto-hide & Reveal
      if (Math.abs(currentY - this.lastScrollY) > this.scrollThreshold) {
        if (currentY > this.lastScrollY && currentY > 80) {
          header?.classList.add('header-hidden');
        } else {
          header?.classList.remove('header-hidden');
        }
        this.lastScrollY = currentY;
      }

      // 3) 마이크로 목차 레일 스크롤 스파이 & 사용 시 선명 / 미사용 시 반투명 전환
      if (this.headingsList && this.headingsList.length >= 2) {
        this.wakeTocRail(1600);
        if (!this._isScrubbingToc) {
          const scrollThreshold = currentY + 140;
          let activeIdx = 0;
          for (let i = 0; i < this.headingsList.length; i++) {
            const el = document.getElementById(this.headingsList[i].id);
            if (el && el.getBoundingClientRect().top + window.scrollY <= scrollThreshold) {
              activeIdx = i;
            }
          }
          const dots = document.querySelectorAll('#zen-toc-rail .zen-toc-dot');
          dots.forEach((dot, idx) => {
            if (idx === activeIdx) dot.classList.add('active');
            else dot.classList.remove('active');
          });
        }
      }
    };
  },

  wakeTocRail(autoSleepMs = 1600) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const rail = document.getElementById('zen-toc-rail');
    if (!rail) return;

    rail.classList.remove('is-idle');
    rail.classList.add('is-active');

    if (this._tocIdleTimer) clearTimeout(this._tocIdleTimer);
    if (this._isScrubbingToc || autoSleepMs <= 0) return;

    this._tocIdleTimer = setTimeout(() => {
      if (this._isScrubbingToc) return;
      const r = document.getElementById('zen-toc-rail');
      if (r) {
        r.classList.remove('is-active');
        r.classList.add('is-idle');
      }
    }, autoSleepMs);
  },

  scrubTocToClientY(clientY, scrollBehavior = 'auto') {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const rail = document.getElementById('zen-toc-rail');
    if (!rail) return;
    const dots = Array.from(rail.querySelectorAll('.zen-toc-dot'));
    if (dots.length === 0) return;

    let closestIdx = 0;
    let minDist = Infinity;
    dots.forEach((dot, idx) => {
      const rect = dot.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - centerY);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });

    dots.forEach((dot, idx) => {
      if (idx === closestIdx) dot.classList.add('active', 'scrubbing');
      else dot.classList.remove('active', 'scrubbing');
    });

    const heading = this.headingsList[closestIdx];
    const pill = document.getElementById('zen-toc-scrub-pill');
    if (pill && heading) {
      const railRect = rail.getBoundingClientRect();
      const dotRect = dots[closestIdx].getBoundingClientRect();
      const offsetY = Math.max(12, Math.min(railRect.height - 12, (dotRect.top + dotRect.height / 2) - railRect.top));
      pill.textContent = `${closestIdx + 1}/${dots.length} · ${heading.text}`;
      pill.style.top = `${offsetY}px`;
      pill.classList.add('visible');
    }

    if (heading && typeof window !== 'undefined') {
      const target = document.getElementById(heading.id);
      if (target && typeof target.getBoundingClientRect === 'function') {
        const headerOffset = 68;
        const targetY = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerOffset);
        window.scrollTo({ top: targetY, behavior: scrollBehavior });
      } else if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
      }
    }
  },

  // 긴 임상 매뉴얼용 마이크로 목차 레일 렌더링 (헤딩 2개 이상일 때만 노출 + 터치 패스트 스크롤)
  renderTocRail() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const existing = document.getElementById('zen-toc-rail');
    if (existing && existing.remove) existing.remove();
    if (this._tocIdleTimer) clearTimeout(this._tocIdleTimer);
    if (this._tocPillTimer) clearTimeout(this._tocPillTimer);

    if (!this.headingsList || this.headingsList.length < 2) return;
    if (typeof document.createElement !== 'function' || !document.body || typeof document.body.appendChild !== 'function') return;

    const rail = document.createElement('div');
    rail.id = 'zen-toc-rail';
    rail.className = 'zen-toc-rail is-active';

    const scrubPill = document.createElement('div');
    scrubPill.id = 'zen-toc-scrub-pill';
    scrubPill.className = 'zen-toc-scrub-pill';
    rail.appendChild(scrubPill);

    this.headingsList.forEach((h, idx) => {
      const dot = document.createElement('div');
      dot.className = `zen-toc-dot dot-${h.tag} ${idx === 0 ? 'active' : ''}`;
      dot.dataset.targetId = h.id;
      dot.title = h.text;
      rail.appendChild(dot);
    });

    const endScrub = (delayHidePillMs = 950) => {
      if (!this._isScrubbingToc) return;
      this._isScrubbingToc = false;
      rail.querySelectorAll('.zen-toc-dot.scrubbing').forEach((d) => d.classList.remove('scrubbing'));
      if (this._tocPillTimer) clearTimeout(this._tocPillTimer);
      this._tocPillTimer = setTimeout(() => {
        const p = document.getElementById('zen-toc-scrub-pill');
        if (p) p.classList.remove('visible');
      }, delayHidePillMs);
      this.wakeTocRail(1600);
    };

    // 터치 패스트 스크롤 (누른 채 위아래로 드래그 시 실시간 섹션 이동)
    rail.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      this._isScrubbingToc = true;
      if (this._tocPillTimer) clearTimeout(this._tocPillTimer);
      this.wakeTocRail(0);
      this.scrubTocToClientY(e.touches[0].clientY, 'smooth');
    }, { passive: false });

    rail.addEventListener('touchmove', (e) => {
      if (!this._isScrubbingToc || !e.touches || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      this.scrubTocToClientY(e.touches[0].clientY, 'auto');
    }, { passive: false });

    rail.addEventListener('touchend', (e) => {
      e.stopPropagation();
      endScrub(950);
    });
    rail.addEventListener('touchcancel', () => endScrub(300));

    // 데스크탑/마우스 드래그 및 호버 지원
    let mouseDragging = false;
    rail.addEventListener('mouseenter', () => this.wakeTocRail(0));
    rail.addEventListener('mouseleave', () => {
      if (!mouseDragging && !this._isScrubbingToc) {
        this.wakeTocRail(900);
      }
    });
    rail.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      mouseDragging = true;
      this._isScrubbingToc = true;
      if (this._tocPillTimer) clearTimeout(this._tocPillTimer);
      this.wakeTocRail(0);
      this.scrubTocToClientY(e.clientY, 'smooth');
    });

    const onDocMouseMove = (e) => {
      if (!mouseDragging) return;
      this.scrubTocToClientY(e.clientY, 'auto');
    };
    const onDocMouseUp = () => {
      if (!mouseDragging) return;
      mouseDragging = false;
      endScrub(950);
    };
    if (this._tocDocMouseMove) document.removeEventListener('mousemove', this._tocDocMouseMove);
    if (this._tocDocMouseUp) document.removeEventListener('mouseup', this._tocDocMouseUp);
    this._tocDocMouseMove = onDocMouseMove;
    this._tocDocMouseUp = onDocMouseUp;
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);

    document.body.appendChild(rail);
    // 첫 노출 후 조작이 없으면 2.2초 뒤 은은하게 반투명으로 전환
    this.wakeTocRail(2200);
  },

  // 인앱 가장자리 스와이프 뒤로가기 제스처 (좌측 및 우측 베젤 스와이프 지원)
  setupSwipeToBack() {
    if (this.swipeHandlerAttached) return;

    this.handleTouchStart = (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const tgt = e.target;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('#zen-toc-rail, .zen-mermaid-card.is-explore, #mermaid-zoom-modal')) {
        this._suppressSwipeBack = true;
        return;
      }
      this._suppressSwipeBack = false;
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartTime = Date.now();
    };

    this.handleTouchEnd = (e) => {
      if (this._suppressSwipeBack) {
        this._suppressSwipeBack = false;
        return;
      }
      if (!e.changedTouches || e.changedTouches.length !== 1) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - this.touchStartX;
      const deltaY = endY - this.touchStartY;
      const elapsed = Date.now() - this.touchStartTime;

      if (elapsed > 550) return; // 너무 느린 드래그 제외

      const winWidth = window.innerWidth;
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.5;

      // 1) 좌측 가장자리에서 오른쪽으로 스와이프 (표준 뒤로가기)
      const isLeftEdgeSwipe = this.touchStartX < 50 && deltaX > 75;

      // 2) 우측 가장자리에서 왼쪽으로 스와이프 (사용자가 설정한 태블릿 우측 제스처)
      const isRightEdgeSwipe = this.touchStartX > (winWidth - 50) && deltaX < -75;

      if (isHorizontal && (isLeftEdgeSwipe || isRightEdgeSwipe)) {
        this.goBack();
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('touchstart', this.handleTouchStart, { passive: true });
      window.addEventListener('touchend', this.handleTouchEnd, { passive: true });
      this.swipeHandlerAttached = true;
    }
  },

  removeSwipeToBack() {
    if (this.swipeHandlerAttached) {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('touchstart', this.handleTouchStart);
        window.removeEventListener('touchend', this.handleTouchEnd);
      }
      this.swipeHandlerAttached = false;
    }
  },

  getFeedbackMeta(feedback) {
    const map = {
      easy: {
        key: 'easy',
        dotClass: 'dot-easy',
        label: '수월함',
        statusText: '수월함 · 장기 복습 주기 반영'
      },
      good: {
        key: 'good',
        dotClass: 'dot-good',
        label: '적정',
        statusText: '적정 · 권장 주기 반영'
      },
      hard: {
        key: 'hard',
        dotClass: 'dot-hard',
        label: '헷갈림',
        statusText: '헷갈림 · 내일 재복습 반영'
      }
    };
    return map[feedback] || map.good;
  },

  resetDockCheckinButton() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const dockCheckinBtn = document.getElementById('dock-checkin-btn');
    if (dockCheckinBtn) {
      dockCheckinBtn.disabled = false;
      if (dockCheckinBtn.style) dockCheckinBtn.style.opacity = '';
      if (dockCheckinBtn.classList && typeof dockCheckinBtn.classList.remove === 'function') {
        dockCheckinBtn.classList.remove('completed');
      }
      dockCheckinBtn.innerHTML = '<svg class="zen-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span class="dock-label">완료</span>';
    }
  },

  toggleDockFeedbackPicker(forceState) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const popover = document.getElementById('zen-dock-feedback-popover');
    if (!popover) return;

    const nextState = typeof forceState === 'boolean' ? forceState : !this.isDockFeedbackOpen;
    this.isDockFeedbackOpen = nextState;

    const titleEl = document.getElementById('dock-feedback-popover-title');
    if (titleEl) {
      titleEl.innerText = this.hasLoggedStudy ? '기억 체감도 변경 (실수 정정)' : '기억 체감도 선택';
    }

    ['easy', 'good', 'hard'].forEach(key => {
      const dockOpt = document.getElementById(`dock-fb-${key}`);
      if (dockOpt && dockOpt.classList) {
        if (this.currentFeedback === key) dockOpt.classList.add('active');
        else dockOpt.classList.remove('active');
      }
    });

    if (nextState) {
      if (popover.style) popover.style.display = 'block';
      if (popover.classList && typeof popover.classList.add === 'function') popover.classList.add('visible');
    } else {
      if (popover.classList && typeof popover.classList.remove === 'function') popover.classList.remove('visible');
      if (popover.style) popover.style.display = 'none';
    }
  },

  closeDockFeedbackPicker() {
    this.toggleDockFeedbackPicker(false);
  },

  async selectFeedbackFromDock(feedback = 'good') {
    this.closeDockFeedbackPicker();
    await this.triggerManualCheckin(feedback);
  },

  // 수동 체크인 버튼 클릭 시 (초회 기록 또는 동일 세션 내 체감 난이도 변경)
  async triggerManualCheckin(feedback = 'good') {
    if (this.hasLoggedStudy) {
      await this.updateFeedback(feedback);
      return;
    }
    await this.executeCheckin(feedback);
  },

  // 동일 세션 내 기억 체감도 수정 (회독수 중복 증가 및 중복 로그 생성 차단)
  async updateFeedback(newFeedback) {
    if (!this.hasLoggedStudy || !this.currentDoc) return;
    if (!['easy', 'good', 'hard'].includes(newFeedback)) return;

    const meta = this.getFeedbackMeta(newFeedback);
    if (this.currentFeedback === newFeedback) {
      if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
        App.showToast(`이미 '${meta.label}'으로 기록되어 있습니다.`);
      }
      return;
    }

    this.currentFeedback = newFeedback;

    if (typeof ZenStorage !== 'undefined' && typeof ZenStorage.updateLogFeedback === 'function') {
      try {
        await ZenStorage.updateLogFeedback({
          id: this.currentLogId,
          clientLogId: this.currentClientLogId,
          docId: this.currentDoc.id
        }, newFeedback);
      } catch (err) {
        console.warn('[Reader] IndexedDB 피드백 수정 실패:', err);
      }
    }

    if (typeof OfflineManager !== 'undefined' && typeof OfflineManager.updateStudyLogFeedback === 'function') {
      OfflineManager.updateStudyLogFeedback({
        id: this.currentLogId,
        clientLogId: this.currentClientLogId,
        docId: this.currentDoc.id,
        feedback: newFeedback
      }).catch(() => {});
    }

    this.renderCompletionCardState();

    if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
      App.showToast(`기억 체감도를 '${meta.label}'(으)로 변경했습니다.`);
    }
  },

  renderCompletionCardState() {
    if (!this.currentDoc) return;
    const count = this.currentDoc.reviewCount || 1;
    const meta = this.getFeedbackMeta(this.currentFeedback || 'good');

    if (typeof document === 'undefined' || !document.getElementById) return;

    const badge = document.getElementById('reader-review-badge');
    if (badge) {
      badge.innerHTML = `누적 ${count}회독 · 완료`;
    }

    const topBtn = document.getElementById('top-checkin-btn');
    if (topBtn) {
      topBtn.innerText = `${count}회독 (${meta.label})`;
      topBtn.disabled = false;
    }

    const dockCheckinBtn = document.getElementById('dock-checkin-btn');
    if (dockCheckinBtn) {
      dockCheckinBtn.innerHTML = `<span class="fb-dot ${meta.dotClass}" aria-hidden="true"></span><span class="dock-label">${meta.label}</span>`;
      dockCheckinBtn.disabled = false;
      if (dockCheckinBtn.style) dockCheckinBtn.style.opacity = '';
      if (dockCheckinBtn.classList && typeof dockCheckinBtn.classList.add === 'function') {
        dockCheckinBtn.classList.add('completed');
      }
    }

    ['easy', 'good', 'hard'].forEach(key => {
      const btn = document.getElementById(`fb-btn-${key}`);
      if (btn && btn.classList) {
        if (this.currentFeedback === key) btn.classList.add('active');
        else btn.classList.remove('active');
      }
      const dockOpt = document.getElementById(`dock-fb-${key}`);
      if (dockOpt && dockOpt.classList) {
        if (this.currentFeedback === key) dockOpt.classList.add('active');
        else dockOpt.classList.remove('active');
      }
    });

    const statusBox = document.getElementById('study-checkin-status');
    if (statusBox) {
      if (statusBox.style) statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="checkin-status-main">${count}회독 체크인 완료 · ${meta.statusText}</div>
        <div class="checkin-status-hint">잘못 누르셨다면 위 버튼이나 하단 독에서 바로 변경할 수 있습니다.</div>
      `;
    }
  },

  // 실제 체크인 실행 (IndexedDB 영구 저장 및 서버 비동기 전송)
  async executeCheckin(feedback = 'good') {
    if (this.hasLoggedStudy || !this.currentDoc) return;
    this.hasLoggedStudy = true;
    this.currentFeedback = feedback;

    const newCount = (this.currentDoc.reviewCount || 0) + 1;
    this.currentDoc.reviewCount = newCount;

    // 서재 목록 인메모리 캐시 즉시 0ms 동기화 (뒤로가기 시 즉각 반영)
    if (typeof App !== 'undefined' && Array.isArray(App.documents)) {
      const target = App.documents.find(d => d.id === this.currentDoc.id);
      if (target) {
        target.reviewCount = newCount;
        target.lastReviewedAt = new Date().toISOString();
      }
    }

    const clientLogId = 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    this.currentClientLogId = clientLogId;

    const payload = {
      id: clientLogId,
      clientLogId: clientLogId,
      docId: this.currentDoc.id,
      docTitle: this.currentDoc.title,
      durationSeconds: Math.max(10, this.durationSeconds),
      reviewCount: newCount,
      feedback: feedback, // 'easy' | 'good' | 'hard'
      device: "alldocube-iplay60"
    };

    // 1. 태블릿 로컬 IndexedDB에 최우선 영구 저장
    if (typeof ZenStorage !== 'undefined') {
      try {
        const savedLog = await ZenStorage.saveLog(payload);
        this.currentLogId = (savedLog && savedLog.id) || null;
      } catch (err) {
        console.warn('[Reader] IndexedDB 저장 실패:', err);
      }
    }

    // 2. 오프라인 큐 및 서버 전송 (실패해도 로컬 저장은 보장)
    if (typeof OfflineManager !== 'undefined' && OfflineManager.sendStudyLog) {
      OfflineManager.sendStudyLog(payload).catch(() => {});
    }

    // 화면 UI 업데이트 (모든 피드백 버튼 유지 + 선택 상태 하이라이트)
    this.renderCompletionCardState();

    if (typeof App !== 'undefined' && typeof App.showToast === 'function') {
      const meta = this.getFeedbackMeta(feedback);
      App.showToast(`1회독 기록 완료 (${newCount}회독 · ${meta.label})`);
    }
  },

  cleanup() {
    this._openSeq++;
    if (this.readingTimer) clearInterval(this.readingTimer);
    if (this._tocIdleTimer) clearTimeout(this._tocIdleTimer);
    if (this._tocPillTimer) clearTimeout(this._tocPillTimer);
    if (typeof document !== 'undefined') {
      if (this._tocDocMouseMove) document.removeEventListener('mousemove', this._tocDocMouseMove);
      if (this._tocDocMouseUp) document.removeEventListener('mouseup', this._tocDocMouseUp);
    }
    this._tocDocMouseMove = null;
    this._tocDocMouseUp = null;
    this._isScrubbingToc = false;
    window.onscroll = null;
    this.removeSwipeToBack();
    this.closeDockFeedbackPicker();
    this.closeMermaidModal();
    this._panZoomStates = {};
    const rail = document.getElementById('zen-toc-rail');
    if (rail && rail.remove) rail.remove();
    const header = document.querySelector('.zen-header');
    if (header) header.classList.remove('header-hidden');
    const bar = document.getElementById('reading-progress-bar');
    if (bar) bar.style.width = '0%';
    this.showFloatingDock(false);
  },

  // XSS 안전한 단일 패스 코드/마크다운/Mermaid 구문 강조 토크나이저
  highlightCode(rawCode, language) {
    if (!rawCode) return '';
    const lang = (language || 'plain text').trim().toLowerCase();

    let tokenSpec;
    if (lang === 'markdown' || lang === 'md') {
      tokenSpec = [
        { cls: 'tok-heading', re: /^[ \t]{0,3}#{1,6}[ \t]+[^\n]*/m },
        { cls: 'tok-quote', re: /^[ \t]{0,3}>[^\n]*/m },
        { cls: 'tok-str', re: /`[^`\n]+`/ },
        { cls: 'tok-kw', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
        { cls: 'tok-link', re: /\[[^\]]+\]\([^)]+\)/ },
        { cls: 'tok-list', re: /^[ \t]*(?:[-*+]|\d+\.)(?=[ \t])/m },
        { cls: 'tok-op', re: /-->|-.->|==>|->|=>|>=|<=/ },
        { cls: 'tok-num', re: /\b\d+(?:\.\d+)?%?\b/ }
      ];
    } else if (lang === 'mermaid') {
      tokenSpec = [
        { cls: 'tok-comment', re: /%%[^\n]*/ },
        { cls: 'tok-str', re: /"(?:[^"\\]|\\.)*"/ },
        { cls: 'tok-kw', re: /\b(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|subgraph|end|direction|classDef|class|style|linkStyle|click|participant|actor|Note|loop|alt|else|opt|TD|TB|LR|RL|BT)\b/ },
        { cls: 'tok-op', re: /-->|-.->|==>|---|\|\s*|\|/ },
        { cls: 'tok-node', re: /\b[A-Za-z_][A-Za-z0-9_-]*(?=\s*[\[({]|\s*(?:-->|-.->|==>|---))/ },
        { cls: 'tok-delim', re: /[\[\](){}]/ },
        { cls: 'tok-num', re: />=|<=|\b\d+(?:\.\d+)?%?\b/ }
      ];
    } else {
      tokenSpec = [
        { cls: 'tok-comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/ },
        { cls: 'tok-str', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/ },
        { cls: 'tok-kw', re: /\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|async|await|try|catch|throw|new|import|export|from|default|class|extends|def|elif|pass|with|as|lambda|SELECT|FROM|WHERE|JOIN|ON|GROUP|ORDER|BY|LIMIT|INSERT|UPDATE|DELETE|AND|OR|NOT|NULL|true|false|null|undefined|None|True|False)\b/ },
        { cls: 'tok-op', re: /===|!==|==|!=|>=|<=|=>|-->|->/ },
        { cls: 'tok-num', re: /\b\d+(?:\.\d+)?%?\b/ }
      ];
    }

    const combined = new RegExp(tokenSpec.map((t) => `(${t.re.source})`).join('|'), 'gm');
    let out = '';
    let lastIndex = 0;
    let match;

    while ((match = combined.exec(rawCode)) !== null) {
      if (match.index > lastIndex) {
        out += this.escapeHtml(rawCode.slice(lastIndex, match.index));
      }
      let matchedCls = '';
      for (let g = 0; g < tokenSpec.length; g++) {
        if (match[g + 1] !== undefined) {
          matchedCls = tokenSpec[g].cls;
          break;
        }
      }
      out += `<span class="${matchedCls}">${this.escapeHtml(match[0])}</span>`;
      lastIndex = combined.lastIndex;
      if (match[0].length === 0) {
        combined.lastIndex++;
      }
    }

    if (lastIndex < rawCode.length) {
      out += this.escapeHtml(rawCode.slice(lastIndex));
    }
    return out;
  },

  getActiveThemeClass() {
    if (typeof document === 'undefined' || !document.body) return 'theme-dark';
    const cl = document.body.classList;
    if (cl.contains('theme-light')) return 'theme-light';
    if (cl.contains('theme-sepia')) return 'theme-sepia';
    if (cl.contains('theme-green')) return 'theme-green';
    return 'theme-dark';
  },

  getMermaidThemeVars() {
    const theme = this.getActiveThemeClass();
    const base = {
      fontFamily: '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px'
    };

    if (theme === 'theme-light') {
      return Object.assign(base, {
        darkMode: false,
        background: '#ffffff',
        primaryColor: '#ffffff',
        primaryTextColor: '#1e293b',
        primaryBorderColor: '#0284c7',
        lineColor: '#475569',
        secondaryColor: '#f3eee6',
        secondaryTextColor: '#1e293b',
        secondaryBorderColor: '#94a3b8',
        tertiaryColor: '#ebe6dc',
        tertiaryTextColor: '#1e293b',
        tertiaryBorderColor: '#cbd5e1',
        edgeLabelBackground: '#f7f4ee',
        clusterBkg: '#f7f4ee',
        clusterBorder: '#cbd5e1'
      });
    }

    if (theme === 'theme-sepia') {
      return Object.assign(base, {
        darkMode: false,
        background: '#f9f2e4',
        primaryColor: '#fdf8ee',
        primaryTextColor: '#2d2417',
        primaryBorderColor: '#b45309',
        lineColor: '#785a3a',
        secondaryColor: '#efe4cc',
        secondaryTextColor: '#2d2417',
        secondaryBorderColor: '#a68b67',
        tertiaryColor: '#e6dbbf',
        tertiaryTextColor: '#2d2417',
        tertiaryBorderColor: '#c4b191',
        edgeLabelBackground: '#f2e8d5',
        clusterBkg: '#f2e8d5',
        clusterBorder: '#c4b191'
      });
    }

    if (theme === 'theme-green') {
      return Object.assign(base, {
        darkMode: false,
        background: '#f5faf0',
        primaryColor: '#fbfef9',
        primaryTextColor: '#19331e',
        primaryBorderColor: '#558b2f',
        lineColor: '#3b5c42',
        secondaryColor: '#e5f1dc',
        secondaryTextColor: '#19331e',
        secondaryBorderColor: '#7cb342',
        tertiaryColor: '#d9ebd0',
        tertiaryTextColor: '#19331e',
        tertiaryBorderColor: '#a3cca2',
        edgeLabelBackground: '#eef5e8',
        clusterBkg: '#eef5e8',
        clusterBorder: '#a3cca2'
      });
    }

    // theme-dark (기본값)
    return Object.assign(base, {
      darkMode: true,
      background: '#141923',
      primaryColor: '#172235',
      primaryTextColor: '#f1f5f9',
      primaryBorderColor: '#38bdf8',
      lineColor: '#7dd3fc',
      secondaryColor: '#1c2638',
      secondaryTextColor: '#e2e8f0',
      secondaryBorderColor: '#475569',
      tertiaryColor: '#0f172a',
      tertiaryTextColor: '#e2e8f0',
      tertiaryBorderColor: '#334155',
      edgeLabelBackground: '#141923',
      clusterBkg: '#0f172a',
      clusterBorder: '#334155'
    });
  },

  async renderMermaidDiagrams(forceRerender = false) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const targets = document.querySelectorAll('.zen-mermaid-render');
    if (!targets || targets.length === 0) return;

    if (typeof mermaid === 'undefined' || typeof mermaid.render !== 'function') {
      targets.forEach((el) => {
        const diagramId = el.dataset.mermaidId;
        const srcEl = diagramId ? document.getElementById(`${diagramId}-source`) : null;
        el.innerHTML = '<div class="zen-mermaid-error">다이어그램 엔진을 불러올 수 없어 원본 코드를 표시합니다.</div>';
        if (srcEl) srcEl.style.display = 'block';
      });
      return;
    }

    const themeKey = this.getActiveThemeClass();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: this.getMermaidThemeVars(),
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        nodeSpacing: 24,
        rankSpacing: 36,
        curve: 'basis',
        padding: 10
      }
    });

    for (const el of targets) {
      const diagramId = el.dataset.mermaidId;
      if (!diagramId) continue;
      if (!forceRerender && el.dataset.renderedTheme === themeKey && el.querySelector('svg')) {
        continue;
      }

      const srcEl = document.getElementById(`${diagramId}-source`);
      const source = this._mermaidSources[diagramId] || (srcEl ? srcEl.textContent : '');
      if (!source || !source.trim()) continue;

      try {
        const svgId = `zen-svg-${diagramId}-${++this._mermaidRenderPass}`;
        const result = await mermaid.render(svgId, source);
        el.innerHTML = result.svg;
        el.dataset.renderedTheme = themeKey;
        const svgNode = el.querySelector('svg');
        if (svgNode) {
          svgNode.style.maxWidth = 'none';
          svgNode.style.height = 'auto';
        }
        const viewportEl = document.getElementById(`${diagramId}-viewport`);
        const stageEl = document.getElementById(`${diagramId}-stage`);
        const labelEl = document.getElementById(`${diagramId}-scale-label`);
        const cardEl = document.getElementById(`${diagramId}-card`);
        if (viewportEl && stageEl && cardEl) {
          this.bindPanZoomSurface(diagramId, viewportEl, stageEl, {
            labelEl,
            isActiveFn: () => cardEl.classList.contains('is-explore'),
            onAutoEnterExplore: () => {
              if (!cardEl.classList.contains('is-explore')) {
                this.setMermaidCardExplore(diagramId, true, { skipCenter: true });
              }
            }
          });
        }
      } catch (err) {
        console.warn('[Reader] Mermaid 렌더링 실패:', diagramId, err);
        el.innerHTML = `<div class="zen-mermaid-error">다이어그램 구문 해석 중 오류가 발생해 원본 코드를 함께 표시합니다.</div>`;
        if (srcEl) srcEl.style.display = 'block';
      }
    }

    // 확대 모달이 열려 있는 동안 테마가 전환된 경우 모달 내용도 최신 SVG로 갱신
    const zoomModal = document.getElementById('mermaid-zoom-modal');
    if (zoomModal && zoomModal.style.display !== 'none' && this._mermaidModalDiagramId) {
      const activeRender = document.getElementById(`${this._mermaidModalDiagramId}-render`);
      const stage = document.getElementById('mermaid-zoom-stage');
      if (activeRender && stage) {
        stage.innerHTML = activeRender.innerHTML;
      }
    }
  },

  rerenderMermaidDiagrams() {
    return this.renderMermaidDiagrams(true);
  },

  // 카드 내 탐색('is-explore') 및 전체화면 모달 공용 2D 터치 드래그·핀치 줌·마우스 패닝 엔진
  bindPanZoomSurface(key, viewportEl, stageEl, options = {}) {
    if (!viewportEl || !stageEl) return null;
    if (!this._panZoomStates) this._panZoomStates = {};

    if (!this._panZoomStates[key]) {
      this._panZoomStates[key] = {
        key,
        scale: 1,
        panX: 0,
        panY: 0,
        minScale: 0.4,
        maxScale: 3.0,
        suppressClick: false
      };
    }

    const state = this._panZoomStates[key];
    state.viewportEl = viewportEl;
    state.stageEl = stageEl;
    state.labelEl = options.labelEl || null;
    state.isActiveFn = options.isActiveFn || (() => true);
    state.isRotatedFn = options.isRotatedFn || (() => false);
    state.onAutoEnterExplore = options.onAutoEnterExplore || null;

    if (viewportEl.dataset.panZoomBound === '1') {
      return state;
    }
    viewportEl.dataset.panZoomBound = '1';

    let mode = null; // 'touch-pan' | 'pinch' | 'mouse-pan'
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let startDist = 0;
    let startScale = 1;
    let startMidX = 0;
    let startMidY = 0;
    let movedDist = 0;

    const getTouchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const toLocalDelta = (dx, dy) => (state.isRotatedFn() ? { dx: dy, dy: -dx } : { dx, dy });
    const toLocalPoint = (clientX, clientY) => {
      const rect = viewportEl.getBoundingClientRect();
      if (state.isRotatedFn()) {
        return { x: clientY - rect.top, y: rect.right - clientX };
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    viewportEl.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;

      // 한눈에 보기('is-fit') 상태라도 두 손가락 핀치 시 즉시 카드 내 탐색 모드로 진입
      if (e.touches.length === 2) {
        if (!state.isActiveFn() && typeof state.onAutoEnterExplore === 'function') {
          state.onAutoEnterExplore();
        }
        if (!state.isActiveFn()) return;
        e.preventDefault();
        e.stopPropagation();
        mode = 'pinch';
        movedDist = 0;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const midLocal = toLocalPoint((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
        startDist = Math.max(10, getTouchDist(t1, t2));
        startScale = state.scale;
        startMidX = midLocal.x;
        startMidY = midLocal.y;
        startPanX = state.panX;
        startPanY = state.panY;
        viewportEl.classList.add('is-panning');
        return;
      }

      if (e.touches.length === 1 && state.isActiveFn()) {
        e.preventDefault();
        e.stopPropagation();
        mode = 'touch-pan';
        movedDist = 0;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startPanX = state.panX;
        startPanY = state.panY;
        viewportEl.classList.add('is-panning');
      }
    }, { passive: false });

    viewportEl.addEventListener('touchmove', (e) => {
      if (!mode || !state.isActiveFn()) return;

      if (mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        e.stopPropagation();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = getTouchDist(t1, t2);
        const midLocal = toLocalPoint((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
        const nextScale = Math.min(state.maxScale, Math.max(state.minScale, startScale * (dist / startDist)));
        const ratio = nextScale / startScale;
        state.scale = nextScale;
        state.panX = midLocal.x - (startMidX - startPanX) * ratio;
        state.panY = midLocal.y - (startMidY - startPanY) * ratio;
        movedDist = Math.max(movedDist, Math.abs(dist - startDist));
        this.applyPanZoom(state);
        return;
      }

      if (mode === 'touch-pan' && e.touches.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        const rawDx = e.touches[0].clientX - startX;
        const rawDy = e.touches[0].clientY - startY;
        const d = toLocalDelta(rawDx, rawDy);
        movedDist = Math.max(movedDist, Math.hypot(rawDx, rawDy));
        state.panX = startPanX + d.dx;
        state.panY = startPanY + d.dy;
        this.applyPanZoom(state);
      }
    }, { passive: false });

    const endTouch = (e) => {
      if (!mode) return;
      if (e.touches && e.touches.length === 1 && mode === 'pinch' && state.isActiveFn()) {
        // 핀치 후 한 손가락이 남았을 때 부드럽게 패닝으로 이어감
        mode = 'touch-pan';
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startPanX = state.panX;
        startPanY = state.panY;
        return;
      }
      if (movedDist > 5) {
        state.suppressClick = true;
        setTimeout(() => { state.suppressClick = false; }, 120);
      }
      mode = null;
      viewportEl.classList.remove('is-panning');
    };

    viewportEl.addEventListener('touchend', endTouch);
    viewportEl.addEventListener('touchcancel', endTouch);

    // PC 마우스 드래그 & 휠 줌 지원
    viewportEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !state.isActiveFn()) return;
      e.preventDefault();
      mode = 'mouse-pan';
      movedDist = 0;
      startX = e.clientX;
      startY = e.clientY;
      startPanX = state.panX;
      startPanY = state.panY;
      viewportEl.classList.add('is-panning');
    });

    const onWinMouseMove = (e) => {
      if (mode !== 'mouse-pan') return;
      const rawDx = e.clientX - startX;
      const rawDy = e.clientY - startY;
      const d = toLocalDelta(rawDx, rawDy);
      movedDist = Math.max(movedDist, Math.hypot(rawDx, rawDy));
      state.panX = startPanX + d.dx;
      state.panY = startPanY + d.dy;
      this.applyPanZoom(state);
    };

    const onWinMouseUp = () => {
      if (mode !== 'mouse-pan') return;
      if (movedDist > 5) {
        state.suppressClick = true;
        setTimeout(() => { state.suppressClick = false; }, 120);
      }
      mode = null;
      viewportEl.classList.remove('is-panning');
    };

    window.addEventListener('mousemove', onWinMouseMove);
    window.addEventListener('mouseup', onWinMouseUp);

    viewportEl.addEventListener('wheel', (e) => {
      if (!state.isActiveFn()) return;
      e.preventDefault();
      const pt = toLocalPoint(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomPanZoomAtPoint(state, state.scale * factor, pt.x, pt.y);
    }, { passive: false });

    return state;
  },

  applyPanZoom(state) {
    if (!state || !state.stageEl || !state.viewportEl) return;

    const svg = state.stageEl.querySelector('svg');
    const vpW = state.viewportEl.clientWidth || 320;
    const vpH = state.viewportEl.clientHeight || 320;
    if (svg) {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const rawW = (vb && vb.width) ? vb.width : (parseFloat(svg.getAttribute('width')) || 800);
      const rawH = (vb && vb.height) ? vb.height : (parseFloat(svg.getAttribute('height')) || 500);
      const scaledW = rawW * state.scale;
      const scaledH = rawH * state.scale;
      const minX = Math.min(48, vpW - scaledW - 48);
      const maxX = Math.max(vpW - 48, 48);
      const minY = Math.min(48, vpH - scaledH - 48);
      const maxY = Math.max(vpH - 48, 48);
      state.panX = Math.min(maxX, Math.max(minX, state.panX));
      state.panY = Math.min(maxY, Math.max(minY, state.panY));
    }

    state.stageEl.style.transform = `translate3d(${state.panX.toFixed(1)}px, ${state.panY.toFixed(1)}px, 0) scale(${state.scale})`;
    if (state.labelEl) {
      state.labelEl.textContent = `${Math.round(state.scale * 100)}%`;
    }
  },

  zoomPanZoomAtPoint(state, targetScale, anchorX, anchorY) {
    if (!state || !state.viewportEl) return;
    const prevScale = state.scale || 1;
    const nextScale = Math.min(state.maxScale, Math.max(state.minScale, Number(targetScale.toFixed(2))));
    const ratio = nextScale / prevScale;
    const cx = (typeof anchorX === 'number') ? anchorX : (state.viewportEl.clientWidth / 2);
    const cy = (typeof anchorY === 'number') ? anchorY : (state.viewportEl.clientHeight / 2);
    state.scale = nextScale;
    state.panX = cx - (cx - state.panX) * ratio;
    state.panY = cy - (cy - state.panY) * ratio;
    this.applyPanZoom(state);
  },

  centerPanZoomOnRoot(state, targetScale = 1) {
    if (!state || !state.viewportEl || !state.stageEl) return;
    state.scale = targetScale;
    state.panX = 0;
    state.panY = 16;
    state.stageEl.style.transform = `translate3d(0px, 16px, 0) scale(${state.scale})`;

    const runCenter = () => {
      const svg = state.stageEl.querySelector('svg');
      const vpRect = state.viewportEl.getBoundingClientRect();
      const vpW = state.viewportEl.clientWidth || vpRect.width || 680;
      const isRot = typeof state.isRotatedFn === 'function' && state.isRotatedFn();
      const firstNode = svg && svg.querySelector('.node');
      if (firstNode && typeof firstNode.getBoundingClientRect === 'function') {
        const nodeRect = firstNode.getBoundingClientRect();
        const scrCenterX = nodeRect.left + (nodeRect.width / 2);
        const scrCenterY = nodeRect.top + (nodeRect.height / 2);
        const nodeCenterXInStage = isRot ? (scrCenterY - vpRect.top) : (scrCenterX - vpRect.left);
        const nodeTopInStage = isRot ? (vpRect.right - nodeRect.right) : (nodeRect.top - vpRect.top);
        state.panX = (vpW / 2) - nodeCenterXInStage;
        state.panY = 18 - (nodeTopInStage - 16);
      } else if (svg) {
        const vb = svg.viewBox && svg.viewBox.baseVal;
        const rawW = (vb && vb.width) ? vb.width : (parseFloat(svg.getAttribute('width')) || vpW);
        state.panX = (vpW - rawW * state.scale) / 2;
        state.panY = 16;
      }
      this.applyPanZoom(state);
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(runCenter);
    } else {
      runCenter();
    }
  },

  setMermaidCardExplore(diagramId, enterExplore, options = {}) {
    if (typeof document === 'undefined') return;
    const card = document.getElementById(`${diagramId}-card`);
    const viewport = document.getElementById(`${diagramId}-viewport`);
    const stage = document.getElementById(`${diagramId}-stage`);
    const fitBtn = document.getElementById(`${diagramId}-fit-btn`);
    const zoomGroup = document.getElementById(`${diagramId}-zoom-group`);
    const hintEl = document.getElementById(`${diagramId}-hint`);
    const labelEl = document.getElementById(`${diagramId}-scale-label`);
    if (!card || !viewport || !stage) return;

    const state = this.bindPanZoomSurface(diagramId, viewport, stage, {
      labelEl,
      isActiveFn: () => card.classList.contains('is-explore'),
      onAutoEnterExplore: () => this.setMermaidCardExplore(diagramId, true, { skipCenter: true })
    });

    if (enterExplore) {
      card.classList.remove('is-fit');
      card.classList.add('is-explore');
      if (fitBtn) fitBtn.textContent = '한눈에';
      if (zoomGroup) zoomGroup.style.display = 'inline-flex';
      if (hintEl) hintEl.textContent = '드래그로 상하좌우 이동 · 핀치로 확대/축소';
      if (!options.skipCenter && state) {
        this.centerPanZoomOnRoot(state, 1);
      }
    } else {
      card.classList.remove('is-explore');
      card.classList.add('is-fit');
      if (fitBtn) fitBtn.textContent = '둘러보기';
      if (zoomGroup) zoomGroup.style.display = 'none';
      if (hintEl) hintEl.textContent = '핀치·둘러보기: 터치 이동 | 탭: 전체 확대';
      if (state) {
        state.scale = 1;
        state.panX = 0;
        state.panY = 0;
      }
      stage.style.transform = '';
    }
  },

  toggleMermaidFit(diagramId) {
    if (typeof document === 'undefined') return;
    const card = document.getElementById(`${diagramId}-card`);
    if (!card) return;
    const isCurrentlyExplore = card.classList.contains('is-explore');
    this.setMermaidCardExplore(diagramId, !isCurrentlyExplore);
  },

  zoomMermaidCard(diagramId, delta) {
    if (typeof document === 'undefined') return;
    const card = document.getElementById(`${diagramId}-card`);
    if (!card || !card.classList.contains('is-explore')) {
      this.setMermaidCardExplore(diagramId, true);
    }
    const state = this._panZoomStates && this._panZoomStates[diagramId];
    if (!state) return;
    this.zoomPanZoomAtPoint(state, state.scale + delta);
  },

  handleMermaidViewportClick(diagramId) {
    if (typeof document === 'undefined') return;
    const state = this._panZoomStates && this._panZoomStates[diagramId];
    if (state && state.suppressClick) return;
    const card = document.getElementById(`${diagramId}-card`);
    if (card && card.classList.contains('is-fit')) {
      this.openMermaidModal(diagramId);
    }
  },

  toggleMermaidSource(diagramId, btnEl) {
    if (typeof document === 'undefined') return;
    const viewport = document.getElementById(`${diagramId}-viewport`);
    const sourceEl = document.getElementById(`${diagramId}-source`);
    if (!viewport || !sourceEl) return;

    const showingSource = sourceEl.style.display !== 'none';
    if (showingSource) {
      sourceEl.style.display = 'none';
      viewport.style.display = 'block';
      if (btnEl) btnEl.textContent = '원본 코드';
    } else {
      sourceEl.style.display = 'block';
      viewport.style.display = 'none';
      if (btnEl) btnEl.textContent = '다이어그램';
    }
  },

  applyMermaidModalRotationUI() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('mermaid-zoom-box');
    const btn = document.getElementById('mermaid-zoom-rotate-btn');
    if (box) {
      if (this._mermaidModalRotated) box.classList.add('is-rotated');
      else box.classList.remove('is-rotated');
    }
    if (btn) {
      btn.textContent = this._mermaidModalRotated ? '세로 복귀' : '90° 가로';
      if (this._mermaidModalRotated) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  },

  fitMermaidModal() {
    if (typeof document === 'undefined') return;
    const state = this._panZoomStates && this._panZoomStates.modal;
    const zoomBody = document.getElementById('mermaid-zoom-body');
    const stage = document.getElementById('mermaid-zoom-stage');
    if (!state || !zoomBody || !stage) return;

    const svg = stage.querySelector('svg');
    if (!svg) return;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const rawW = (vb && vb.width) ? vb.width : (parseFloat(svg.getAttribute('width')) || 800);
    const rawH = (vb && vb.height) ? vb.height : (parseFloat(svg.getAttribute('height')) || 500);
    const vpW = zoomBody.clientWidth || 720;
    const vpH = zoomBody.clientHeight || 420;
    const fitScale = Math.min(1.4, Math.max(0.32, Math.min((vpW - 28) / rawW, (vpH - 28) / rawH)));

    state.minScale = Math.min(0.4, Number(fitScale.toFixed(2)));
    state.scale = Number(fitScale.toFixed(2));
    state.panX = (vpW - rawW * state.scale) / 2;
    state.panY = Math.max(14, (vpH - rawH * state.scale) / 2);
    this.applyPanZoom(state);
  },

  toggleMermaidModalRotate() {
    if (typeof document === 'undefined') return;
    this._mermaidModalRotated = !this._mermaidModalRotated;
    this.applyMermaidModalRotationUI();
    if (this._mermaidModalRotated) {
      requestAnimationFrame(() => this.fitMermaidModal());
    } else {
      const state = this._panZoomStates && this._panZoomStates.modal;
      if (state) {
        state.minScale = 0.4;
        requestAnimationFrame(() => this.centerPanZoomOnRoot(state, 1));
      }
    }
  },

  openMermaidModal(diagramId, options = {}) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('mermaid-zoom-modal');
    const stage = document.getElementById('mermaid-zoom-stage');
    const zoomBody = document.getElementById('mermaid-zoom-body');
    const label = document.getElementById('mermaid-zoom-level');
    const renderEl = document.getElementById(`${diagramId}-render`);
    if (!modal || !stage || !zoomBody || !renderEl) return;

    this._mermaidModalDiagramId = diagramId;
    this._mermaidModalRotated = !!(options && options.rotated);
    stage.innerHTML = renderEl.innerHTML;
    this.applyMermaidModalRotationUI();
    modal.style.display = 'flex';

    const state = this.bindPanZoomSurface('modal', zoomBody, stage, {
      labelEl: label,
      isActiveFn: () => true,
      isRotatedFn: () => !!this._mermaidModalRotated
    });
    if (state) {
      if (this._mermaidModalRotated) {
        state.minScale = 0.32;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => this.fitMermaidModal());
        } else {
          this.fitMermaidModal();
        }
      } else {
        state.minScale = 0.4;
        this.centerPanZoomOnRoot(state, 1);
      }
    }
  },

  closeMermaidModal() {
    if (typeof document === 'undefined' || !this._mermaidModalDiagramId) return;
    const modal = document.getElementById('mermaid-zoom-modal');
    const stage = document.getElementById('mermaid-zoom-stage');
    if (modal) modal.style.display = 'none';
    if (stage) {
      stage.innerHTML = '';
      stage.style.transform = '';
    }
    this._mermaidModalDiagramId = null;
    this._mermaidModalRotated = false;
    this.applyMermaidModalRotationUI();
  },

  zoomMermaidModal(delta) {
    if (typeof document === 'undefined') return;
    const state = this._panZoomStates && this._panZoomStates.modal;
    if (!state) return;

    if (delta === 0) {
      this.centerPanZoomOnRoot(state, 1);
      return;
    }
    this.zoomPanZoomAtPoint(state, state.scale + delta);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.Reader = Reader;
if (typeof module !== 'undefined') {
  module.exports = Reader;
}
