/**
 * DAP In-App No-Code Authoring Tool (Builder)
 */

(function () {
  'use strict';

  // API 서버 베이스 URL 자동 추론
  const CURRENT_SCRIPT = document.currentScript ? document.currentScript.src : '';
  let serverOrigin = '';
  try {
    if (CURRENT_SCRIPT) serverOrigin = new URL(CURRENT_SCRIPT).origin;
  } catch (e) {}
  const API_BASE = window.DAP_SERVER_URL || serverOrigin || '';

  function ensureBuilderCss() {
    if (!document.getElementById('dap-builder-css')) {
      const link = document.createElement('link');
      link.id = 'dap-builder-css';
      link.rel = 'stylesheet';
      link.href = `${API_BASE}/builder.css`;
      document.head.appendChild(link);
    }
  }

  // 상태 관리
  let isBuilderActive = false;
  let hoveredElement = null;
  let currentSelectedSelector = '';
  
  let currentTour = {
    title: '새로운 시스템 둘러보기 가이드',
    description: '화면의 주요 기능과 버튼 사용법을 안내합니다.',
    steps: []
  };

  function init() {
    ensureBuilderCss();
    initBuilderUI();
    bindGlobalEvents();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('builder') === 'true') {
      enableBuilder();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /**
   * 빌더 UI 요소들 (배너, 하이라이터, 드로어, 스텝 모달, 토스트) 생성 및 마운트
   */
  function initBuilderUI() {
    // 1. 상단 저작 모드 알림 배너
    const banner = document.createElement('div');
    banner.id = 'dap-builder-banner';
    banner.className = 'dap-builder-ui';
    banner.style.display = 'none';
    banner.innerHTML = `
      <div class="banner-text">
        <span class="banner-badge">AUTHORING MODE</span>
        <span>🛠️ 가이드 저작 모드 활성화 중 — 화면의 UI 요소를 마우스로 클릭하여 가이드 스텝을 추가하세요.</span>
      </div>
      <button class="banner-exit-btn" id="dap-banner-exit-btn">저작 모드 종료</button>
    `;
    document.body.appendChild(banner);

    // 2. 요소 하이라이터 박스
    const highlighter = document.createElement('div');
    highlighter.id = 'dap-element-highlighter';
    highlighter.className = 'dap-builder-ui';
    highlighter.innerHTML = `<span id="dap-element-tag-badge">#selector</span>`;
    document.body.appendChild(highlighter);

    // 3. 우측 고정 저작 드로어 (Drawer)
    const drawer = document.createElement('div');
    drawer.id = 'dap-builder-drawer';
    drawer.className = 'dap-builder-ui';
    drawer.innerHTML = `
      <div class="drawer-header">
        <h3><span>📐</span> 가이드 저작 드로어</h3>
        <button class="drawer-toggle-btn" id="dap-drawer-collapse-btn">접기</button>
      </div>

      <div class="drawer-body">
        <div class="drawer-field">
          <label for="dap-tour-title-input">투어 제목</label>
          <input type="text" id="dap-tour-title-input" class="drawer-input" value="${escapeHtml(currentTour.title)}" placeholder="예: 신규 대시보드 온보딩" />
        </div>

        <div class="drawer-field">
          <label for="dap-tour-desc-input">투어 설명 (선택)</label>
          <textarea id="dap-tour-desc-input" class="drawer-textarea" placeholder="이 가이드의 목적이나 대상을 설명하세요.">${escapeHtml(currentTour.description)}</textarea>
        </div>

        <div class="steps-container-header">
          <h4>가이드 단계 (Steps)</h4>
          <span class="steps-count-badge" id="dap-steps-count">0개 단계</span>
        </div>

        <div id="dap-builder-steps-list">
          <!-- 스텝 카드들이 렌더링됩니다 -->
        </div>
      </div>

      <div class="drawer-footer">
        <div class="drawer-btn-row">
          <button class="btn-drawer-preview" id="dap-btn-preview-tour">
            <span>▶</span> 미리보기
          </button>
          <button class="btn-drawer-save" id="dap-btn-save-tour">
            <span>💾</span> 서버에 저장
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);

    // 4. 스텝 에디터 모달 (Step Editor)
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'dap-step-modal-overlay';
    modalOverlay.className = 'dap-builder-ui';
    modalOverlay.innerHTML = `
      <div id="dap-step-modal" class="dap-builder-ui">
        <div class="modal-head">
          <h4><span>✨</span> 새 스텝 추가</h4>
          <button type="button" class="step-delete-btn" id="dap-step-modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>선택된 요소 CSS Selector</label>
            <input type="text" id="dap-step-selector-input" class="form-control" readonly />
          </div>

          <div class="form-group">
            <label for="dap-step-title-input">팝오버 제목 (Title) *</label>
            <input type="text" id="dap-step-title-input" class="form-control" placeholder="예: 상단 통합 검색창" />
          </div>

          <div class="form-group">
            <label for="dap-step-desc-input">팝오버 설명 (Description)</label>
            <textarea id="dap-step-desc-input" class="form-control" rows="3" placeholder="사용자가 이 기능을 어떻게 사용하는지 간결하게 안내하세요."></textarea>
          </div>

          <div class="form-group">
            <label for="dap-step-side-select">팝오버 노출 위치 (Side)</label>
            <select id="dap-step-side-select" class="form-control">
              <option value="bottom" selected>하단 (Bottom)</option>
              <option value="top">상단 (Top)</option>
              <option value="left">좌측 (Left)</option>
              <option value="right">우측 (Right)</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-modal-cancel" id="dap-step-cancel-btn">취소</button>
          <button type="button" class="btn-modal-submit" id="dap-step-submit-btn">스텝 추가</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalOverlay);

    // 5. 토스트 알림창
    const toast = document.createElement('div');
    toast.id = 'dap-toast';
    toast.className = 'dap-builder-ui';
    document.body.appendChild(toast);

    // UI 이벤트 바인딩
    document.getElementById('dap-banner-exit-btn').addEventListener('click', disableBuilder);
    document.getElementById('dap-drawer-collapse-btn').addEventListener('click', toggleDrawer);
    document.getElementById('dap-step-cancel-btn').addEventListener('click', closeStepModal);
    document.getElementById('dap-step-modal-close-btn').addEventListener('click', closeStepModal);
    document.getElementById('dap-step-submit-btn').addEventListener('click', handleAddStep);
    document.getElementById('dap-btn-preview-tour').addEventListener('click', handlePreviewTour);
    document.getElementById('dap-btn-save-tour').addEventListener('click', handleSaveTour);

    // 제목/설명 인풋 바인딩
    document.getElementById('dap-tour-title-input').addEventListener('input', (e) => {
      currentTour.title = e.target.value;
    });
    document.getElementById('dap-tour-desc-input').addEventListener('input', (e) => {
      currentTour.description = e.target.value;
    });

    renderStepsList();
  }

  /**
   * 전역 클릭 및 마우스 호버 이벤트
   */
  function bindGlobalEvents() {
    // 헤더 토글 버튼
    const toggleBtn = document.getElementById('btn-toggle-builder');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (isBuilderActive) {
          disableBuilder();
        } else {
          enableBuilder();
        }
      });
    }

    // 마우스 무브: 대상 요소 하이라이트
    document.addEventListener('mousemove', (e) => {
      if (!isBuilderActive) return;

      const target = e.target;
      if (isIgnoredElement(target)) {
        hideHighlighter();
        return;
      }

      hoveredElement = target;
      highlightElement(target);
    }, true);

    // 클릭 이벤트 가로채기 (캡처링 단계)
    document.addEventListener('click', (e) => {
      if (!isBuilderActive) return;

      const target = e.target;
      if (isIgnoredElement(target)) {
        return; // 빌더 UI 내부 클릭은 정상 허용
      }

      // 기본 동작 및 버블링 차단
      e.preventDefault();
      e.stopPropagation();

      const selector = generateUniqueSelector(target);
      currentSelectedSelector = selector;
      openStepModal(target, selector);
    }, true);

    // 윈도우 리사이즈 및 스크롤 시 하이라이터 재계산
    window.addEventListener('scroll', () => {
      if (isBuilderActive && hoveredElement) {
        highlightElement(hoveredElement);
      }
    }, true);
  }

  /**
   * 빌더 자체 UI 및 제외 대상 판별
   */
  function isIgnoredElement(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.closest('.dap-builder-ui')) return true;
    if (el.closest('.dap-runtime-element')) return true;
    if (el.closest('.driver-popover')) return true;
    if (el.closest('.driver-overlay')) return true;
    if (el.id === 'btn-toggle-builder') return true;
    return false;
  }

  /**
   * 저작 모드 활성화
   */
  function enableBuilder() {
    isBuilderActive = true;
    document.body.classList.add('dap-builder-active');

    const banner = document.getElementById('dap-builder-banner');
    if (banner) banner.style.display = 'flex';

    const drawer = document.getElementById('dap-builder-drawer');
    if (drawer) drawer.classList.add('open');

    const toggleBtn = document.getElementById('btn-toggle-builder');
    if (toggleBtn) {
      toggleBtn.innerHTML = '🛠️ 가이드 저작 모드 ON (종료)';
      toggleBtn.style.backgroundColor = '#dc2626';
    }

    showToast('🛠️ 가이드 저작 모드가 켜졌습니다. 요소를 클릭해 보세요.');
  }

  /**
   * 저작 모드 비활성화
   */
  function disableBuilder() {
    isBuilderActive = false;
    document.body.classList.remove('dap-builder-active');
    hideHighlighter();

    const banner = document.getElementById('dap-builder-banner');
    if (banner) banner.style.display = 'none';

    const drawer = document.getElementById('dap-builder-drawer');
    if (drawer) drawer.classList.remove('open');

    const toggleBtn = document.getElementById('btn-toggle-builder');
    if (toggleBtn) {
      toggleBtn.innerHTML = '🛠️ 가이드 저작 모드 OFF';
      toggleBtn.style.backgroundColor = '#4f46e5';
    }

    closeStepModal();
    showToast('저작 모드가 종료되었습니다.');
  }

  function toggleDrawer() {
    const drawer = document.getElementById('dap-builder-drawer');
    const collapseBtn = document.getElementById('dap-drawer-collapse-btn');
    if (drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      collapseBtn.textContent = '열기';
    } else {
      drawer.classList.add('open');
      collapseBtn.textContent = '접기';
    }
  }

  /**
   * 요소 하이라이트 박스 위치 및 크기 조정
   */
  function highlightElement(el) {
    const highlighter = document.getElementById('dap-element-highlighter');
    const badge = document.getElementById('dap-element-tag-badge');
    if (!highlighter || !badge) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    highlighter.style.display = 'block';
    highlighter.style.top = `${rect.top}px`;
    highlighter.style.left = `${rect.left}px`;
    highlighter.style.width = `${rect.width}px`;
    highlighter.style.height = `${rect.height}px`;

    const selector = generateUniqueSelector(el);
    badge.textContent = selector;
  }

  function hideHighlighter() {
    const highlighter = document.getElementById('dap-element-highlighter');
    if (highlighter) highlighter.style.display = 'none';
  }

  /**
   * 고유 CSS Selector 자동 추출 알고리즘
   */
  function generateUniqueSelector(el) {
    if (!el || !(el instanceof Element)) return '';

    // 1. 유효한 ID가 있는 경우
    if (el.id && typeof el.id === 'string' && el.id.trim()) {
      const escapedId = '#' + CSS.escape(el.id);
      try {
        if (document.querySelectorAll(escapedId).length === 1) {
          return escapedId;
        }
      } catch (e) {}
    }

    // 2. 단독 태그 + 클래스 확인
    const tagName = el.tagName.toLowerCase();
    const validClasses = Array.from(el.classList).filter(c => {
      return !c.startsWith('dap-') && !c.startsWith('driver-');
    });

    if (validClasses.length > 0) {
      const classSelector = tagName + '.' + validClasses.map(c => CSS.escape(c)).join('.');
      try {
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      } catch (e) {}
    }

    // 3. 계층형 경로 및 :nth-child를 통한 고유 셀렉터 생성
    const path = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        // ID가 유니크하면 경로 탐색 중단
        try {
          if (document.querySelectorAll(path.join(' > ')).length === 1) {
            return path.join(' > ');
          }
        } catch (e) {}
        break;
      }

      // 부모 내에서의 위치 (:nth-of-type 또는 :nth-child)
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);

      // 현재까지의 전체 경로가 유니크한지 테스트
      try {
        const testPath = path.join(' > ');
        if (document.querySelectorAll(testPath).length === 1) {
          return testPath;
        }
      } catch (e) {}

      current = current.parentElement;
    }

    return path.join(' > ') || tagName;
  }

  /**
   * 스텝 모달 열기/닫기
   */
  function openStepModal(el, selector) {
    const overlay = document.getElementById('dap-step-modal-overlay');
    const selectorInput = document.getElementById('dap-step-selector-input');
    const titleInput = document.getElementById('dap-step-title-input');
    const descInput = document.getElementById('dap-step-desc-input');
    const sideSelect = document.getElementById('dap-step-side-select');

    if (!overlay) return;

    selectorInput.value = selector;

    // 요소의 텍스트를 기본 제목 힌트로 활용
    let elText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (elText.length > 20) elText = elText.substring(0, 20) + '...';
    titleInput.value = elText ? `${elText} 안내` : '주요 기능 안내';
    descInput.value = '';
    sideSelect.value = 'bottom';

    overlay.classList.add('active');
    setTimeout(() => titleInput.focus(), 100);
  }

  function closeStepModal() {
    const overlay = document.getElementById('dap-step-modal-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  /**
   * 스텝 추가 핸들러
   */
  function handleAddStep() {
    const selector = document.getElementById('dap-step-selector-input').value.trim();
    const title = document.getElementById('dap-step-title-input').value.trim();
    const desc = document.getElementById('dap-step-desc-input').value.trim();
    const side = document.getElementById('dap-step-side-select').value;

    if (!title) {
      alert('스텝 제목을 입력해주세요.');
      return;
    }

    const newStep = {
      element: selector,
      popover: {
        title: title,
        description: desc,
        side: side,
        align: 'start'
      }
    };

    currentTour.steps.push(newStep);
    renderStepsList();
    closeStepModal();

    showToast(`✅ [${title}] 스텝이 추가되었습니다.`);
  }

  /**
   * 스텝 목록 UI 렌더링
   */
  function renderStepsList() {
    const listContainer = document.getElementById('dap-builder-steps-list');
    const countBadge = document.getElementById('dap-steps-count');
    if (!listContainer || !countBadge) return;

    countBadge.textContent = `${currentTour.steps.length}개 단계`;

    if (currentTour.steps.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-steps-notice">
          등록된 단계가 없습니다.<br>화면 요소를 클릭하여 스텝을 추가하세요!
        </div>
      `;
      return;
    }

    listContainer.innerHTML = currentTour.steps.map((step, idx) => `
      <div class="step-card" data-step-index="${idx}">
        <div class="step-card-header">
          <span class="step-number">Step ${idx + 1}</span>
          <span class="step-card-title">${escapeHtml(step.popover.title)}</span>
          <button class="step-delete-btn" data-action="delete-step" data-index="${idx}" title="스텝 삭제">&times;</button>
        </div>
        <div class="step-card-selector">${escapeHtml(step.element)}</div>
        ${step.popover.description ? `<div class="step-card-desc">${escapeHtml(step.popover.description)}</div>` : ''}
      </div>
    `).join('');

    // 개별 스텝 삭제 버튼 바인딩
    listContainer.querySelectorAll('[data-action="delete-step"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        currentTour.steps.splice(index, 1);
        renderStepsList();
        showToast('스텝이 삭제되었습니다.');
      });
    });
  }

  /**
   * 미리보기 핸들러
   */
  function handlePreviewTour() {
    if (currentTour.steps.length === 0) {
      alert('미리보기를 실행하려면 최소 1개 이상의 스텝을 추가해야 합니다.');
      return;
    }

    // Driver.js로 즉시 시연
    if (window.DapRuntime && typeof window.DapRuntime.startTourDirect === 'function') {
      window.DapRuntime.startTourDirect(currentTour);
    } else {
      alert('Driver.js 런타임을 찾을 수 없습니다.');
    }
  }

  /**
   * 서버에 투어 저장 핸들러 (POST /api/tours)
   */
  async function handleSaveTour() {
    const title = currentTour.title.trim();
    if (!title) {
      alert('투어 제목을 입력해주세요.');
      return;
    }

    if (currentTour.steps.length === 0) {
      alert('저장할 스텝이 없습니다. 최소 1개 이상의 스텝을 추가해주세요.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/tours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          description: currentTour.description,
          steps: currentTour.steps,
          target_url: window.location.pathname || '/',
          app_id: window.DAP_APP_ID || 'default'
        })
      });

      if (res.ok) {
        const saved = await res.json();
        showToast(`🎉 가이드 [${saved.title}] 저장이 완료되었습니다!`);
        // 런타임 목록 갱신 이벤트 전파
        window.dispatchEvent(new CustomEvent('dap:tours-updated'));
      } else {
        const err = await res.json();
        alert('저장 실패: ' + (err.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error('[DAP Builder] Error saving tour:', err);
      alert('서버 통신 중 오류가 발생했습니다.');
    }
  }

  /**
   * 토스트 알림 헬퍼
   */
  function showToast(msg) {
    const toast = document.getElementById('dap-toast');
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
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
