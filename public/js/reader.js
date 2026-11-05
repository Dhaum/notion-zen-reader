// public/js/reader.js - Stageshow 인체공학 썸 존 독 & 3단계 기억 피드백 리더
const Reader = {
  currentDoc: null,
  readingStartTime: 0,
  readingTimer: null,
  durationSeconds: 0,
  hasLoggedStudy: false,
  lastScrollY: 0,
  scrollThreshold: 15,
  isAllTogglesExpanded: false,

  async open(docId) {
    App.showView('reader');
    const container = document.getElementById('reader-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">문서를 불러오는 중입니다...</div>';

    // 타이머 및 상태 초기화
    this.hasLoggedStudy = false;
    this.readingStartTime = Date.now();
    this.durationSeconds = 0;
    this.isAllTogglesExpanded = false;
    if (this.readingTimer) clearInterval(this.readingTimer);
    this.readingTimer = setInterval(() => {
      this.durationSeconds++;
      this.updateTimerDisplay();
    }, 1000);

    // 플로팅 독 표시
    this.showFloatingDock(true);

    try {
      const response = await fetch(`/api/documents/${docId}`, {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
        }
      });
      if (response.status === 401 && typeof App !== 'undefined') {
        App.handleUnauthorized();
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }
      const data = await response.json();
      if (!data.success || !data.document) {
        throw new Error(data.error || "문서를 찾을 수 없습니다.");
      }

      this.currentDoc = data.document;

      // 태블릿 로컬 IndexedDB의 회독수 및 복습일자 반영
      if (typeof ZenStorage !== 'undefined') {
        try {
          const statsMap = await ZenStorage.getDocStatsMap();
          if (statsMap[docId]) {
            this.currentDoc.reviewCount = Math.max(this.currentDoc.reviewCount || 0, statsMap[docId].reviewCount);
            if (statsMap[docId].lastReviewedAt) {
              this.currentDoc.lastReviewedAt = statsMap[docId].lastReviewedAt;
            }
          }
        } catch (e) {
          console.warn('[Reader] 로컬 통계 맵 조회 실패:', e);
        }
      }

      // 로컬 동기화 타임스탬프 갱신 (열람 시 최신 상태로 동기화 기록)
      if (typeof App !== 'undefined') {
        if (App.setDocSyncMap) {
          App.setDocSyncMap(docId, this.currentDoc.updatedAt);
        }
        if (App.documents) {
          const cachedDoc = App.documents.find(d => d.id === docId);
          if (cachedDoc) cachedDoc.hasUpdate = false;
        }
      }

      this.render(this.currentDoc);
      this.setupSmartScroll();
      window.scrollTo(0, 0);
    } catch (err) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>문서를 불러올 수 없습니다</h3>
          <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.88rem;">${err.message}</p>
          <button class="btn" onclick="App.showView('list')">← 서재로 돌아가기</button>
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
    const dock = document.getElementById('zen-floating-dock');
    if (!dock) return;
    if (visible) {
      dock.style.display = 'flex';
      setTimeout(() => dock.classList.add('visible'), 50);
    } else {
      dock.classList.remove('visible');
      setTimeout(() => { dock.style.display = 'none'; }, 280);
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
    if (icon) icon.innerText = this.isAllTogglesExpanded ? '🙈' : '👁️';

    App.showToast(this.isAllTogglesExpanded ? '👁️ 모든 셀프테스트 토글을 열었습니다.' : '🙈 모든 셀프테스트 토글을 닫았습니다.');
  },

  // 현재 열람 중인 단일 문서만 노션 API에서 실시간 1:1 핀포인트 최신화 (~0.4초 소요)
  async refreshCurrentDoc() {
    if (!this.currentDoc || !this.currentDoc.id) {
      if (typeof App !== 'undefined') App.showToast('새로고침할 문서가 없습니다.');
      return;
    }

    const docId = this.currentDoc.id;
    const docTitle = this.currentDoc.title || '문서';
    const refreshBtn = document.getElementById('btn-reader-pinpoint-refresh');
    const headerRefreshBtn = document.getElementById('header-refresh-btn');

    if (refreshBtn) refreshBtn.classList.add('spinning');
    if (headerRefreshBtn) headerRefreshBtn.classList.add('spinning');
    if (typeof App !== 'undefined') {
      App.showToast(`🔄 [${docTitle}] 노션 실시간 최신 내용 조회 중...`);
    }

    try {
      const response = await fetch(`/api/documents/${docId}?refresh=true`, {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || ''
        }
      });

      if (response.status === 401 && typeof App !== 'undefined') {
        App.handleUnauthorized();
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }

      const data = await response.json();
      if (!data.success || !data.document) {
        throw new Error(data.error || "최신 문서를 불러오지 못했습니다.");
      }

      // 회독수 및 복습일자 보존
      const prevReviewCount = this.currentDoc.reviewCount;
      const prevLastReviewedAt = this.currentDoc.lastReviewedAt;

      this.currentDoc = data.document;
      this.currentDoc.reviewCount = Math.max(this.currentDoc.reviewCount || 0, prevReviewCount || 0);
      if (prevLastReviewedAt) {
        this.currentDoc.lastReviewedAt = prevLastReviewedAt;
      }

      // 4대 안전장치: 독서 타이머(durationSeconds, readingStartTime)는 절대 초기화하지 않고 연속 유지!
      const currentScrollY = window.scrollY;

      // 본문 재렌더링
      this.render(this.currentDoc);
      this.setupSmartScroll();
      window.scrollTo(0, currentScrollY);

      // 로컬 동기화 타임스탬프 갱신
      if (typeof App !== 'undefined') {
        if (App.setDocSyncMap) {
          App.setDocSyncMap(docId, this.currentDoc.updatedAt);
        }
        if (App.documents) {
          const cachedDoc = App.documents.find(d => d.id === docId);
          if (cachedDoc) cachedDoc.hasUpdate = false;
        }
        App.showToast(`✨ [${docTitle}] 노션 최신 내용이 실시간 반영되었습니다!`);
      }
    } catch (err) {
      console.error('[Reader] 실시간 동기화 오류:', err);
      if (typeof App !== 'undefined') {
        App.showToast(`⚠️ 실시간 동기화 실패: ${err.message}`);
      }
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('spinning');
      if (headerRefreshBtn) headerRefreshBtn.classList.remove('spinning');
    }
  },

  render(doc) {
    const container = document.getElementById('reader-content');
    const lastDate = doc.lastReviewedAt ? new Date(doc.lastReviewedAt).toLocaleDateString() : '기록 없음';

    let html = `
      <div class="reader-header">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 8px;">
          <button class="btn btn-icon" onclick="App.showView('list')">← 서재 목록</button>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <button id="btn-reader-pinpoint-refresh" class="btn btn-icon" onclick="Reader.refreshCurrentDoc()" title="노션 실시간 최신 내용 새로고침 (0.4초)">
              🔄 <span style="font-size: 0.75rem; font-weight: 600; margin-left: 2px;">실시간 갱신</span>
            </button>
            <span id="header-timer-display" style="font-size: 0.85rem; color: var(--text-muted); font-family: var(--font-family-mono);">00:00</span>
            <button id="top-checkin-btn" class="btn btn-primary" style="font-size: 0.8rem; padding: 4px 12px;" onclick="Reader.triggerManualCheckin('good')">
              🎯 1회독 완료
            </button>
          </div>
        </div>
        <h1 class="reader-title">${this.escapeHtml(doc.title)}</h1>
        <div class="reader-meta-bar">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${(doc.tags || []).map(t => `<span class="doc-tag">#${this.escapeHtml(t)}</span>`).join(' ')}
            <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">최근 복습: <strong>${lastDate}</strong></span>
          </div>
          <div id="reader-review-badge" class="doc-review-badge">
            🏆 누적 ${doc.reviewCount || 0}회독
          </div>
        </div>
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
        <div style="font-size: 2.2rem; margin-bottom: 8px;">🎯</div>
        <h3 style="margin-bottom: 6px; font-size: 1.25rem; font-weight: 800;">오늘 이 문서 학습을 마치셨나요?</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 18px;">
          집중 학습 시간: <strong id="timer-display" style="color: var(--accent); font-size: 1.05rem; font-family: var(--font-family-mono);">00:00</strong><br>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">
            기억 체감도를 선택하면 Clinical-SM2 알고리즘이 다음 복습 주기를 자동 배정합니다.
          </span>
        </p>
        
        <div class="feedback-buttons-row">
          <button id="fb-btn-easy" class="btn btn-feedback btn-feedback-easy" onclick="Reader.triggerManualCheckin('easy')">
            🟢 수월함 (주기 연장)
          </button>
          <button id="fb-btn-good" class="btn btn-feedback btn-feedback-good" onclick="Reader.triggerManualCheckin('good')">
            🔵 적정 (권장 주기)
          </button>
          <button id="fb-btn-hard" class="btn btn-feedback btn-feedback-hard" onclick="Reader.triggerManualCheckin('hard')">
            🔴 헷갈림 (내일 다시)
          </button>
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.updateTimerDisplay();
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
          const hTag = b.type === 'heading_1' ? 'h1' : (b.type === 'heading_2' ? 'h2' : 'h3');
          if (b.isToggleable && b.children && b.children.length > 0) {
            out += `
              <details class="zen-toggle zen-heading-toggle">
                <summary><${hTag} style="display: inline; margin: 0;">${contentHtml}</${hTag}></summary>
                <div class="zen-toggle-content">
                  ${this.renderBlocks(b.children)}
                </div>
              </details>
            `;
          } else {
            out += `<${hTag}>${contentHtml}</${hTag}>`;
            if (b.children && b.children.length > 0) {
              out += this.renderBlocks(b.children);
            }
          }
          break;

        case 'code':
          const codeText = b.code || b.text || '';
          const langBadge = (b.language && b.language !== 'plain text')
            ? `<div class="zen-code-lang">${this.escapeHtml(b.language)}</div>`
            : '';
          out += `
            <div class="zen-code-wrapper">
              ${langBadge}
              <pre class="zen-code-block"><code>${this.escapeHtml(codeText)}</code></pre>
            </div>
          `;
          break;

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

        case 'callout':
          out += `
            <div class="zen-callout">
              <span class="zen-callout-icon">${b.icon || '📌'}</span>
              <div class="zen-callout-content" style="flex: 1; min-width: 0;">
                ${contentHtml ? `<div class="zen-callout-title">${contentHtml}</div>` : ''}
                ${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}
              </div>
            </div>
          `;
          break;

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

  // 스마트 스크롤: 헤더 자동 숨김 & 앰비언트 진행률 바
  setupSmartScroll() {
    this.lastScrollY = window.scrollY;
    const header = document.querySelector('.zen-header');
    const progressBar = document.getElementById('reading-progress-bar');

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
    };
  },

  // 수동 체크인 버튼 클릭 시 (체감 난이도 피드백 포함)
  async triggerManualCheckin(feedback = 'good') {
    if (this.hasLoggedStudy) {
      App.showToast("이미 오늘 학습 완료가 기록되었습니다!");
      return;
    }
    await this.executeCheckin(feedback);
  },

  // 실제 체크인 실행 (IndexedDB 영구 저장 및 서버 비동기 전송)
  async executeCheckin(feedback = 'good') {
    if (this.hasLoggedStudy || !this.currentDoc) return;
    this.hasLoggedStudy = true;

    const newCount = (this.currentDoc.reviewCount || 0) + 1;
    this.currentDoc.reviewCount = newCount;

    const payload = {
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
        await ZenStorage.saveLog(payload);
      } catch (err) {
        console.warn('[Reader] IndexedDB 저장 실패:', err);
      }
    }

    // 2. 오프라인 큐 및 서버 전송 (실패해도 로컬 저장은 보장)
    if (window.OfflineManager && OfflineManager.sendStudyLog) {
      OfflineManager.sendStudyLog(payload).catch(() => {});
    }

    // 화면 UI 업데이트
    const badge = document.getElementById('reader-review-badge');
    if (badge) {
      badge.innerHTML = `🏆 누적 ${newCount}회독 ✅`;
    }

    const topBtn = document.getElementById('top-checkin-btn');
    if (topBtn) {
      topBtn.innerText = `✅ ${newCount}회독`;
      topBtn.disabled = true;
    }

    const dockCheckinBtn = document.getElementById('dock-checkin-btn');
    if (dockCheckinBtn) {
      dockCheckinBtn.innerHTML = `<span>✅</span><span class="dock-label">완료</span>`;
      dockCheckinBtn.disabled = true;
      dockCheckinBtn.style.opacity = '0.7';
    }

    const fbRow = document.querySelector('.feedback-buttons-row');
    if (fbRow) {
      let feedbackText = '🔵 적정 (권장 주기 반영)';
      if (feedback === 'easy') feedbackText = '🟢 수월함 (장기 복습 주기 반영)';
      else if (feedback === 'hard') feedbackText = '🔴 헷갈림 (내일 재복습 반영)';

      fbRow.innerHTML = `
        <div style="width: 100%; text-align: center; padding: 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); border-radius: 10px; color: var(--success); font-weight: 700;">
          🎉 ${newCount}회독 체크인 완료! [${feedbackText}]
        </div>
      `;
    }

    App.showToast(`🎉 1회독 달성! (${newCount}회독 기록 완료)`);
  },

  cleanup() {
    if (this.readingTimer) clearInterval(this.readingTimer);
    window.onscroll = null;
    const header = document.querySelector('.zen-header');
    if (header) header.classList.remove('header-hidden');
    const bar = document.getElementById('reading-progress-bar');
    if (bar) bar.style.width = '0%';
    this.showFloatingDock(false);
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
