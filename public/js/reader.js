// public/js/reader.js - 8.4인치 태블릿 알도큐브 최적화 리더 및 확실한 수동 1회독 완료 시스템
const Reader = {
  currentDoc: null,
  readingStartTime: 0,
  readingTimer: null,
  durationSeconds: 0,
  hasLoggedStudy: false,

  async open(docId) {
    App.showView('reader');
    const container = document.getElementById('reader-content');
    container.innerHTML = '<div style="text-align: center; padding: 60px 0; color: var(--text-muted);">문서를 불러오는 중입니다...</div>';

    // 독서 타이머 초기화 (단순 체류/스크롤로 인한 자동 회독 인정 완전 차단)
    this.hasLoggedStudy = false;
    this.readingStartTime = Date.now();
    this.durationSeconds = 0;
    if (this.readingTimer) clearInterval(this.readingTimer);
    this.readingTimer = setInterval(() => {
      this.durationSeconds++;
      this.updateTimerDisplay();
    }, 1000);

    try {
      const response = await fetch(`/api/documents/${docId}`, {
        headers: {
          'x-zen-pin': localStorage.getItem('zen_pin_code') || '1234'
        }
      });
      if (response.status === 401) {
        if (typeof App !== 'undefined' && App.handleUnauthorized) {
          App.handleUnauthorized();
        }
        throw new Error("인증 실패: 올바른 PIN 번호가 필요합니다.");
      }
      const data = await response.json();
      if (!data.success || !data.document) {
        throw new Error(data.error || "문서를 찾을 수 없습니다.");
      }

      this.currentDoc = data.document;
      this.render(this.currentDoc);
      this.setupScrollObserver();
      window.scrollTo(0, 0);
    } catch (err) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--danger);">
          <h3>문서를 불러올 수 없습니다</h3>
          <p style="margin: 10px 0; color: var(--text-muted);">${err.message}</p>
          <button class="btn" onclick="App.showView('list')">← 서재로 돌아가기</button>
        </div>
      `;
    }
  },

  formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? '0' : ''}${m}분 ${s < 10 ? '0' : ''}${s}초`;
  },

  updateTimerDisplay() {
    const el = document.getElementById('timer-display');
    if (el) el.innerText = this.formatDuration(this.durationSeconds);
    const headerTimer = document.getElementById('header-timer-display');
    if (headerTimer) headerTimer.innerText = this.formatDuration(this.durationSeconds);
  },

  render(doc) {
    const container = document.getElementById('reader-content');
    const lastDate = doc.lastReviewedAt ? new Date(doc.lastReviewedAt).toLocaleDateString() : '기록 없음';

    let html = `
      <div class="reader-header">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <button class="btn btn-icon" onclick="App.showView('list')">← 서재 목록</button>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="header-timer-display" style="font-size: 0.8rem; color: var(--text-muted); font-family: monospace;">00분 00초</span>
            <button id="top-checkin-btn" class="btn btn-primary" style="font-size: 0.8rem; padding: 4px 10px;" onclick="Reader.triggerManualCheckin()">
              🎯 공부 완료
            </button>
          </div>
        </div>
        <h1 class="reader-title">${this.escapeHtml(doc.title)}</h1>
        <div class="reader-meta-bar">
          <div>
            <span class="doc-tag">${doc.category || '지식'}</span>
            <span style="margin-left: 8px;">최근 복습: <strong>${lastDate}</strong></span>
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
      html += '<p style="color: var(--text-muted);">본문 내용이 비어 있습니다.</p>';
    }

    // 문서 맨 아래 확실한 '공부 완료' 승인 카드
    html += `
      </div>
      <div class="study-completion-card">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">🎯</div>
        <h3 style="margin-bottom: 8px; font-size: 1.25rem; font-weight: 800;">오늘 이 문서 학습을 마치셨나요?</h3>
        <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 16px;">
          집중 학습 시간: <strong id="timer-display" style="color: var(--accent); font-size: 1rem;">00분 00초</strong><br>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">
            ※ 단순 스크롤이나 열람은 회독으로 기록되지 않으며, 아래 버튼을 눌러야만 1회독이 인정됩니다.
          </span>
        </p>
        <button id="manual-checkin-btn" class="btn btn-primary" style="padding: 12px 28px; font-size: 1.05rem; font-weight: 700; border-radius: 12px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.3);" onclick="Reader.triggerManualCheckin()">
          ✅ 오늘 공부 완료! (1회독 추가)
        </button>
      </div>
    `;

    container.innerHTML = html;
  },

  renderBlocks(blocks) {
    let out = '';
    for (const b of blocks) {
      const contentHtml = b.html || this.escapeHtml(b.text || '');
      switch (b.type) {
        case 'heading_1':
          out += `<h1>${contentHtml}</h1>`;
          break;
        case 'heading_2':
          out += `<h2>${contentHtml}</h2>`;
          break;
        case 'heading_3':
          out += `<h3>${contentHtml}</h3>`;
          break;
        case 'paragraph':
          out += `<p>${contentHtml}</p>`;
          break;
        case 'callout':
          out += `
            <div class="zen-callout">
              <span class="zen-callout-icon">${b.icon || '📌'}</span>
              <div class="zen-callout-content" style="flex: 1; min-width: 0;">
                ${contentHtml ? `<div class="zen-callout-title" style="font-weight: 700; margin-bottom: 6px;">${contentHtml}</div>` : ''}
                ${b.children && b.children.length > 0 ? this.renderBlocks(b.children) : ''}
              </div>
            </div>
          `;
          break;
        case 'quote':
          out += `
            <blockquote class="zen-quote" style="border-left: 3px solid var(--accent); padding-left: 14px; margin: 16px 0; color: var(--text-secondary); font-style: italic;">
              <div>${contentHtml}</div>
              ${b.children ? this.renderBlocks(b.children) : ''}
            </blockquote>
          `;
          break;
        case 'toggle':
          const summaryHtml = b.summaryHtml || this.escapeHtml(b.summary || b.text || '열기 / 닫기');
          out += `
            <details class="zen-toggle">
              <summary>${summaryHtml}</summary>
              <div class="zen-toggle-content">
                ${b.children ? this.renderBlocks(b.children) : `<p>${contentHtml}</p>`}
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
        case 'bulleted_list_item':
          out += `<ul><li>${contentHtml}</li></ul>`;
          break;
        case 'numbered_list_item':
          out += `<ol><li>${contentHtml}</li></ol>`;
          break;
        case 'to_do':
          out += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <input type="checkbox" ${b.checked ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--accent);">
              <span>${contentHtml}</span>
            </div>
          `;
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
        default:
          if (b.text || b.html) {
            out += `<p>${contentHtml}</p>`;
          }
          break;
      }
    }
    return out;
  },

  // 독서 진행률 바만 갱신 (자동 회독 트리거는 제거됨)
  setupScrollObserver() {
    window.onscroll = () => {
      const scrollY = window.scrollY;
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = totalHeight > 0 ? (scrollY / totalHeight) * 100 : 0;

      const bar = document.getElementById('reading-progress-bar');
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    };
  },

  // 수동 체크인 버튼 클릭 시
  async triggerManualCheckin() {
    if (this.hasLoggedStudy) {
      App.showToast("이미 오늘 학습 완료가 기록되었습니다!");
      return;
    }
    await this.executeCheckin();
  },

  // 실제 체크인 실행 (로컬 큐 및 서버 전송)
  async executeCheckin() {
    if (this.hasLoggedStudy || !this.currentDoc) return;
    this.hasLoggedStudy = true;

    const newCount = (this.currentDoc.reviewCount || 0) + 1;
    this.currentDoc.reviewCount = newCount;

    const payload = {
      docId: this.currentDoc.id,
      docTitle: this.currentDoc.title,
      durationSeconds: Math.max(10, this.durationSeconds),
      reviewCount: newCount,
      device: "alldocube-iplay60"
    };

    const res = await OfflineManager.sendStudyLog(payload);

    // 화면 UI 업데이트
    const badge = document.getElementById('reader-review-badge');
    if (badge) {
      badge.innerHTML = `🏆 누적 ${newCount}회독 ✅`;
    }

    const btn = document.getElementById('manual-checkin-btn');
    if (btn) {
      btn.innerText = `🎉 오늘 공부 완료 기록됨 (${newCount}회독)`;
      btn.className = "btn";
      btn.style.backgroundColor = "var(--bg-secondary)";
      btn.style.borderColor = "var(--success)";
      btn.style.color = "var(--success)";
      btn.disabled = true;
    }

    const topBtn = document.getElementById('top-checkin-btn');
    if (topBtn) {
      topBtn.innerText = `✅ ${newCount}회독`;
      topBtn.disabled = true;
    }

    App.showToast(`🎉 1회독 달성! (${newCount}회독 기록 완료)`);
  },

  cleanup() {
    if (this.readingTimer) clearInterval(this.readingTimer);
    window.onscroll = null;
    const bar = document.getElementById('reading-progress-bar');
    if (bar) bar.style.width = '0%';
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};
