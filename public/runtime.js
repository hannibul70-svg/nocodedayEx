/**
 * DAP Runtime Player (End-user Interactive Guide)
 */

(function () {
  'use strict';

  // API 서버 베이스 URL 자동 추론 (다른 웹사이트에 임베드될 때 스크립트 출처 origin을 자동으로 사용)
  const CURRENT_SCRIPT = document.currentScript ? document.currentScript.src : '';
  let serverOrigin = '';
  try {
    if (CURRENT_SCRIPT) serverOrigin = new URL(CURRENT_SCRIPT).origin;
  } catch (e) {}
  const API_BASE = window.DAP_SERVER_URL || serverOrigin || '';

  // Driver.js 및 런타임 CSS 자동 주입 보장
  function ensureAssets() {
    if (!document.getElementById('dap-runtime-css')) {
      const link = document.createElement('link');
      link.id = 'dap-runtime-css';
      link.rel = 'stylesheet';
      link.href = `${API_BASE}/runtime.css`;
      document.head.appendChild(link);
    }
    if (!document.getElementById('dap-driverjs-css')) {
      const link = document.createElement('link');
      link.id = 'dap-driverjs-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css';
      document.head.appendChild(link);
    }
    if (!window.driver || !window.driver.js) {
      if (!document.getElementById('dap-driverjs-script')) {
        const script = document.createElement('script');
        script.id = 'dap-driverjs-script';
        script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js';
        document.head.appendChild(script);
      }
    }
  }

  let toursCache = [];
  let currentDriver = null;

  // 초기화 (DOMContentLoaded 또는 이미 로드된 경우 즉시)
  function init() {
    ensureAssets();
    initRuntimeUI();
    fetchTours();

    window.addEventListener('dap:tours-updated', () => {
      fetchTours();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 전역 메서드로 외부 노출 (빌더에서 투어 실행 테스트 가능)
  window.DapRuntime = {
    startTourById: (tourId) => {
      const tour = toursCache.find(t => t.id === tourId);
      if (tour) {
        startTour(tour);
      } else {
        console.warn('[DAP Runtime] Tour not found:', tourId);
      }
    },
    startTourDirect: (tourData) => {
      startTour(tourData);
    },
    showWhatsNew: (tourId) => {
      const tour = tourId ? toursCache.find(t => t.id === tourId) : toursCache.find(t => t.type === 'whats-new');
      if (tour) {
        showWhatsNewModal(tour);
      }
    },
    refresh: () => {
      fetchTours();
    },
    resetHistory: resetGuideHistory
  };

  /**
   * 가이드 및 What's New 확인 기록 초기화
   */
  function resetGuideHistory() {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('dap_seen_')) {
          localStorage.removeItem(k);
        }
      });
      alert('가이드 및 What\'s New 확인 기록이 초기화되었습니다. 첫 방문 상태로 새로고침합니다.');
      window.location.reload();
    } catch (e) {
      console.error('[DAP Runtime] Error resetting guide history:', e);
    }
  }

  /**
   * 투어 목록 조회 API
   */
  async function fetchTours() {
    try {
      const currentPath = window.location.pathname || '/';
      const appId = window.DAP_APP_ID || 'default';
      let res = await fetch(`${API_BASE}/api/tours?url=${encodeURIComponent(currentPath)}&appId=${encodeURIComponent(appId)}`);
      let tours = [];
      if (res.ok) {
        tours = await res.json();
      }

      // 특정 페이지 쿼리로 조회된 결과가 없으면 전체 투어 조회를 fallback으로 시도하여 하위 호환 보장
      if (!tours || tours.length === 0) {
        const fallbackRes = await fetch(`${API_BASE}/api/tours?appId=${encodeURIComponent(appId)}`);
        if (fallbackRes.ok) {
          tours = await fallbackRes.json();
        }
      }

      toursCache = tours || [];
      renderTourListModal();
      checkAutoLaunchWhatsNew(toursCache);
    } catch (err) {
      console.error('[DAP Runtime] Error fetching tours:', err);
    }
  }

  /**
   * What's New 투어 자동 팝업 검사
   */
  function checkAutoLaunchWhatsNew(tours) {
    if (!Array.isArray(tours)) return;
    const tour = tours.find(t => {
      if (t.type !== 'whats-new' || t.autoLaunchOnce !== true) return false;
      try {
        return !localStorage.getItem('dap_seen_' + t.id);
      } catch (e) {
        return false;
      }
    });

    if (tour) {
      showWhatsNewModal(tour);
    }
  }

  /**
   * What's New 모달 표시
   */
  function showWhatsNewModal(tour) {
    let overlay = document.getElementById('dap-whatsnew-overlay');
    if (overlay) {
      overlay.remove();
    }

    const versionText = tour.version ? ` &bull; v${escapeHtml(tour.version)}` : '';

    overlay = document.createElement('div');
    overlay.id = 'dap-whatsnew-overlay';
    overlay.className = 'dap-runtime-element';
    overlay.innerHTML = `
      <div class="dap-whatsnew-modal dap-runtime-element">
        <div class="dap-whatsnew-header">
          <div class="dap-whatsnew-badge">🎉 WHAT'S NEW${versionText}</div>
          <button class="dap-whatsnew-close-btn" id="dap-whatsnew-close" title="닫기">&times;</button>
        </div>
        <div class="dap-whatsnew-body">
          <h2 class="dap-whatsnew-title">${escapeHtml(tour.title)}</h2>
          ${tour.description ? `<p class="dap-whatsnew-desc">${escapeHtml(tour.description)}</p>` : ''}
          
          <div class="dap-whatsnew-steps-preview">
            <div class="dap-whatsnew-steps-heading">주요 업데이트 내용</div>
            <div class="dap-whatsnew-step-list">
              ${(tour.steps || []).map((step, idx) => `
                <div class="dap-whatsnew-step-item">
                  <div class="dap-whatsnew-step-icon">${idx + 1}</div>
                  <div class="dap-whatsnew-step-info">
                    <span class="dap-whatsnew-step-title">${escapeHtml((step.popover && step.popover.title) || `기능 ${idx + 1}`)}</span>
                    ${(step.popover && step.popover.description) ? `<span class="dap-whatsnew-step-desc">${escapeHtml(step.popover.description)}</span>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="dap-whatsnew-footer">
          <button class="dap-whatsnew-btn-dismiss" id="dap-whatsnew-dismiss">다음에 보기</button>
          <button class="dap-whatsnew-btn-start" id="dap-whatsnew-start">
            <span>✨</span> 새로운 기능 둘러보기
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    const markSeenAndClose = () => {
      try {
        localStorage.setItem('dap_seen_' + tour.id, 'true');
      } catch (e) {}
      closeWhatsNewModal();
    };

    const closeWhatsNewModal = () => {
      overlay.classList.remove('active');
      setTimeout(() => {
        if (overlay && overlay.parentNode) {
          overlay.remove();
        }
      }, 300);
    };

    const startBtn = overlay.querySelector('#dap-whatsnew-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        markSeenAndClose();
        setTimeout(() => {
          startTour(tour);
        }, 150);
      });
    }

    const dismissBtn = overlay.querySelector('#dap-whatsnew-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        markSeenAndClose();
      });
    }

    const closeBtn = overlay.querySelector('#dap-whatsnew-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        markSeenAndClose();
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        markSeenAndClose();
      }
    });
  }

  /**
   * 런타임 UI (플로팅 버튼 및 모달) 생성
   */
  function initRuntimeUI() {
    // 1. 플로팅 헬프 버튼
    let helpBtn = document.getElementById('dap-help-button');
    if (!helpBtn) {
      helpBtn = document.createElement('button');
      helpBtn.id = 'dap-help-button';
      helpBtn.className = 'dap-runtime-element';
      helpBtn.innerHTML = `
        <span class="help-icon">?</span>
        <span>가이드 센터</span>
      `;
      document.body.appendChild(helpBtn);
    }

    // 2. 모달 오버레이 및 창
    let overlay = document.getElementById('dap-runtime-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dap-runtime-overlay';
      overlay.className = 'dap-runtime-element';
      overlay.innerHTML = `
        <div id="dap-runtime-modal" class="dap-runtime-element">
          <div class="dap-modal-header">
            <h3><span>🧭</span> 포털 이용 가이드</h3>
            <button class="dap-modal-close-btn" id="dap-modal-close" title="닫기">&times;</button>
          </div>
          <div class="dap-modal-body" id="dap-modal-body">
            <!-- 투어 카드들이 동적으로 렌더링됩니다 -->
          </div>
          <div class="dap-modal-footer">
            <button type="button" id="dap-modal-reset-history" class="btn-reset-history">🔄 가이드 확인 기록 초기화 (테스트용)</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    // 이벤트 리스너 바인딩
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal();
    });

    const closeBtn = document.getElementById('dap-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    const resetHistoryBtn = document.getElementById('dap-modal-reset-history');
    if (resetHistoryBtn) {
      resetHistoryBtn.addEventListener('click', resetGuideHistory);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });
  }

  function openModal() {
    const overlay = document.getElementById('dap-runtime-overlay');
    if (overlay) {
      renderTourListModal();
      overlay.classList.add('active');
    }
  }

  function closeModal() {
    const overlay = document.getElementById('dap-runtime-overlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
  }

  /**
   * 모달 내 투어 목록 렌더링
   */
  function renderTourListModal() {
    const modalBody = document.getElementById('dap-modal-body');
    if (!modalBody) return;

    if (!toursCache || toursCache.length === 0) {
      modalBody.innerHTML = `
        <div class="dap-empty-state">
          <div class="dap-empty-state-icon">📋</div>
          <p style="font-weight: 600; color: #1e293b;">등록된 가이드 투어가 없습니다.</p>
          <p style="font-size: 0.85rem;">상단의 [🛠️ 가이드 저작 모드]를 켜고 첫 번째 안내 가이드를 생성해 보세요!</p>
        </div>
      `;
      return;
    }

    modalBody.innerHTML = toursCache.map(tour => `
      <div class="dap-tour-card ${tour.type === 'whats-new' ? 'dap-tour-card-whatsnew' : ''}" data-tour-id="${tour.id}">
        <div class="dap-tour-header">
          <div class="dap-tour-title-wrap">
            <div class="dap-tour-title">${escapeHtml(tour.title)}</div>
            ${tour.type === 'whats-new' ? '<span class="badge-whatsnew">✨ What\'s New</span>' : ''}
          </div>
          <span class="dap-tour-badge">${tour.steps ? tour.steps.length : 0}단계 안내</span>
        </div>
        ${tour.description ? `<p class="dap-tour-desc">${escapeHtml(tour.description)}</p>` : ''}
        <div class="dap-tour-actions">
          <button class="dap-btn-delete" data-action="delete" data-tour-id="${tour.id}" title="투어 삭제">삭제</button>
          <button class="dap-btn-start" data-action="start" data-tour-id="${tour.id}">
            <span>▶</span> 투어 시작
          </button>
        </div>
      </div>
    `).join('');

    // 카드 내 버튼 이벤트 바인딩
    modalBody.querySelectorAll('[data-action="start"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-tour-id');
        const tour = toursCache.find(t => t.id === id);
        if (tour) {
          closeModal();
          startTour(tour);
        }
      });
    });

    modalBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-tour-id');
        if (confirm('정말로 이 가이드 투어를 삭제하시겠습니까?')) {
          await deleteTour(id);
        }
      });
    });
  }

  async function deleteTour(id) {
    try {
      const res = await fetch(`${API_BASE}/api/tours/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        toursCache = toursCache.filter(t => t.id !== id);
        renderTourListModal();
        window.dispatchEvent(new CustomEvent('dap:tours-updated'));
      } else {
        alert('투어 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('[DAP Runtime] Error deleting tour:', err);
    }
  }

  /**
   * Driver.js 기반 인터랙티브 투어 실행
   */
  function startTour(tour) {
    if (!tour || !Array.isArray(tour.steps) || tour.steps.length === 0) {
      alert('가이드에 유효한 단계(Step)가 없습니다.');
      return;
    }

    // Driver.js IIFE 라이브러리 검증
    const driverFactory = (window.driver && window.driver.js && window.driver.js.driver) ||
                          (typeof window.driver === 'function' ? window.driver : null);

    if (!driverFactory) {
      alert('Driver.js 라이브러리가 로드되지 않았습니다.');
      console.error('[DAP Runtime] Driver.js is missing');
      return;
    }

    // 이전 투어가 실행 중이면 정리
    if (currentDriver && typeof currentDriver.destroy === 'function') {
      try { currentDriver.destroy(); } catch (e) {}
    }

    const steps = tour.steps.map(s => {
      return {
        element: s.element,
        popover: {
          title: s.popover ? s.popover.title : '안내',
          description: s.popover ? s.popover.description : '',
          side: (s.popover && s.popover.side) || 'bottom',
          align: (s.popover && s.popover.align) || 'start'
        }
      };
    });

    try {
      currentDriver = driverFactory({
        showProgress: true,
        animate: true,
        nextBtnText: '다음 단계 →',
        prevBtnText: '← 이전',
        doneBtnText: '완료 ✨',
        steps: steps,
        onDestroyStarted: () => {
          if (currentDriver) {
            currentDriver.destroy();
            currentDriver = null;
          }
        }
      });

      currentDriver.drive();
    } catch (err) {
      console.error('[DAP Runtime] Error running Driver.js:', err);
      alert('가이드 투어 실행 중 오류가 발생했습니다: ' + err.message);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
