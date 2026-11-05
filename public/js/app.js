// public/js/app.js - 메인 앱 컨트롤러, 라우터, 테마 및 보안 게이트
const App = {
  currentView: 'list',
  documents: [],
  filteredDocuments: [],
  selectedStatus: 'all',     // 'all' | '완료' | '진행 중' | '시작 전'
  sortOrder: 'created_desc',  // 'created_desc' | 'created_asc' | 'updated_desc' | 'title_asc'
  searchQuery: '',
  deferredInstallPrompt: null,

  init() {
    this.initSecurity();
    this.initTheme();
    this.initPWA();
    if (typeof ZenStorage !== 'undefined') {
      ZenStorage.init().catch(console.warn);
    }
    OfflineManager.init();
    this.loadDocuments();
  },

  // 1. PIN 보안 인증 게이트
  initSecurity() {
    const isVerified = localStorage.getItem('zen_pin_verified');
    const hasPin = localStorage.getItem('zen_pin_code');
    const modal = document.getElementById('pin-modal');
    if (isVerified === 'true' && hasPin) {
      if (modal) modal.style.display = 'none';
    } else {
      if (modal) modal.style.display = 'flex';
    }
  },

  async verifyPin() {
    const input = document.getElementById('pin-code-input');
    const errorMsg = document.getElementById('pin-error-msg');
    const btn = document.querySelector('#pin-modal button.btn-primary');
    const enteredPin = (input.value || '').trim();

    if (!enteredPin) {
      if (errorMsg) {
        errorMsg.innerText = 'PIN 번호를 입력해주세요.';
        errorMsg.style.display = 'block';
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (errorMsg) errorMsg.style.display = 'none';

    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zen-pin': enteredPin
        }
      });

      if (res.ok) {
        localStorage.setItem('zen_pin_verified', 'true');
        localStorage.setItem('zen_pin_code', enteredPin);
        document.getElementById('pin-modal').style.display = 'none';
        if (errorMsg) errorMsg.style.display = 'none';
        this.showToast('🔓 인증 완료! 지식 서재에 오신 것을 환영합니다.');
        this.loadDocuments();
      } else {
        if (errorMsg) {
          errorMsg.innerText = '올바른 PIN 번호가 아닙니다. 다시 입력해주세요.';
          errorMsg.style.display = 'block';
        }
        input.value = '';
        input.focus();
      }
    } catch (netErr) {
      // 오프라인 상태일 경우 기기 로컬스토리지에 저장된 이전 유효 PIN과 대조
      const savedPin = localStorage.getItem('zen_pin_code');
      if (savedPin && savedPin === enteredPin) {
        localStorage.setItem('zen_pin_verified', 'true');
        document.getElementById('pin-modal').style.display = 'none';
        if (errorMsg) errorMsg.style.display = 'none';
        this.showToast('📡 오프라인 모드로 서재에 입장했습니다.');
        this.loadDocuments();
      } else {
        if (errorMsg) {
          errorMsg.innerText = '네트워크 연결 상태를 확인하거나 올바른 PIN을 입력해주세요.';
          errorMsg.style.display = 'block';
        }
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  handleUnauthorized() {
    localStorage.removeItem('zen_pin_verified');
    localStorage.removeItem('zen_pin_code');
    const modal = document.getElementById('pin-modal');
    if (modal) modal.style.display = 'flex';
    const errorMsg = document.getElementById('pin-error-msg');
    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.innerText = '인증 실패: 올바른 PIN 번호가 필요합니다.';
    }
    const input = document.getElementById('pin-code-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  },

  // 2. 테마 및 글자 크기 관리
  initTheme() {
    const savedTheme = localStorage.getItem('zen_theme') || 'theme-dark';
    const savedFontSize = localStorage.getItem('zen_font_size') || 'font-md';
    this.setTheme(savedTheme);
    this.setFontSize(savedFontSize);
  },

  setTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-sepia');
    document.body.classList.add(theme);
    localStorage.setItem('zen_theme', theme);
  },

  toggleTheme() {
    if (document.body.classList.contains('theme-dark')) {
      this.setTheme('theme-light');
      this.showToast('☀️ 종이 라이트 모드');
    } else if (document.body.classList.contains('theme-light')) {
      this.setTheme('theme-sepia');
      this.showToast('☕ 세피아 독서 모드');
    } else {
      this.setTheme('theme-dark');
      this.showToast('🌙 딥 다크 모드');
    }
  },

  setFontSize(size) {
    document.body.classList.remove('font-sm', 'font-md', 'font-lg');
    document.body.classList.add(size);
    localStorage.setItem('zen_font_size', size);
  },

  cycleFontSize() {
    if (document.body.classList.contains('font-sm')) {
      this.setFontSize('font-md');
      this.showToast('🔤 글자 크기: 보통');
    } else if (document.body.classList.contains('font-md')) {
      this.setFontSize('font-lg');
      this.showToast('🔤 글자 크기: 크게 (8.4인치 권장)');
    } else {
      this.setFontSize('font-sm');
      this.showToast('🔤 글자 크기: 작게');
    }
  },

  // 3. PWA 서비스워커 등록 및 설치 프롬프트 제어
  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('[PWA] 서비스워커 등록 성공:', reg.scope))
          .catch((err) => console.warn('[PWA] 서비스워커 등록 실패:', err));
      });
    }

    // 안드로이드 / 크롬 네이티브 설치 이벤트 캡처
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
      }
      console.log('[PWA] beforeinstallprompt 감지: 원터치 설치 버튼 활성화');
    });

    // PWA 설치 완료 감지
    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) installBtn.style.display = 'none';
      this.showToast('🎉 지식 서재 웹앱이 태블릿에 성공적으로 설치되었습니다!');
      console.log('[PWA] 웹앱 설치 완료');
    });

    // 이미 독립 창(standalone)으로 실행 중인지 확인
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) installBtn.style.display = 'none';
    }
  },

  async installPWA() {
    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      const { outcome } = await this.deferredInstallPrompt.userChoice;
      console.log('[PWA] 설치 다이얼로그 결과:', outcome);
      if (outcome === 'accepted') {
        this.showToast('📲 앱 설치를 시작합니다...');
      }
      this.deferredInstallPrompt = null;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) installBtn.style.display = 'none';
    } else {
      // iOS 사파리 또는 브라우저 수동 안내
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert('📱 아이패드 웹앱 설치 방법:\n상단 브라우저의 [공유 아이콘(네모 위 화살표)]을 누른 후, 아래 메뉴에서 [홈 화면에 추가]를 선택해주세요.');
      } else {
        alert('📱 태블릿 웹앱 설치 방법:\n브라우저 우측 상단 더보기 [⋮] 메뉴를 누른 후, [앱 설치] 또는 [홈 화면에 추가]를 선택해주세요.');
      }
    }
  },

  // 4. 노션 문서 목록 로딩 (새 글 반영용 forceRefresh 옵션 지원)
  async loadDocuments(forceRefresh = false) {
    const listContainer = document.getElementById('doc-card-list');
    listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">지식 문서를 동기화하는 중입니다...</div>';

    try {
      const url = forceRefresh ? '/api/documents?refresh=true' : '/api/documents';
      const response = await fetch(url, {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
        }
      });
      if (response.status === 401) {
        this.handleUnauthorized();
        throw new Error('인증 실패: 올바른 PIN 번호가 필요합니다.');
      }
      const data = await response.json();
      if (!data.success || !data.documents) {
        throw new Error(data.error || "문서 목록을 불러올 수 없습니다.");
      }

      this.documents = data.documents;

      // 로컬 IndexedDB에 저장된 회독수와 최신 복습일자 결합
      if (typeof ZenStorage !== 'undefined') {
        try {
          const statsMap = await ZenStorage.getDocStatsMap();
          for (const doc of this.documents) {
            if (statsMap[doc.id]) {
              doc.reviewCount = statsMap[doc.id].reviewCount;
              if (statsMap[doc.id].lastReviewedAt) {
                doc.lastReviewedAt = statsMap[doc.id].lastReviewedAt;
              }
            }
          }
        } catch (e) {
          console.warn('[App] 로컬 통계 융합 실패:', e);
        }
      }

      this.updateStatusPillCounts();
      this.applyFilterAndSort();
      if (forceRefresh) {
        this.showToast(`✨ 최신 노션 지식 DB 동기화 완료 (${data.documents.length}개 문서)`);
      }
    } catch (err) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--danger);">
          <p>문서 목록 로딩 실패</p>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">${err.message}</p>
        </div>
      `;
    }
  },

  // 상태 필터 선택 ('all' | '완료' | '진행 중' | '시작 전')
  setStatusFilter(status) {
    this.selectedStatus = status;
    document.querySelectorAll('.status-pill').forEach(btn => {
      if (btn.dataset.status === status) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    this.applyFilterAndSort();
  },

  // 정렬 기준 변경 ('created_desc' | 'created_asc' | 'updated_desc' | 'title_asc')
  setSortOrder(order) {
    this.sortOrder = order;
    this.applyFilterAndSort();
  },

  filterDocuments(query) {
    this.searchQuery = query;
    this.applyFilterAndSort();
  },

  // 검색어, 상태 필터, 정렬 기준 종합 적용
  applyFilterAndSort() {
    const q = this.searchQuery.trim().toLowerCase();

    // 1) 검색어 및 상태 필터링
    let list = this.documents.filter(doc => {
      // 상태 필터 검사
      if (this.selectedStatus !== 'all') {
        const docStatus = doc.status || '시작 전';
        if (this.selectedStatus === '진행 중' && (docStatus.includes('진행') || docStatus.includes('Progress'))) {
          // 일치
        } else if (this.selectedStatus === '완료' && (docStatus.includes('완료') || docStatus.includes('Done') || docStatus.includes('Complete'))) {
          // 일치
        } else if (this.selectedStatus === '시작 전' && (docStatus.includes('시작') || docStatus.includes('To-do'))) {
          // 일치
        } else if (docStatus !== this.selectedStatus) {
          return false;
        }
      }

      // 검색어 필터 검사
      if (q) {
        const matchTitle = doc.title.toLowerCase().includes(q);
        const matchCategory = (doc.category || '').toLowerCase().includes(q);
        const matchTags = (doc.tags || []).some(t => t.toLowerCase().includes(q));
        if (!matchTitle && !matchCategory && !matchTags) return false;
      }

      return true;
    });

    // 2) 정렬 적용
    list.sort((a, b) => {
      if (this.sortOrder === 'created_desc') {
        // 최신 생성순
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      } else if (this.sortOrder === 'created_asc') {
        // 과거 생성순 (오름차순)
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      } else if (this.sortOrder === 'updated_desc') {
        // 최근 수정순
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      } else if (this.sortOrder === 'title_asc') {
        // 제목 가나다순
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    this.filteredDocuments = list;
    this.renderDocumentList();
  },

  updateStatusPillCounts() {
    let countTotal = this.documents.length;
    let countDone = 0;
    let countProgress = 0;
    let countTodo = 0;

    this.documents.forEach(d => {
      const s = d.status || '';
      if (s.includes('완료') || s.includes('Done') || s.includes('Complete')) countDone++;
      else if (s.includes('진행') || s.includes('Progress')) countProgress++;
      else countTodo++;
    });

    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.innerText = txt;
    };
    setTxt('count-all', countTotal);
    setTxt('count-done', countDone);
    setTxt('count-progress', countProgress);
    setTxt('count-todo', countTodo);
  },

  renderDocumentList() {
    const listContainer = document.getElementById('doc-card-list');
    if (this.filteredDocuments.length === 0) {
      listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">조건에 맞는 문서가 없습니다.</div>';
      return;
    }

    let html = '';
    this.filteredDocuments.forEach(doc => {
      const lastDate = doc.lastReviewedAt ? new Date(doc.lastReviewedAt).toLocaleDateString() : '미학습';
      const createdDate = doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : '';

      // 상태별 뱃지 스타일링
      const s = doc.status || '시작 전';
      let statusBadgeClass = 'badge-status-시작전';
      if (s.includes('완료') || s.includes('Done') || s.includes('Complete')) {
        statusBadgeClass = 'badge-status-완료';
      } else if (s.includes('진행') || s.includes('Progress')) {
        statusBadgeClass = 'badge-status-진행중';
      }

      const reviewBadge = doc.reviewCount > 0
        ? `<span class="doc-review-badge">🏆 ${doc.reviewCount}회독</span>`
        : `<span style="font-size: 0.75rem; color: var(--text-muted);">미학습</span>`;

      html += `
        <div class="doc-card" onclick="Reader.open('${doc.id}')">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
            <div class="doc-card-title" style="margin-bottom: 0;">${this.escapeHtml(doc.title)}</div>
            <span class="card-status-badge ${statusBadgeClass}">${this.escapeHtml(s)}</span>
          </div>
          <div class="doc-card-meta">
            ${createdDate ? `<span style="color: var(--text-muted); font-size: 0.75rem;">📅 ${createdDate} 생성</span>` : ''}
            <span class="doc-tag">${this.escapeHtml(doc.category || '지식')}</span>
            ${(doc.tags || []).slice(0, 3).map(t => `<span class="doc-tag">#${this.escapeHtml(t)}</span>`).join(' ')}
            ${(doc.tags || []).length > 3 ? `<span style="font-size: 0.7rem; color: var(--text-muted);">+${doc.tags.length - 3}</span>` : ''}
            <span style="margin-left: auto;">${reviewBadge}</span>
          </div>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  },

  // 5. 뷰 전환 제어
  showView(viewName) {
    this.currentView = viewName;
    const listView = document.getElementById('view-list');
    const readerView = document.getElementById('view-reader');
    const dashboardView = document.getElementById('view-dashboard');
    const tabList = document.getElementById('tab-btn-list');
    const tabDashboard = document.getElementById('tab-btn-dashboard');

    if (viewName === 'reader') {
      listView.style.display = 'none';
      readerView.style.display = 'block';
      dashboardView.style.display = 'none';
    } else if (viewName === 'dashboard') {
      Reader.cleanup();
      listView.style.display = 'none';
      readerView.style.display = 'none';
      dashboardView.style.display = 'block';
      tabList.classList.remove('active');
      tabDashboard.classList.add('active');
      Dashboard.load();
    } else {
      // list
      Reader.cleanup();
      listView.style.display = 'block';
      readerView.style.display = 'none';
      dashboardView.style.display = 'none';
      tabList.classList.add('active');
      tabDashboard.classList.remove('active');
      this.loadDocuments(); // 목록 새로고침 (회독수 갱신 반영)
    }
  },

  // 140개 전 문서 오프라인 일괄 사전 캐싱 (350ms Pacing + 429 지수 백오프 재시도 + 세련된 진행률)
  async downloadAllForOffline() {
    if (!navigator.onLine) {
      this.showToast('⚠️ 오프라인 상태에서는 일괄 다운로드를 할 수 없습니다.');
      return;
    }

    if (this.documents.length === 0) {
      this.showToast('문서 목록을 먼저 불러와주세요.');
      return;
    }

    if (!confirm(`현재 서재에 있는 ${this.documents.length}개 전체 문서를 태블릿 오프라인 저장소에 다운로드할까요?\n\n(완료 시 인터넷이 전혀 없는 야외나 비행기에서도 모든 문서를 읽을 수 있습니다)`)) {
      return;
    }

    const total = this.documents.length;
    this.showToast(`📦 오프라인 캐싱 시작 (총 ${total}개)...`);
    let successCount = 0;
    let failCount = 0;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 429 Too Many Requests 대응: 1.5초 대기 후 최대 2회 지수 백오프 재시도
    const fetchDocWithRetry = async (docId, maxRetries = 2) => {
      let attempt = 0;
      while (attempt <= maxRetries) {
        try {
          const res = await fetch(`/api/documents/${docId}`, {
            headers: {
              'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
            }
          });
          if (res.status === 429) {
            if (attempt < maxRetries) {
              const backoffMs = 1500 * Math.pow(2, attempt);
              console.warn(`[ZenReader] 429 Too Many Requests 감지 - ${backoffMs}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})...`);
              await sleep(backoffMs);
              attempt++;
              continue;
            }
          }
          if (!res.ok && res.status >= 500 && attempt < maxRetries) {
            const backoffMs = 1500 * Math.pow(2, attempt);
            console.warn(`[ZenReader] 서버 일시 오류(${res.status}) - ${backoffMs}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})...`);
            await sleep(backoffMs);
            attempt++;
            continue;
          }
          return res;
        } catch (netErr) {
          if (attempt < maxRetries) {
            const backoffMs = 1500 * Math.pow(2, attempt);
            console.warn(`[ZenReader] 네트워크 연결 오류 - ${backoffMs}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})...`, netErr);
            await sleep(backoffMs);
            attempt++;
            continue;
          }
          throw netErr;
        }
      }
    };

    for (let i = 0; i < total; i++) {
      const doc = this.documents[i];
      try {
        const docRes = await fetchDocWithRetry(doc.id, 2);
        if (docRes && docRes.ok) {
          const docData = await docRes.json();

          // 문서 내 포함된 약물 구조식/도해 이미지까지 zen-images-v1 영구 캐시에 프리패치
          if (docData && docData.document && docData.document.blocks) {
            const images = [];
            const extractImages = (blocks) => {
              for (const b of blocks) {
                if (b.type === 'image' && b.imageUrl) images.push(b.imageUrl);
                if (b.children) extractImages(b.children);
              }
            };
            extractImages(docData.document.blocks);

            // 이미지 병렬 프리패치 (서비스 워커 zen-images-v1 자동 인터셉트)
            if (images.length > 0) {
              await Promise.allSettled(
                images.map(imgUrl => fetch(imgUrl, { mode: 'no-cors' }).catch(() => {}))
              );
            }
          }
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.warn('다운로드 실패:', doc.title, err);
        failCount++;
      }

      // 세련된 진행률 표시: 📦 오프라인 캐싱 중... 45/140 (32%)
      const current = i + 1;
      const pct = Math.round((current / total) * 100);
      this.showToast(`📦 오프라인 캐싱 중... ${current}/${total} (${pct}%)`);

      // 140개 연속 호출 시 문서 간 350ms 페이싱(Pacing) 딜레이 주입 (마지막 문서 직후에는 생략)
      if (i < total - 1) {
        await sleep(350);
      }
    }

    if (failCount === 0) {
      this.showToast(`🎉 총 ${successCount}개 문서 오프라인 저장 완료! 이제 인터넷 없이도 모든 문서를 읽을 수 있습니다.`);
    } else {
      this.showToast(`⚠️ 오프라인 캐싱 완료: 성공 ${successCount}개 / 실패 ${failCount}개 (인터넷 없이 열람 가능)`);
    }
  },

  // 6. 플로팅 토스트 알림
  showToast(message) {
    let toast = document.getElementById('zen-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zen-toast';
      toast.className = 'zen-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.classList.add('show');
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
