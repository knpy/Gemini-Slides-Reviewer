(() => {
  if (window.hasOwnProperty("__geminiSlidesInjected")) {
    return;
  }
  Object.defineProperty(window, "__geminiSlidesInjected", {
    value: true,
    configurable: false,
    writable: false
  });

  const clone = (value) => {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  };

  // ========================================
  // デバッグ設定
  // ========================================
  const DEBUG = false;  // 開発中はtrue、本番はfalse
  const debugLog = (...args) => {
    if (DEBUG) {
      console.log('[Gemini Slides DEBUG]', ...args);
    }
  };

  // ========================================
  // Phase 1: コアデータ構造
  // ========================================

  const STORAGE_KEYS_PROJECT = {
    PROJECTS: 'gemini_projects',
    URL_PROJECT_MAP: 'gemini_url_project_map'
  };

  const DEFAULT_PROJECT_STRUCTURE = {
    projectName: '',
    createdAt: null,
    weeklyInputDay: 1,  // デフォルト: 月曜日
    staticContext: {
      purpose: '',
      audience: '',
      kickoffUrl: ''  // Phase 6: キックオフURL
    },
    externalContexts: []
  };

  // ========================================
  // State
  // ========================================

  const state = {
    prompts: [],
    selectedPromptId: null,
    ui: {},
    feedbackItems: [],
    pinsBySlide: {},
    pinMode: {
      isActive: false,
      feedbackId: null
    },
    pinFeatureInitialized: false,
    pinOverlay: null,
    pinOverlayCanvas: null,
    pinOverlayPins: null,
    pinOverlayTargets: null,
    pinOverlayHint: null,
    pinSlideWatcher: null,
    pinResizeHandler: null,
    openPinId: null,
    lastRenderedSlideIndex: null,
    isPanelVisible: false,
    latestResult: null,
    isCancelled: false,
    isRunningBulkCapture: false,
    currentProjectId: null,  // 現在のプロジェクトID
    currentTab: 'review'  // 現在のタブ
  };

  let shadowRoot;

  document.addEventListener("readystatechange", () => {
    if (document.readyState === "complete") {
      initialize();
    }
  });

  if (document.readyState === "complete") {
    initialize();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "GEMINI_TOGGLE_PANEL") {
      togglePanel();
    }
    if (message?.type === "GEMINI_STREAM_CHUNK") {
      handleStreamChunk(message);
    }
    return false;
  });

  async function initialize() {
    if (shadowRoot) return;
    createPanelShell();
    await loadPrompts();
    bindUI();
    hydratePromptsUI();
    initializePinFeature();
    state.ui.runButton?.addEventListener("click", handleRunCheck);
    state.ui.runAllButton?.addEventListener("click", handleRunAllSlides);
    state.ui.promptSelect?.addEventListener("change", handlePromptSelection);
    state.ui.promptLabel?.addEventListener("input", markPromptDirty);
    state.ui.promptTextarea?.addEventListener("input", markPromptDirty);
    state.ui.savePromptButton?.addEventListener("click", persistPromptChanges);
    state.ui.resetPromptButton?.addEventListener("click", resetPromptToDefault);
    state.ui.addPromptButton?.addEventListener("click", addNewPrompt);
    state.ui.closeButton?.addEventListener("click", togglePanel);
    state.ui.openButton?.addEventListener("click", togglePanel);
    state.ui.feedbackFloatingButton?.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent event from bubbling to buttonGroup
      toggleFeedbackPopup();
    });
    state.ui.feedbackPopupList?.addEventListener("click", handleFeedbackPopupClick);

    // Initialize draggable functionality for feedback button group
    if (state.ui.feedbackButtonGroup) {
      initializeDraggableFeedbackButton(state.ui.feedbackButtonGroup);
    }

    // Close popup when clicking outside
    document.addEventListener("click", (event) => {
      if (!shadowRoot.contains(event.target)) return;
      const popup = state.ui.feedbackPopup;
      const button = state.ui.feedbackFloatingButton;
      if (!popup || !button) return;
      if (!popup.contains(event.target) && !button.contains(event.target) && popup.classList.contains("visible")) {
        toggleFeedbackPopup();
      }
    });

    // Phase 2: Tab switching
    state.ui.tabButtons?.forEach(button => {
      button.addEventListener("click", handleTabSwitch);
    });

    // Phase 2: Context management
    state.ui.saveContextButton?.addEventListener("click", handleSaveContext);
    state.ui.staticContextToggle?.addEventListener("click", handleToggleStaticContext);

    // Phase 2: Project selector
    state.ui.projectSelect?.addEventListener("change", handleProjectSwitch);

    // Project delete button
    const deleteProjectButton = shadowRoot.querySelector('#delete-project-button');
    deleteProjectButton?.addEventListener("click", handleDeleteProject);

    // Phase 6: Extract from kickoff URL button
    const extractFromKickoffButton = shadowRoot.querySelector('#extract-from-kickoff-button');
    extractFromKickoffButton?.addEventListener("click", handleExtractFromKickoff);

    // Phase 2: Load project data
    await loadCurrentProject();

    // Phase 3: Project auto-detection
    await detectProjectOnLoad();

    // Phase 4: Update context indicator
    await updateContextIndicator();

    // Phase 3: Start periodic maintenance
    startPeriodicMaintenance();

    // Phase 5: Initialize keyboard shortcuts
    initializeKeyboardShortcuts();

    // Phase 5: Show weekly input reminder
    await showWeeklyInputReminder();

    // Try to restore last selected prompt for convenience
    const stored = await chrome.storage.sync.get("geminiLastPromptId");
    if (stored?.geminiLastPromptId) {
      selectPromptById(stored.geminiLastPromptId);
    } else if (state.prompts[0]) {
      selectPromptById(state.prompts[0].id);
    }
  }

  function createPanelShell() {
    const host = document.createElement("div");
    host.id = "gemini-slides-helper-root";
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .gemini-floating-button {
          position: fixed;
          right: 16px;
          bottom: 16px;
          background: #fff;
          border: none;
          border-radius: 50%;
          width: 64px;
          height: 64px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 20px rgba(0,0,0,0.15);
          cursor: pointer;
          z-index: 2147483646;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .gemini-floating-button:hover {
          transform: scale(1.05);
          box-shadow: 0 12px 28px rgba(0,0,0,0.2);
        }
        .gemini-floating-button img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }
        .feedback-button-group {
          position: fixed;
          right: 16px;
          bottom: 104px;
          width: 56px;
          height: 56px;
          cursor: grab;
          z-index: 2147483646;
          user-select: none;
          -webkit-user-select: none;
        }
        .feedback-button-group:active {
          cursor: grabbing;
        }
        .gemini-icon-large {
          position: absolute;
          top: 0;
          left: 0;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          box-shadow: 0 6px 16px rgba(138,180,248,0.3);
          object-fit: cover;
          pointer-events: none;
        }
        .feedback-floating-button {
          position: absolute;
          top: -4px;
          left: -4px;
          background: #8ab4f8;
          border: 2px solid white;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          cursor: pointer;
          font-size: 12px;
          z-index: 1;
        }
        .feedback-floating-button:hover {
          transform: scale(1.1);
        }
        .feedback-popup {
          position: fixed;
          right: 16px;
          bottom: 160px;
          width: 320px;
          max-height: 400px;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          z-index: 2147483645;
          opacity: 0;
          transform: translateY(20px) scale(0.95);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .feedback-popup.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        .feedback-popup-header {
          padding: 16px;
          border-bottom: 1px solid rgba(0,0,0,0.08);
          font-weight: 600;
          font-size: 14px;
          color: #202124;
        }
        .feedback-popup-list {
          list-style: none;
          padding: 0;
          margin: 0;
          overflow-y: auto;
          flex: 1;
        }
        .feedback-popup-item {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(0,0,0,0.06);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .feedback-popup-item:hover {
          background: rgba(138,180,248,0.08);
        }
        .feedback-popup-item:last-child {
          border-bottom: none;
        }
        .feedback-popup-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .feedback-popup-item-title {
          font-size: 13px;
          font-weight: 600;
          color: #202124;
          flex: 1;
        }
        .feedback-popup-item-badge {
          font-size: 11px;
          color: #5f6368;
          background: rgba(0,0,0,0.05);
          padding: 2px 8px;
          border-radius: 10px;
          margin-left: 8px;
        }
        .feedback-popup-item-badge.pinned {
          color: #8ab4f8;
          background: rgba(138,180,248,0.12);
        }
        .feedback-popup-item-summary {
          font-size: 12px;
          color: #5f6368;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .feedback-popup-empty {
          padding: 32px 16px;
          text-align: center;
          font-size: 13px;
          color: #9aa0a6;
        }
        .gemini-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 360px;
          max-width: 90vw;
          height: 100vh;
          background: #202124;
          color: #e8eaed;
          box-shadow: -2px 0 12px rgba(0,0,0,0.3);
          transform: translateX(100%);
          transition: transform 0.25s ease-in-out;
          display: flex;
          flex-direction: column;
          z-index: 2147483647;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;
        }
        .gemini-panel.visible {
          transform: translateX(0);
        }
        .gemini-panel header {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .gemini-panel header .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .gemini-panel header h1 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        .gemini-panel header .header-top button {
          background: transparent;
          border: none;
          color: #9aa0a6;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .gemini-panel header .header-top button:hover {
          color: #fff;
        }
        .project-selector {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .project-selector label {
          font-size: 12px;
          color: #9aa0a6;
          margin: 0;
          white-space: nowrap;
          text-transform: none;
          letter-spacing: normal;
        }
        .project-selector select {
          flex: 1;
          background: #2d2e30;
          border: 1px solid rgba(138,180,248,0.3);
          border-radius: 6px;
          color: #e8eaed;
          padding: 6px 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .project-selector select:hover {
          border-color: rgba(138,180,248,0.5);
          background: rgba(138,180,248,0.05);
        }
        .project-selector select:focus {
          outline: none;
          border-color: #8ab4f8;
          background: rgba(138,180,248,0.08);
        }
        .project-selector select option {
          background: #2d2e30;
          color: #e8eaed;
        }
        .delete-project-button {
          background: transparent;
          border: 1px solid rgba(255, 68, 68, 0.3);
          color: #ff4444;
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          transition: all 0.2s;
          line-height: 1;
        }
        .delete-project-button:hover {
          background: rgba(255, 68, 68, 0.1);
          border-color: rgba(255, 68, 68, 0.5);
        }
        .delete-project-button:active {
          background: rgba(255, 68, 68, 0.2);
        }
        .gemini-panel main {
          padding: 16px;
          flex: 1;
          overflow-y: auto;
        }
        label {
          display: block;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #9aa0a6;
          margin-bottom: 6px;
        }
        select, input, textarea {
          width: 100%;
          background: #2d2e30;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          color: #e8eaed;
          padding: 8px;
          font-size: 14px;
          box-sizing: border-box;
          font-family: inherit;
        }
        textarea {
          min-height: 140px;
          resize: vertical;
        }
        .field {
          margin-bottom: 16px;
        }
        .button-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .button {
          flex: 1;
          background: #3b82f6;
          border: none;
          border-radius: 6px;
          padding: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          color: #fff;
          text-align: center;
        }
        .button.secondary {
          background: #3c4043;
        }
        .button.danger {
          background: #d93025;
        }
        .button:disabled {
          opacity: 0.65;
          cursor: progress;
        }
        .button.cancel {
          background: #f59e0b;
        }
        .button.cancel:hover {
          background: #d97706;
        }
        .button.tertiary {
          flex: 0;
          background: rgba(138,180,248,0.12);
          border: 1px solid rgba(138,180,248,0.3);
          color: #8ab4f8;
          font-size: 12px;
          padding: 6px 12px;
        }
        .button.tertiary:hover {
          background: rgba(138,180,248,0.2);
          border-color: rgba(138,180,248,0.5);
        }
        .button.tertiary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .progress-bar {
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
          overflow: hidden;
          margin-top: 8px;
          display: none;
        }
        .progress-bar.visible {
          display: block;
        }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8ab4f8);
          transition: width 0.3s ease;
          width: 0%;
        }
        .status {
          margin-top: 12px;
          font-size: 13px;
          line-height: 1.4;
          white-space: pre-wrap;
          background: rgba(138,180,248,0.06);
          border-radius: 6px;
          padding: 12px;
        }
        .status.error {
          background: rgba(217,48,37,0.12);
          border: 1px solid rgba(217,48,37,0.3);
        }
        .status.success {
          border: 1px solid rgba(138, 180, 248, 0.45);
        }
        .status.empty {
          background: rgba(154,160,166,0.1);
          border: 1px dashed rgba(154,160,166,0.4);
        }
        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(138, 180, 248, 0.3);
          border-top-color: #8ab4f8;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        }
        .status.streaming {
          border: 1px solid rgba(138, 180, 248, 0.45);
          background: rgba(138,180,248,0.08);
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .screenshot-preview {
          max-width: 100%;
          max-height: 200px;
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.2);
        }
        .screenshot-preview img {
          max-width: 100%;
          max-height: 200px;
          object-fit: contain;
        }
        .screenshot-preview.empty {
          color: #9aa0a6;
          font-size: 12px;
          padding: 20px;
        }
        .tab-nav {
          display: flex;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          padding: 0 16px;
        }
        .tab-button {
          background: transparent;
          border: none;
          color: #9aa0a6;
          padding: 12px 16px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
        }
        .tab-button:hover {
          color: #e8eaed;
        }
        .tab-button.active {
          color: #8ab4f8;
          border-bottom-color: #8ab4f8;
        }
        .tab-content {
          display: none;
        }
        .tab-content.active {
          display: block;
        }
        .project-name {
          background: rgba(138,180,248,0.1);
          border: 1px solid rgba(138,180,248,0.3);
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13px;
          color: #8ab4f8;
          margin-bottom: 16px;
        }
        .context-section {
          margin-bottom: 24px;
        }
        .context-section-title {
          font-size: 13px;
          font-weight: 600;
          color: #e8eaed;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }
        .context-section-title:hover {
          color: #8ab4f8;
        }
        .toggle-icon {
          font-size: 18px;
          transition: transform 0.2s;
        }
        .toggle-icon.collapsed {
          transform: rotate(-90deg);
        }
        .context-section-content {
          max-height: 1000px;
          overflow: hidden;
          transition: max-height 0.3s ease-out, opacity 0.3s ease-out;
          opacity: 1;
        }
        .context-section-content.collapsed {
          max-height: 0;
          opacity: 0;
        }
        .weekly-input {
          background: rgba(138,180,248,0.05);
          border: 1px dashed rgba(138,180,248,0.3);
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 6px;
        }
        .weekly-input-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .weekly-input-date {
          font-size: 12px;
          color: #9aa0a6;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          transition: all 0.2s;
          position: relative;
        }
        .weekly-input-date:hover {
          background: rgba(138,180,248,0.1);
          color: #8ab4f8;
        }
        .weekly-input-date:hover::after {
          content: '✎';
          margin-left: 6px;
          font-size: 10px;
          opacity: 0.7;
        }
        .weekly-input-date.editing {
          background: #2d2e30;
          border: 1px solid rgba(138,180,248,0.5);
          color: #e8eaed;
          padding: 2px 6px;
        }
        .date-input {
          background: #2d2e30;
          border: 1px solid rgba(138,180,248,0.5);
          border-radius: 4px;
          color: #e8eaed;
          font-size: 12px;
          padding: 2px 6px;
          font-family: inherit;
        }
        textarea.weekly-textarea {
          min-height: 80px;
          background: #2d2e30;
        }
        .weekly-add-zone {
          position: relative;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.2s;
          margin-bottom: 6px;
        }
        .weekly-add-zone:hover {
          opacity: 1;
        }
        .weekly-add-zone::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: rgba(138,180,248,0.2);
        }
        .weekly-add-button {
          position: relative;
          background: #2d2e30;
          border: 1px solid rgba(138,180,248,0.3);
          color: #8ab4f8;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }
        .weekly-add-button:hover {
          background: rgba(138,180,248,0.1);
          border-color: rgba(138,180,248,0.6);
          transform: scale(1.1);
        }
        .remove-weekly-button {
          background: transparent;
          border: none;
          color: #9aa0a6;
          font-size: 16px;
          cursor: pointer;
          padding: 4px;
        }
        .remove-weekly-button:hover {
          color: #d93025;
        }
        .context-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(138, 180, 248, 0.08);
          border: 1px solid rgba(138, 180, 248, 0.2);
          border-radius: 6px;
          margin-bottom: 12px;
          font-size: 12px;
        }
        .context-indicator .indicator-icon {
          font-size: 16px;
        }
        .context-indicator .indicator-text {
          color: #9aa0a6;
        }
        .context-indicator.active .indicator-text {
          color: #8ab4f8;
        }
        /* Phase 3: プロジェクト紐付けダイアログ */
        .project-linking-dialog .dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 2147483646;
        }
        .project-linking-dialog .dialog-content {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #2d2e30;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          z-index: 2147483647;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .project-linking-dialog h2 {
          margin: 0 0 16px 0;
          font-size: 18px;
          color: #e8eaed;
        }
        .project-linking-dialog p {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #9aa0a6;
          line-height: 1.5;
        }
        .project-options {
          margin: 20px 0;
        }
        .project-option {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          margin-bottom: 8px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .project-option:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(138, 180, 248, 0.3);
        }
        .project-option input[type="radio"] {
          margin: 0;
          cursor: pointer;
        }
        .project-option span {
          flex: 1;
          font-size: 14px;
          color: #e8eaed;
        }
        .project-option small {
          font-size: 11px;
          color: #9aa0a6;
        }
        .dialog-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
        }
        /* Phase 5: リマインダー通知 */
        .reminder-notification {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(251, 188, 4, 0.15);
          border-bottom: 1px solid rgba(251, 188, 4, 0.3);
          padding: 12px;
        }
        .reminder-content {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .reminder-icon {
          font-size: 16px;
        }
        .reminder-text {
          flex: 1;
          color: #fdd663;
        }
        .reminder-action {
          background: #fbbc04;
          color: #202124;
          border: none;
          border-radius: 4px;
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .reminder-action:hover {
          background: #f9ab00;
        }
        .reminder-dismiss {
          background: transparent;
          border: none;
          color: #9aa0a6;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          width: 24px;
        }
        /* Phase 6: プロジェクト作成ダイアログ */
        .create-project-dialog .dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          z-index: 2147483646;
        }
        .create-project-dialog .dialog-content {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #2d2e30;
          border: 1px solid #5f6368;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          min-width: 500px;
          max-width: 600px;
          z-index: 2147483647;
        }
        .create-project-dialog .dialog-title {
          font-size: 18px;
          font-weight: 600;
          color: #e8eaed;
          margin-bottom: 20px;
        }
        .create-project-dialog .form-group {
          margin-bottom: 16px;
        }
        .create-project-dialog .form-label {
          display: block;
          font-size: 13px;
          color: #9aa0a6;
          margin-bottom: 6px;
        }
        .create-project-dialog .form-input {
          width: 100%;
          background: #1e1f20;
          border: 1px solid #5f6368;
          border-radius: 6px;
          color: #e8eaed;
          padding: 10px 12px;
          font-size: 14px;
          box-sizing: border-box;
        }
        .create-project-dialog .form-input:focus {
          outline: none;
          border-color: #8ab4f8;
        }
        .create-project-dialog .form-hint {
          font-size: 11px;
          color: #9aa0a6;
          margin-top: 4px;
        }
        .extract-button {
          background: #1a73e8;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
        }
        .extract-button:hover {
          background: #1557b0;
        }
        .extract-button:disabled {
          background: #3c4043;
          color: #5f6368;
          cursor: not-allowed;
        }
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.3);
          z-index: 2147483648;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .loading-content {
          background: #2d2e30;
          border: 1px solid #5f6368;
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          min-width: 300px;
        }
        .loading-spinner {
          width: 48px;
          height: 48px;
          border: 4px solid #3c4043;
          border-top-color: #8ab4f8;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loading-text {
          color: #e8eaed;
          font-size: 14px;
          height: 24px;
        }
        .reminder-dismiss:hover {
          color: #e8eaed;
        }
        /* Phase 5: ストレージ情報 */
        .storage-info {
          margin-top: 16px;
          padding: 12px;
          background: rgba(255,255,255,0.02);
          border-radius: 6px;
          text-align: center;
        }
        .storage-info small {
          color: #9aa0a6;
          font-size: 11px;
        }
      </style>
      <div class=\"feedback-button-group\">
        <img id=\"gemini-icon-large\" src=\"\" alt=\"Gemini icon\" class=\"gemini-icon-large\" />
        <button class=\"feedback-floating-button\" aria-haspopup=\"true\" aria-label=\"フィードバック一覧\" title=\"けんしろうAIからの指摘を表示\">
          💬
        </button>
      </div>
      <div class=\"feedback-popup\" role=\"dialog\" aria-label=\"フィードバック一覧\">
        <div class=\"feedback-popup-header\">けんしろうAIからの指摘</div>
        <ul class=\"feedback-popup-list\" id=\"feedback-popup-list\"></ul>
        <div class=\"feedback-popup-empty\" id=\"feedback-popup-empty\">
          レビューを実行すると指摘がここに表示されます
        </div>
      </div>
      <section class=\"gemini-panel\" role=\"complementary\" aria-label=\"けんしろうAI\">
        <header>
          <div class=\"header-top\">
            <h1>けんしろうAI</h1>
            <button type=\"button\" aria-label=\"Close panel\">×</button>
          </div>
          <div class=\"project-selector\">
            <label for=\"gemini-project-select\">📁 Project:</label>
            <select id=\"gemini-project-select\">
              <option value=\"\">Loading...</option>
            </select>
            <button class=\"delete-project-button\" id=\"delete-project-button\" title=\"Delete current project\">🗑️</button>
          </div>
        </header>
        <nav class=\"tab-nav\">
          <button class=\"tab-button active\" data-tab=\"review\">レビュー</button>
          <button class=\"tab-button\" data-tab=\"context\">コンテキスト</button>
        </nav>
        <main>
          <!-- レビュータブ -->
          <div class=\"tab-content active\" data-tab-content=\"review\">
            <div class=\"context-indicator\" id=\"context-indicator\">
              <span class=\"indicator-icon\">📋</span>
              <span class=\"indicator-text\">Context: None</span>
            </div>
            <div class=\"field\">
              <label for=\"gemini-prompt-select\">Prompt preset</label>
              <select id=\"gemini-prompt-select\"></select>
            </div>
            <div class=\"field\">
              <label for=\"gemini-prompt-label\">Prompt name</label>
              <input id=\"gemini-prompt-label\" type=\"text\" placeholder=\"Clarity review\" />
            </div>
            <div class=\"field\">
              <label for=\"gemini-prompt-text\">Prompt text</label>
              <textarea id=\"gemini-prompt-text\"></textarea>
            </div>
            <div class=\"button-row\">
              <button class=\"button\" id=\"gemini-run-button\">現在のスライドを分析</button>
              <button class=\"button\" id=\"gemini-run-all-button\">全スライドを分析</button>
            </div>
            <section class=\"field\">
              <label>Screenshot</label>
              <div id=\"gemini-screenshot-preview\" class=\"screenshot-preview\"></div>
            </section>
          <section class=\"field\">
            <label>Result</label>
            <div id=\"gemini-result\" class=\"status empty\">No checks run yet.</div>
          </section>
        </div>

        <!-- コンテキストタブ -->
        <div class=\"tab-content\" data-tab-content=\"context\">
            <div class=\"context-section\">
              <div class=\"context-section-title\" data-toggle=\"static-context\">
                <span>Project Context</span>
                <span class=\"toggle-icon\">▼</span>
              </div>
              <div class=\"context-section-content\" id=\"static-context-content\">
                <div class=\"field\">
                  <label for=\"gemini-context-purpose\">Purpose</label>
                  <textarea id=\"gemini-context-purpose\" placeholder=\"このプレゼンテーションの目的を入力してください\"></textarea>
                </div>
                <div class=\"field\">
                  <label for=\"gemini-context-audience\">Audience</label>
                  <textarea id=\"gemini-context-audience\" placeholder=\"想定される聴衆を入力してください\"></textarea>
                </div>
                <button class=\"extract-button\" id=\"extract-from-kickoff-button\" style=\"width: 100%;\">
                  🔗 キックオフURLから取得
                </button>
              </div>
            </div>

            <div class=\"context-section\">
              <div class=\"context-section-title\">Weekly Updates</div>
              <div id=\"weekly-contexts-container\"></div>
            </div>

            <div class=\"button-row\">
              <button class=\"button\" id=\"gemini-save-context\">コンテキストを保存</button>
            </div>

            <div class=\"storage-info\" id=\"storage-info\">
              <small>Storage: Calculating...</small>
            </div>
          </div>
        </main>
      </section>
    `;
  }

  async function loadPrompts() {
    try {
      const module = await import(chrome.runtime.getURL("src/common/prompts.js"));
      const stored = await chrome.storage.sync.get(module.STORAGE_KEYS.PROMPTS);
      const storedPrompts = stored?.[module.STORAGE_KEYS.PROMPTS];
      state.prompts = Array.isArray(storedPrompts) && storedPrompts.length > 0
        ? clone(storedPrompts)
        : clone(module.DEFAULT_PROMPTS);
      state.defaultPrompts = clone(module.DEFAULT_PROMPTS);
      state.storageKeys = module.STORAGE_KEYS;
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        console.warn("Extension context invalidated. Please reload the page.");
      }
      throw error;
    }
  }

  function bindUI() {
    state.ui.openButton = shadowRoot.querySelector(".feedback-button-group");
    state.ui.panel = shadowRoot.querySelector(".gemini-panel");
    state.ui.closeButton = shadowRoot.querySelector("header button");
    state.ui.promptSelect = shadowRoot.querySelector("#gemini-prompt-select");
    state.ui.promptLabel = shadowRoot.querySelector("#gemini-prompt-label");
    state.ui.promptTextarea = shadowRoot.querySelector("#gemini-prompt-text");
    state.ui.runButton = shadowRoot.querySelector("#gemini-run-button");
    state.ui.runAllButton = shadowRoot.querySelector("#gemini-run-all-button");
    state.ui.savePromptButton = shadowRoot.querySelector("#gemini-save-prompt");
    state.ui.addPromptButton = shadowRoot.querySelector("#gemini-add-prompt");
    state.ui.resetPromptButton = shadowRoot.querySelector("#gemini-reset-prompt");
    state.ui.result = shadowRoot.querySelector("#gemini-result");
    state.ui.screenshotPreview = shadowRoot.querySelector("#gemini-screenshot-preview");

    // Feedback popup elements
    state.ui.feedbackButtonGroup = shadowRoot.querySelector(".feedback-button-group");
    state.ui.feedbackFloatingButton = shadowRoot.querySelector(".feedback-floating-button");
    state.ui.feedbackPopup = shadowRoot.querySelector(".feedback-popup");
    state.ui.feedbackPopupList = shadowRoot.querySelector("#feedback-popup-list");
    state.ui.feedbackPopupEmpty = shadowRoot.querySelector("#feedback-popup-empty");

    if (state.ui.feedbackPopupEmpty) {
      state.ui.feedbackPopupEmpty.hidden = false;
    }
    if (state.ui.feedbackPopupList) {
      state.ui.feedbackPopupList.hidden = true;
    }

    // Phase 2: Context tab elements
    state.ui.tabButtons = shadowRoot.querySelectorAll(".tab-button");
    state.ui.tabContents = shadowRoot.querySelectorAll(".tab-content");
    state.ui.projectSelect = shadowRoot.querySelector("#gemini-project-select");
    state.ui.contextPurpose = shadowRoot.querySelector("#gemini-context-purpose");
    state.ui.contextAudience = shadowRoot.querySelector("#gemini-context-audience");
    state.ui.weeklyContextsContainer = shadowRoot.querySelector("#weekly-contexts-container");
    state.ui.saveContextButton = shadowRoot.querySelector("#gemini-save-context");
    state.ui.staticContextToggle = shadowRoot.querySelector("[data-toggle='static-context']");
    state.ui.staticContextContent = shadowRoot.querySelector("#static-context-content");

    // Set icon image URL dynamically
    const iconImg = shadowRoot.querySelector("#gemini-icon-img");
    if (iconImg) {
      iconImg.src = chrome.runtime.getURL('assets/gemini-icon.png');
    }

    const geminiIconLarge = shadowRoot.querySelector("#gemini-icon-large");
    if (geminiIconLarge) {
      geminiIconLarge.src = chrome.runtime.getURL('assets/gemini-icon.png');
    }
  }

  function hydratePromptsUI() {
    if (!state.ui.promptSelect) return;
    state.ui.promptSelect.innerHTML = "";
    state.prompts.forEach((prompt) => {
      const option = document.createElement("option");
      option.value = prompt.id;
      option.textContent = prompt.label;
      state.ui.promptSelect.appendChild(option);
    });
  }

  function selectPromptById(id) {
    const prompt = state.prompts.find((p) => p.id === id);
    if (!prompt) return;
    state.selectedPromptId = prompt.id;
    if (state.ui.promptSelect) {
      state.ui.promptSelect.value = prompt.id;
    }
    setPromptFields(prompt);
    markPromptClean();
    chrome.storage.sync.set({ [state.storageKeys.LAST_PROMPT_ID]: prompt.id }).catch((error) => {
      if (!error.message?.includes("Extension context invalidated")) {
        console.error("Failed to save last prompt ID:", error);
      }
    });
  }

  function setPromptFields(prompt) {
    if (state.ui.promptLabel) {
      state.ui.promptLabel.value = prompt.label;
    }
    if (state.ui.promptTextarea) {
      state.ui.promptTextarea.value = prompt.prompt;
    }
  }

  function handlePromptSelection(event) {
    selectPromptById(event.target.value);
  }

  async function persistPromptChanges() {
    if (!state.selectedPromptId) return;
    const index = state.prompts.findIndex((p) => p.id === state.selectedPromptId);
    if (index === -1) return;
    state.prompts[index] = {
      ...state.prompts[index],
      label: state.ui.promptLabel.value.trim() || state.prompts[index].label,
      prompt: state.ui.promptTextarea.value.trim()
    };
    try {
      await chrome.storage.sync.set({
        [state.storageKeys.PROMPTS]: state.prompts
      });
      hydratePromptsUI();
      selectPromptById(state.selectedPromptId);
      markPromptClean();
      setStatus("Prompt updated.", "success");
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        setStatus("Extension was reloaded. Please refresh the page.", "error");
      } else {
        setStatus("Failed to save: " + error.message, "error");
      }
    }
  }

  async function resetPromptToDefault() {
    if (!state.selectedPromptId) return;
    const defaultPrompt = state.defaultPrompts.find((p) => p.id === state.selectedPromptId);
    if (!defaultPrompt) {
      setStatus("No default prompt to reset to.", "error");
      return;
    }
    const index = state.prompts.findIndex((p) => p.id === state.selectedPromptId);
    if (index !== -1) {
      state.prompts[index] = clone(defaultPrompt);
      await persistPromptChanges();
    }
  }

  function addNewPrompt() {
    const baseId = (state.ui.promptLabel.value.trim() || "custom").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let uniqueId = baseId || "custom";
    let counter = 1;
    while (state.prompts.some((prompt) => prompt.id === uniqueId)) {
      uniqueId = `${baseId || "custom"}-${counter++}`;
    }
    const newPrompt = {
      id: uniqueId,
      label: state.ui.promptLabel.value.trim() || "Custom prompt",
      prompt: state.ui.promptTextarea.value.trim()
    };
    state.prompts.push(newPrompt);
    chrome.storage.sync.set({
      [state.storageKeys.PROMPTS]: state.prompts
    }).then(() => {
      hydratePromptsUI();
      selectPromptById(newPrompt.id);
      setStatus("Prompt duplicated. Update the text and save to keep changes.", "success");
    }).catch((error) => {
      if (error.message?.includes("Extension context invalidated")) {
        setStatus("Extension was reloaded. Please refresh the page.", "error");
      } else {
        setStatus("Failed to save prompt: " + error.message, "error");
      }
    });
  }

  function markPromptDirty() {
    if (!state.ui.savePromptButton) return;
    state.ui.savePromptButton.disabled = false;
  }

  function markPromptClean() {
    if (!state.ui.savePromptButton) return;
    state.ui.savePromptButton.disabled = true;
  }

  function togglePanel() {
    state.isPanelVisible = !state.isPanelVisible;
    if (state.ui.panel) {
      if (state.isPanelVisible) {
        state.ui.panel.classList.add("visible");
      } else {
        state.ui.panel.classList.remove("visible");
      }
    }
  }

  async function handleRunCheck() {
    if (!state.selectedPromptId) {
      setStatus("Select a prompt preset first.", "error");
      return;
    }
    if (!state.ui.runButton) return;
    state.ui.runButton.disabled = true;

    // Show loading state with spinner
    setStatusWithSpinner("Collecting slide content…", "info");

    try {
      const presentationSummary = await collectPresentationSummary();

      console.log('[Gemini Slides] Presentation summary:', presentationSummary);

      if (!presentationSummary || !presentationSummary.slides || presentationSummary.slides.length === 0) {
        throw new Error("Unable to collect slide content. Try focusing a slide and run again.");
      }

      const hasScreenshot = presentationSummary.slides[0]?.screenshot;
      console.log('[Gemini Slides] Has screenshot:', !!hasScreenshot, hasScreenshot ? `(${hasScreenshot.length} chars)` : '');

      // Display screenshot preview
      if (hasScreenshot && state.ui.screenshotPreview) {
        state.ui.screenshotPreview.innerHTML = `<img src="${hasScreenshot}" alt="Slide screenshot" />`;
      } else if (state.ui.screenshotPreview) {
        state.ui.screenshotPreview.className = 'screenshot-preview empty';
        state.ui.screenshotPreview.textContent = 'No screenshot available';
      }

      setStatusWithSpinner("Analyzing with Gemini…\n\n", "streaming");
      state.latestResult = { text: "" };

      // Phase 4: コンテキスト統合
      const contextPrompt = await buildContextPrompt();

      // ユーザーが選択したプロンプトとコンテキストを結合
      const userPrompt = state.ui.promptTextarea.value.trim();
      const basePrompt = contextPrompt
        ? `${contextPrompt}[レビュー依頼]\n${userPrompt}\n\n以下のスライドを、上記のコンテキストを踏まえてレビューしてください。`
        : userPrompt;
      const finalPrompt = appendFeedbackFormatInstructions(basePrompt);

      console.log('[Gemini Slides] Full prompt with context:', finalPrompt);

      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK",
        payload: {
          prompt: finalPrompt,  // 位置情報フォーマット込みプロンプト
          presentationSummary
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Gemini request failed.");
      }

      state.latestResult = response.result;
      renderResult();
    } catch (error) {
      console.error('[Gemini Slides] Error in handleRunCheck:', error);
      if (error.message?.includes("Extension context invalidated")) {
        setStatus("Extension was reloaded. Please refresh the page to continue.", "error");
      } else {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      state.ui.runButton.disabled = false;
    }
  }

  async function handleRunAllSlides() {
    if (!state.selectedPromptId) {
      setStatus("プリセットを選択してください", "error");
      return;
    }

    state.ui.runAllButton.disabled = true;
    state.ui.runButton.disabled = true;

    try {
      // First, force-load all thumbnails by scrolling the filmstrip
      await ensureAllThumbnailsLoaded();

      const slideNodes = getSlideOptionNodes();
      const totalSlides = slideNodes.length;

      if (totalSlides === 0) {
        throw new Error("スライドが見つかりません");
      }

      setStatusWithSpinner(`全${totalSlides}スライドを収集中...\n\n`, "streaming");

      const allSlides = [];

      // Navigate to first slide using keyboard event
      if (totalSlides > 0) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Home',
          code: 'Home',
          keyCode: 36,
          bubbles: true,
          cancelable: true
        }));
        // Wait for slide transition (optimized from 1000ms)
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Step 1: Collect all slides using keyboard navigation with retry logic
      const maxRetries = 2;
      const failedSlides = [];

      for (let i = 0; i < totalSlides; i++) {
        setStatusWithSpinner(`スライド ${i + 1}/${totalSlides} を収集中...\n\n`, "streaming");

        let screenshot = null;
        let retryCount = 0;
        let success = false;

        // Retry logic for failed captures
        while (retryCount <= maxRetries && !success) {
          try {
            const summary = await collectPresentationSummary(i + 1);

            if (summary?.slides?.[0]?.screenshot) {
              screenshot = summary.slides[0].screenshot;
              success = true;
              allSlides.push({
                number: i + 1,
                screenshot: screenshot
              });
              console.log(`[Gemini Slides] Successfully captured slide ${i + 1}`);
            } else {
              throw new Error('Screenshot is empty');
            }
          } catch (error) {
            retryCount++;
            console.warn(`[Gemini Slides] Failed to capture slide ${i + 1}, attempt ${retryCount}/${maxRetries + 1}`, error);

            if (retryCount <= maxRetries) {
              // Wait a bit longer before retry
              await new Promise(resolve => setTimeout(resolve, 400));
            } else {
              // Mark as failed after all retries
              failedSlides.push(i + 1);
              console.error(`[Gemini Slides] Failed to capture slide ${i + 1} after ${maxRetries + 1} attempts`);
            }
          }
        }

        // Navigate to next slide using arrow key (except on last slide)
        if (i < totalSlides - 1) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            bubbles: true,
            cancelable: true
          }));
          // Wait for slide transition (optimized from 800ms)
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }

      // Check if we have partial success
      if (allSlides.length === 0) {
        throw new Error("すべてのスライドのキャプチャに失敗しました");
      }

      if (failedSlides.length > 0) {
        console.warn(`[Gemini Slides] Failed to capture ${failedSlides.length} slides:`, failedSlides);
        setStatusWithSpinner(
          `警告: ${failedSlides.length}枚のスライド (${failedSlides.join(', ')}) のキャプチャに失敗しました。\n` +
          `${allSlides.length}枚のスライドで分析を続行します...\n\n`,
          "streaming"
        );
        // Give user time to read the warning
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Step 2: Create PDF from all screenshots
      setStatusWithSpinner(`PDFを作成中...\n\n`, "streaming");
      const pdfDataUrl = await createPDFFromScreenshots(allSlides);

      // Step 3: Send PDF to Gemini for holistic analysis
      setStatusWithSpinner(`全体のストーリーを分析中...\n\n`, "streaming");

      // Phase 4: コンテキスト統合
      const contextPrompt = await buildContextPrompt();

      // ユーザーが選択したプロンプトとコンテキストを結合
      const userPrompt = state.ui.promptTextarea.value.trim();
      const basePrompt = contextPrompt
        ? `${contextPrompt}[レビュー依頼]\n${userPrompt}\n\n以下の${allSlides.length}枚のスライドを含むプレゼンテーションを、上記のコンテキストを踏まえてレビューしてください。`
        : userPrompt;
      const finalPrompt = appendFeedbackFormatInstructions(basePrompt);

      console.log('[Gemini Slides] Full prompt with context (PDF):', finalPrompt);

      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK_PDF",
        payload: {
          prompt: finalPrompt,  // 位置情報フォーマット込みプロンプト
          pdfData: pdfDataUrl,
          slideCount: allSlides.length,
          capturedAt: Date.now()
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Gemini request failed.");
      }

      state.latestResult = response.result;
      renderResult();

    } catch (error) {
      console.error('[Gemini Slides] Error in handleRunAllSlides:', error);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      state.ui.runAllButton.disabled = false;
      state.ui.runButton.disabled = false;
    }
  }

  /**
   * Create a PDF from multiple screenshot images
   * @param {Array} slides - Array of slide objects with screenshot data
   * @returns {string} - Base64 encoded PDF data URL
   */
  async function createPDFFromScreenshots(slides) {
    try {
      console.log(`[Gemini Slides] Creating PDF from ${slides.length} screenshots`);

      // jsPDF is loaded globally from the UMD bundle
      const { jsPDF } = window.jspdf;

      if (!jsPDF) {
        throw new Error('jsPDF library not loaded');
      }

      // Create PDF in A4 landscape format for better slide visibility
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];

        if (i > 0) {
          pdf.addPage();
        }

        // Add screenshot image to PDF page
        if (slide.screenshot) {
          try {
            // Get image dimensions to maintain aspect ratio
            const img = await loadImage(slide.screenshot);
            const imgAspect = img.width / img.height;
            const pageAspect = pageWidth / pageHeight;

            let drawWidth = pageWidth;
            let drawHeight = pageHeight;
            let offsetX = 0;
            let offsetY = 0;

            // Center the image maintaining aspect ratio
            if (imgAspect > pageAspect) {
              // Image is wider than page
              drawHeight = pageWidth / imgAspect;
              offsetY = (pageHeight - drawHeight) / 2;
            } else {
              // Image is taller than page
              drawWidth = pageHeight * imgAspect;
              offsetX = (pageWidth - drawWidth) / 2;
            }

            pdf.addImage(
              slide.screenshot,
              'PNG',
              offsetX,
              offsetY,
              drawWidth,
              drawHeight,
              undefined,
              'FAST' // Compression mode
            );

            // Add slide number as footer
            pdf.setFontSize(10);
            pdf.setTextColor(128, 128, 128);
            pdf.text(
              `Slide ${slide.number}`,
              pageWidth / 2,
              pageHeight - 5,
              { align: 'center' }
            );

            console.log(`[Gemini Slides] Added slide ${slide.number} to PDF`);
          } catch (error) {
            console.error(`[Gemini Slides] Failed to add slide ${slide.number} to PDF:`, error);
          }
        }
      }

      // Output as base64 data URL
      const pdfDataUrl = pdf.output('dataurlstring');
      console.log(`[Gemini Slides] PDF created successfully, size: ${pdfDataUrl.length} chars`);

      return pdfDataUrl;
    } catch (error) {
      console.error('[Gemini Slides] PDF creation failed:', error);
      throw error;
    }
  }

  /**
   * Load an image from data URL and return Image object
   */
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Ensure all thumbnails are loaded by scrolling the filmstrip
   */
  async function ensureAllThumbnailsLoaded() {
    console.log('[Gemini Slides] Loading all thumbnails...');

    // Find the filmstrip scroll container
    const filmstripScroll = document.querySelector('.punch-filmstrip-scroll');
    if (!filmstripScroll) {
      console.warn('[Gemini Slides] Filmstrip scroll container not found');
      return;
    }

    // Scroll to the bottom of the filmstrip to load all thumbnails
    const scrollHeight = filmstripScroll.scrollHeight;
    const clientHeight = filmstripScroll.clientHeight;
    const scrollSteps = Math.ceil(scrollHeight / clientHeight) + 1;

    console.log(`[Gemini Slides] Scrolling filmstrip in ${scrollSteps} steps`);

    for (let i = 0; i < scrollSteps; i++) {
      filmstripScroll.scrollTop = (i * clientHeight);
      // Optimized wait time from 200ms
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Scroll back to top
    filmstripScroll.scrollTop = 0;
    // Optimized wait time from 300ms
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('[Gemini Slides] All thumbnails loaded');
  }

  function handleStreamChunk(message) {
    if (!state.ui.result) return;
    if (message.fullText) {
      state.latestResult = { text: message.fullText };
      state.ui.result.className = "status streaming";
      const spinner = document.createElement("div");
      spinner.className = "spinner";
      state.ui.result.innerHTML = "";
      state.ui.result.appendChild(spinner);
      const textNode = document.createTextNode(message.fullText);
      state.ui.result.appendChild(textNode);
    }
  }

  function setStatusWithSpinner(message, variant) {
    if (!state.ui.result) return;
    const classMap = {
      error: "status error",
      info: "status",
      success: "status success",
      streaming: "status streaming"
    };
    state.ui.result.className = classMap[variant] || "status";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    state.ui.result.innerHTML = "";
    state.ui.result.appendChild(spinner);
    const textNode = document.createTextNode(message);
    state.ui.result.appendChild(textNode);
  }

  function renderResult() {
    if (!state.ui.result) return;
    if (!state.latestResult?.text) {
      setStatus("Gemini returned an empty response.", "error");
      return;
    }
    state.ui.result.className = "status success";
    state.ui.result.textContent = state.latestResult.text;
    updateFeedbackFromResult(state.latestResult.text);

    // Play completion notification sound
    playNotificationSound();
  }

  /**
   * Play a subtle notification sound when analysis completes
   * Two-tone chime (ding-dong style)
   */
  function playNotificationSound() {
    try {
      // Create an AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);

      // First tone (higher - "ding")
      const playTone = (frequency, startTime, duration) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(masterGain);

        // Sine wave for pure chime sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);

        // Envelope: quick attack, smooth decay
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.01); // Attack
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration); // Decay

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      // Two-tone chime: G5 (784Hz) -> E5 (659Hz)
      const now = audioContext.currentTime;
      playTone(784, now, 0.4);        // First tone (higher)
      playTone(659, now + 0.15, 0.5); // Second tone (lower, overlapping)

      console.log('[Gemini Slides] Notification chime played');
    } catch (error) {
      console.warn('[Gemini Slides] Could not play notification sound:', error);
    }
  }

  function setStatus(message, variant) {
    if (!state.ui.result) return;
    const classMap = {
      error: "status error",
      info: "status",
      success: "status success"
    };
    state.ui.result.className = classMap[variant] || "status";
    state.ui.result.textContent = message;
  }

  async function collectPresentationSummary(slideNumber = null) {
    const summary = {
      capturedAt: Date.now(),
      slides: []
    };

    // Capture screenshot of current slide
    const screenshot = await captureSlideScreenshot();

    // Get slide ID, index, and number (use provided or detect)
    const slideId = getCurrentSlideId();
    const slideIndex = getActiveSlideIndex();  // 0-based index
    let finalSlideNumber = slideNumber;
    if (!finalSlideNumber) {
      finalSlideNumber = getCurrentSlidePageNumber();
    }

    summary.slides.push({
      number: finalSlideNumber,
      slideId: slideId,
      slideIndex: slideIndex,  // フィルムストリップでのインデックス（0始まり）
      screenshot: screenshot
    });

    return summary;
  }

  async function captureSlideScreenshot() {
    try {
      // Find the main slide canvas/SVG with improved logic
      const canvasSelectors = [
        '#canvas',
        '.punch-viewer-content',
        '.punch-present-canvas'
      ];

      let slideElement = null;
      for (const selector of canvasSelectors) {
        slideElement = document.querySelector(selector);
        if (slideElement) {
          console.log(`[Gemini Slides] Found slide element with "${selector}"`);
          break;
        }
      }

      if (!slideElement) {
        console.warn('[Gemini Slides] Slide element not found');
        return null;
      }

      console.log('[Gemini Slides] Slide element tag:', slideElement.tagName);
      console.log('[Gemini Slides] Slide element id:', slideElement.id);
      console.log('[Gemini Slides] Slide element classes:', slideElement.className);

      // Find the correct SVG element with improved filtering
      let svgElement = await findMainSlideSVG(slideElement);

      if (!svgElement) {
        console.warn('[Gemini Slides] No suitable SVG found, cannot create screenshot');
        return null;
      }

      console.log('[Gemini Slides] Selected SVG element with dimensions:',
                  svgElement.getBoundingClientRect().width, 'x',
                  svgElement.getBoundingClientRect().height);

      // Get the SVG's bounding rect (not the container)
      const svgRect = svgElement.getBoundingClientRect();

      // Create a canvas to draw the element
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const svgData = new XMLSerializer().serializeToString(svgElement);
      console.log('[Gemini Slides] SVG data length:', svgData.length);

      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();

      // Increase resolution by scaling up (2x for higher quality)
      const scale = 2;
      const highResWidth = svgRect.width * scale;
      const highResHeight = svgRect.height * scale;

      canvas.width = highResWidth;
      canvas.height = highResHeight;

      const dataUrl = await new Promise((resolve, reject) => {
        img.onload = () => {
          // Draw at higher resolution
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, highResWidth, highResHeight);
          URL.revokeObjectURL(url);

          // Export as PNG with high quality
          const result = canvas.toDataURL('image/png', 1.0);
          console.log('[Gemini Slides] High-res screenshot created:', result.substring(0, 50) + '...');
          resolve(result);
        };
        img.onerror = (error) => {
          console.error('[Gemini Slides] Image load error:', error);
          URL.revokeObjectURL(url);
          reject(error);
        };
        img.src = url;
      });

      return dataUrl;
    } catch (error) {
      console.error('[Gemini Slides] Screenshot capture failed:', error);
      return null;
    }
  }

  /**
   * Find the main slide SVG element with improved filtering logic
   * to avoid capturing thumbnails or filmstrip SVGs
   */
  async function findMainSlideSVG(containerElement) {
    // Strategy 1: Look for SVG directly in the slide element
    if (containerElement.tagName === 'SVG') {
      return containerElement;
    }

    // Strategy 2: Look for SVG as immediate child
    const directSvg = containerElement.querySelector('svg');
    if (directSvg && isMainSlideSVG(directSvg)) {
      console.log('[Gemini Slides] Found SVG as direct child');
      return directSvg;
    }

    // Strategy 3: Look in the parent's children
    const parent = containerElement.parentElement;
    if (parent) {
      const parentSvgs = Array.from(parent.querySelectorAll('svg'));
      const validSvgs = parentSvgs.filter(svg => isMainSlideSVG(svg));
      if (validSvgs.length > 0) {
        // Return the largest valid SVG
        const mainSvg = validSvgs.reduce((largest, current) => {
          const currentRect = current.getBoundingClientRect();
          const largestRect = largest.getBoundingClientRect();
          return (currentRect.width * currentRect.height) > (largestRect.width * largestRect.height)
            ? current : largest;
        });
        console.log('[Gemini Slides] Found main SVG in parent');
        return mainSvg;
      }
    }

    // Strategy 4: Find all visible SVGs in the viewport and filter
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    console.log('[Gemini Slides] Total SVGs in document:', allSvgs.length);

    const visibleAndValid = allSvgs.filter(svg => {
      if (!isMainSlideSVG(svg)) return false;

      const rect = svg.getBoundingClientRect();
      // Must be visible and reasonably sized (at least 400x300)
      return rect.width >= 400 && rect.height >= 300 &&
             rect.top >= -100 && rect.left >= -100 &&
             rect.top < window.innerHeight && rect.left < window.innerWidth;
    });

    console.log('[Gemini Slides] Valid visible SVGs:', visibleAndValid.length);

    if (visibleAndValid.length === 0) {
      return null;
    }

    // Return the largest valid visible SVG
    const mainSvg = visibleAndValid.reduce((largest, current) => {
      const currentRect = current.getBoundingClientRect();
      const largestRect = largest.getBoundingClientRect();
      return (currentRect.width * currentRect.height) > (largestRect.width * largestRect.height)
        ? current : largest;
    });

    console.log('[Gemini Slides] Selected main SVG from document');
    return mainSvg;
  }

  /**
   * Check if an SVG element is likely the main slide (not a thumbnail)
   */
  function isMainSlideSVG(svg) {
    if (!svg) return false;

    const rect = svg.getBoundingClientRect();

    // Filter out small SVGs (likely thumbnails)
    if (rect.width < 400 || rect.height < 300) {
      return false;
    }

    // Check if SVG is in the filmstrip area (thumbnails)
    let parent = svg.parentElement;
    let depth = 0;
    while (parent && depth < 10) {
      const classList = parent.classList;
      const classString = Array.from(classList).join(' ');

      // Exclude SVGs in filmstrip/thumbnail areas
      if (classString.includes('filmstrip') ||
          classString.includes('thumbnail') ||
          classString.includes('sidebar') ||
          parent.id?.includes('filmstrip')) {
        return false;
      }

      parent = parent.parentElement;
      depth++;
    }

    // Check aspect ratio - slides are typically 4:3 or 16:9
    const aspectRatio = rect.width / rect.height;
    if (aspectRatio < 1.0 || aspectRatio > 2.0) {
      return false; // Too narrow or too wide
    }

    return true;
  }

  function extractCurrentSlideContent() {
    // Debug: Log available selectors
    console.log('[Gemini Slides] Starting content extraction...');

    // Try multiple selectors for the canvas area
    const canvasSelectors = [
      '.punch-viewer-container',
      '.punch-present-canvas-container',
      '[role="main"]',
      '#canvas-container',
      '.docs-editor'
    ];

    let canvas = null;
    for (const selector of canvasSelectors) {
      canvas = document.querySelector(selector);
      if (canvas) {
        console.log('[Gemini Slides] Found canvas with selector:', selector);
        break;
      }
    }

    if (!canvas) {
      console.warn('[Gemini Slides] Canvas not found, trying document body');
      canvas = document.body;
    }

    // Extract text with multiple selector strategies
    const textSelectors = [
      '[role="textbox"]',
      'g[role="textbox"]',
      '.sketchy-text-content-wrapper',
      'svg text',
      '.sketchy-text-background-container + *',
      // Additional selectors for edit mode
      '[aria-label*="text box"]',
      '[aria-label*="テキスト ボックス"]',
      '.docs-text-color',
      'svg g text'
    ];

    const textBlocks = [];
    let title = "";
    const allTextElements = [];
    const seenTexts = new Set();

    textSelectors.forEach(selector => {
      const elements = canvas.querySelectorAll(selector);
      console.log(`[Gemini Slides] Selector "${selector}" found:`, elements.length);
      elements.forEach(el => {
        if (!allTextElements.includes(el)) {
          allTextElements.push(el);
        }
      });
    });

    console.log('[Gemini Slides] Total unique text elements:', allTextElements.length);

    // Try getting text from SVG elements more directly
    if (allTextElements.length === 0) {
      console.log('[Gemini Slides] No text elements found with selectors, trying SVG text nodes...');
      const svgTexts = canvas.querySelectorAll('svg');
      svgTexts.forEach(svg => {
        const textNodes = svg.querySelectorAll('text');
        textNodes.forEach(node => {
          allTextElements.push(node);
        });
      });
      console.log('[Gemini Slides] Found SVG text nodes:', allTextElements.length);
    }

    allTextElements.forEach((element, index) => {
      const text = element.textContent?.trim();
      if (text && text.length > 0 && !seenTexts.has(text)) {
        seenTexts.add(text);
        console.log(`[Gemini Slides] Text ${index}:`, text.substring(0, 50));
        if (index === 0) {
          title = text;
        } else {
          textBlocks.push(text);
        }
      }
    });

    // Extract image/visual information
    const images = canvas.querySelectorAll('image, img, [role="img"]');
    const visuals = [];
    console.log('[Gemini Slides] Found images:', images.length);

    images.forEach((img) => {
      const alt = img.getAttribute('alt') || img.getAttribute('aria-label') || '';
      const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      const src = img.getAttribute('src') || '';
      if (alt || src || href) {
        visuals.push({
          description: alt || 'Visual element',
          src: (src || href).substring(0, 100)
        });
      }
    });

    // Extract speaker notes
    const notesElement = getSpeakerNotesElement();
    const notes = notesElement?.textContent?.trim() || '';
    if (notes) {
      console.log('[Gemini Slides] Found notes:', notes.substring(0, 50));
    }

    // Get slide number from thumbnail panel
    const slideNodes = getSlideOptionNodes();
    const activeOrder = getActiveSlideOrder(slideNodes);
    const slideNumber = activeOrder !== -1 ? activeOrder + 1 : 1;

    const result = {
      number: slideNumber,
      title: title || "(No title)",
      textBlocks,
      visuals,
      notes
    };

    console.log('[Gemini Slides] Extraction result:', result);
    return result;
  }

  function extractTextSegments(text) {
    if (!text) return [];
    return text
      .split(/(?:,|、|\n)/)
      .map((segment) =>
        segment.replace(/^(?:Slide|スライド|ページ|Diapositiva|Diapositive)\s*\d+\s*/i, "")
      )
      .map((segment) =>
        segment.replace(
          /^(?:Title|タイトル|Subtitle|サブタイトル|Body|本文|Notes|ノート|Text|テキスト)\s*[:：]?/i,
          ""
        )
      )
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  function extractVisualHints(label) {
    const visuals = [];
    if (!label) return visuals;
    const patterns = [
      /(?:image|picture|photo)[^.,、]*/gi,
      /画像[^。]+/g,
      /図[^。]+/g
    ];
    patterns.forEach((pattern) => {
      const matches = label.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          const normalized = normalizeWhitespace(match);
          if (normalized) {
            visuals.push({ description: normalized });
          }
        });
      }
    });
    return visuals;
  }

  function getSlideOptionNodes() {
    // Google SlidesのフィルムストリップはSVG要素として実装されている
    // 優先順位: SVG要素 > HTML [role="option"] 要素

    // 1. SVG フィルムストリップサムネイルを検索（最も一般的）
    const svgThumbnails = document.querySelectorAll('g.punch-filmstrip-thumbnail');
    if (svgThumbnails.length > 0) {
      debugLog(`Found ${svgThumbnails.length} SVG filmstrip thumbnails`);
      return Array.from(svgThumbnails);
    }

    // 2. フォールバック: HTML要素ベースのフィルムストリップ（古いバージョン用）
    const selectors = [
      '[role="listbox"] [role="option"]',
      '[role="grid"] [role="option"]'
    ];
    const nodes = [];
    const seen = new WeakSet();

    selectors.forEach((selector) => {
      const candidates = document.querySelectorAll(selector);
      candidates.forEach((candidate) => {
        if (!(candidate instanceof HTMLElement)) return;
        if (seen.has(candidate)) return;
        if (!isSlideOptionNode(candidate)) return;
        seen.add(candidate);
        nodes.push(candidate);
      });
    });

    if (nodes.length > 0) {
      debugLog(`Found ${nodes.length} HTML filmstrip nodes`);
      return nodes.sort((a, b) => {
        const ai = getSlideIndex(a);
        const bi = getSlideIndex(b);
        if (ai === null && bi === null) return 0;
        if (ai === null) return 1;
        if (bi === null) return -1;
        return ai - bi;
      });
    }

    // 3. 見つからなかった場合
    debugLog('getSlideOptionNodes: NO NODES FOUND');
    return [];
  }

  function isSlideOptionNode(node) {
    if (!node) return false;

    // プレゼン関連の要素を明示的に除外
    const classList = node.classList ? Array.from(node.classList) : [];
    const excludedClasses = ['punch-present', 'punch-viewer-content'];
    if (excludedClasses.some(cls => classList.some(c => c.includes(cls)))) {
      return false;
    }

    // role="option" を持ち、かつフィルムストリップに含まれる要素のみを対象
    if (node.getAttribute('role') !== 'option') {
      return false;
    }

    // aria-label にスライド番号が含まれているかチェック
    const label = node.getAttribute("aria-label") || "";
    if (!label) return false;

    // スライド番号を含むパターンのみ許可
    if (!/(?:Slide|スライド|ページ|Diapositiva|Diapositive)\s*\d+/i.test(label)) {
      return false;
    }

    // フィルムストリップのコンテナ内にあるかチェック
    const hasFilmstripParent = node.closest('[role="listbox"], [role="grid"]');
    if (!hasFilmstripParent) {
      return false;
    }

    return true;
  }

  function getSlideIndex(node) {
    if (!node) return null;
    const datasetIndex = node.getAttribute("data-slide-index") || node.dataset?.slideIndex;
    if (datasetIndex !== null && datasetIndex !== undefined) {
      const parsed = parseInt(datasetIndex, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    const candidates = [
      node.getAttribute("aria-label") || "",
      node.textContent || ""
    ];
    for (const value of candidates) {
      const match = value.match(/(?:Slide|スライド|ページ|Diapositiva|Diapositive)\s*(\d+)/i);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) {
          return parsed - 1;
        }
      }
    }
    return null;
  }

  function getActiveSlideOrder(slideNodes) {
    if (!Array.isArray(slideNodes) || !slideNodes.length) return -1;

    const activeNode = slideNodes.find((node) => {
      // HTML要素の場合
      if (node.getAttribute("aria-selected") === "true") return true;

      // SVG要素の場合は className.baseVal を使う
      if (node.className && node.className.baseVal) {
        const classes = node.className.baseVal;
        if (classes.includes("punch-filmstrip-selected") ||
            classes.includes("is-selected")) {
          return true;
        }
        // 選択されたサムネイルは子要素に特別なクラスがある
        const pageNumber = node.querySelector('.punch-filmstrip-selected-thumbnail-pagenumber');
        if (pageNumber) return true;
      }

      // HTML要素のclassList（フォールバック）
      if (node.classList) {
        return (
          node.classList.contains("punch-filmstrip-thumbnail-active") ||
          node.classList.contains("punch-filmstrip-selected") ||
          node.classList.contains("is-selected")
        );
      }

      return false;
    });

    if (!activeNode) return -1;
    return slideNodes.indexOf(activeNode);
  }

  function getSpeakerNotesElement() {
    const selectors = [
      '[aria-label="Speaker notes"]',
      '[aria-label*="Speaker notes"]',
      '[aria-label="スピーカーノート"]',
      '[aria-label*="スピーカーノート"]',
      '[aria-label*="ノート"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function getActiveSlideIndex() {
    return getActiveSlideOrder(getSlideOptionNodes());
  }

  // ========================================
  // Phase 1: ヘルパー関数
  // ========================================

  /**
   * ユニークなプロジェクトIDを生成
   * 形式: proj_[timestamp]_[random]
   */
  function generateProjectId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `proj_${timestamp}_${random}`;
  }

  function generatePinId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `pin_${crypto.randomUUID()}`;
    }
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `pin_${timestamp}_${random}`;
  }

  /**
   * Google SlidesのURLからプレゼンテーションIDを抽出
   * @param {string} url - Google SlidesのURL
   * @returns {string|null} プレゼンテーションID
   */
  function extractPresentationId(url = window.location.href) {
    const match = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  /**
   * 現在のプレゼンテーションのタイトルを取得
   * @param {number} maxRetries - 最大リトライ回数
   * @param {number} retryDelay - リトライ間隔(ms)
   * @returns {Promise<string|null>} タイトル（取得できない場合はnull）
   */
  async function getPresentationTitle(maxRetries = 3, retryDelay = 500) {
    // Google Slidesのタイトル要素を探す
    const titleSelectors = [
      '.docs-title-input',
      '[role="textbox"][aria-label*="title"]',
      '[role="textbox"][aria-label*="タイトル"]'
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim()) {
          const title = element.textContent.trim();
          console.log(`[getPresentationTitle] Title found: "${title}" (attempt ${attempt + 1})`);
          return title;
        }
      }

      if (attempt < maxRetries - 1) {
        console.log(`[getPresentationTitle] Title not found, retrying in ${retryDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    console.warn(`[getPresentationTitle] Could not find title after ${maxRetries} attempts`);
    return null;
  }

  /**
   * 2つのタイトルが類似しているか判定（簡易版）
   * @param {string} title1
   * @param {string} title2
   * @param {number} threshold - 類似度しきい値（0-1、デフォルト0.7）
   * @returns {boolean}
   */
  function isSimilarTitle(title1, title2, threshold = 0.7) {
    if (!title1 || !title2) return false;

    const normalize = (str) => str.toLowerCase().replace(/\s+/g, '');
    const n1 = normalize(title1);
    const n2 = normalize(title2);

    // デフォルトタイトル（無題のプレゼンテーション、Untitled presentation等）は類似判定しない
    const defaultTitles = ['無題のプレゼンテーション', 'untitledpresentation', '無題のプロジェクト'];
    if (defaultTitles.includes(n1) || defaultTitles.includes(n2)) {
      return false;
    }

    // 完全一致
    if (n1 === n2) return true;

    // レーベンシュタイン距離による類似度判定
    const maxLen = Math.max(n1.length, n2.length);
    if (maxLen === 0) return true;

    const distance = levenshteinDistance(n1, n2);
    const similarity = 1 - distance / maxLen;

    return similarity >= threshold;
  }

  /**
   * レーベンシュタイン距離を計算
   * @param {string} str1
   * @param {string} str2
   * @returns {number}
   */
  function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * プロジェクトデータをChrome Storageに保存
   * @param {string} projectId
   * @param {object} projectData
   */
  async function saveProject(projectId, projectData) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.PROJECTS);
      const projects = stored[STORAGE_KEYS_PROJECT.PROJECTS] || {};

      // Phase 5: 外部コンテキストを圧縮
      if (projectData.externalContexts) {
        projectData.externalContexts = compressExternalContexts(projectData.externalContexts);
      }

      projects[projectId] = {
        ...projectData,
        updatedAt: new Date().toISOString()
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS_PROJECT.PROJECTS]: projects
      });

      console.log('[Gemini Slides] Project saved:', projectId);
      return true;
    } catch (error) {
      console.error('[Gemini Slides] Failed to save project:', error);
      return false;
    }
  }

  /**
   * プロジェクトデータをChrome Storageから読み込み
   * @param {string} projectId
   * @returns {object|null} プロジェクトデータ
   */
  async function loadProject(projectId) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.PROJECTS);
      const projects = stored[STORAGE_KEYS_PROJECT.PROJECTS] || {};
      return projects[projectId] || null;
    } catch (error) {
      console.error('[Gemini Slides] Failed to load project:', error);
      return null;
    }
  }

  /**
   * プロジェクトを削除
   * @param {string} projectId
   * @returns {boolean} 成功したかどうか
   */
  async function deleteProject(projectId) {
    try {
      // プロジェクトデータを削除
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.PROJECTS);
      const projects = stored[STORAGE_KEYS_PROJECT.PROJECTS] || {};
      delete projects[projectId];

      await chrome.storage.local.set({
        [STORAGE_KEYS_PROJECT.PROJECTS]: projects
      });

      // URL→プロジェクトIDマッピングも削除
      const mappingStored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.URL_PROJECT_MAP);
      const mapping = mappingStored[STORAGE_KEYS_PROJECT.URL_PROJECT_MAP] || {};

      // このプロジェクトIDを参照しているURLをすべて削除
      for (const [url, pid] of Object.entries(mapping)) {
        if (pid === projectId) {
          delete mapping[url];
        }
      }

      await chrome.storage.local.set({
        [STORAGE_KEYS_PROJECT.URL_PROJECT_MAP]: mapping
      });

      console.log('[Gemini Slides] Project deleted:', projectId);
      return true;
    } catch (error) {
      console.error('[Gemini Slides] Failed to delete project:', error);
      return false;
    }
  }

  /**
   * URL→プロジェクトID マッピングを保存
   * @param {string} presentationId
   * @param {string} projectId
   */
  async function saveUrlProjectMapping(presentationId, projectId) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.URL_PROJECT_MAP);
      const mapping = stored[STORAGE_KEYS_PROJECT.URL_PROJECT_MAP] || {};

      mapping[presentationId] = projectId;

      await chrome.storage.local.set({
        [STORAGE_KEYS_PROJECT.URL_PROJECT_MAP]: mapping
      });

      console.log('[Gemini Slides] URL mapping saved:', presentationId, '->', projectId);
      return true;
    } catch (error) {
      console.error('[Gemini Slides] Failed to save URL mapping:', error);
      return false;
    }
  }

  /**
   * URLからプロジェクトIDを取得
   * @param {string} presentationId
   * @returns {string|null} プロジェクトID
   */
  async function getProjectIdByUrl(presentationId) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.URL_PROJECT_MAP);
      const mapping = stored[STORAGE_KEYS_PROJECT.URL_PROJECT_MAP] || {};
      return mapping[presentationId] || null;
    } catch (error) {
      console.error('[Gemini Slides] Failed to get project ID from URL:', error);
      return null;
    }
  }

  /**
   * すべてのプロジェクトを取得
   * @returns {object} プロジェクトデータのマップ
   */
  async function getAllProjects() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS_PROJECT.PROJECTS);
      return stored[STORAGE_KEYS_PROJECT.PROJECTS] || {};
    } catch (error) {
      console.error('[Gemini Slides] Failed to get all projects:', error);
      return {};
    }
  }

  // ========================================
  // Phase 2: UI関数
  // ========================================

  /**
   * タブを切り替える
   */
  function handleTabSwitch(event) {
    const clickedButton = event.currentTarget;
    const tabName = clickedButton.getAttribute('data-tab');

    console.log('[Gemini Slides] Switching to tab:', tabName);

    // すべてのタブボタンからactiveクラスを削除
    state.ui.tabButtons?.forEach(button => {
      button.classList.remove('active');
    });

    // クリックされたタブボタンにactiveクラスを追加
    clickedButton.classList.add('active');

    // すべてのタブコンテンツを非表示
    state.ui.tabContents?.forEach(content => {
      content.classList.remove('active');
    });

    // 対応するタブコンテンツを表示
    const targetContent = shadowRoot.querySelector(`[data-tab-content="${tabName}"]`);
    if (targetContent) {
      targetContent.classList.add('active');
    }

    // Phase 5: Contextタブに切り替えた時はストレージ情報を更新
    if (tabName === 'context') {
      updateStorageInfo();
    }

    // 現在のタブを記録
    state.currentTab = tabName;
  }

  /**
   * プロジェクトセレクトドロップダウンを更新
   */
  async function updateProjectSelector() {
    if (!state.ui.projectSelect) return;

    try {
      const allProjects = await getAllProjects();
      const currentPresentationId = extractPresentationId();
      const currentProjectId = currentPresentationId ? await getProjectIdByUrl(currentPresentationId) : null;

      // ドロップダウンをクリア
      state.ui.projectSelect.innerHTML = '';

      // プロジェクト一覧を作成（最近更新されたものから順に）
      const projectEntries = Object.entries(allProjects).sort((a, b) => {
        const dateA = new Date(a[1].updatedAt || a[1].createdAt);
        const dateB = new Date(b[1].updatedAt || b[1].createdAt);
        return dateB - dateA; // 新しい順
      });

      // 現在のプロジェクトを最初に表示
      if (currentProjectId && allProjects[currentProjectId]) {
        const option = document.createElement('option');
        option.value = currentProjectId;
        option.textContent = allProjects[currentProjectId].projectName || '無題のプロジェクト';
        option.selected = true;
        state.ui.projectSelect.appendChild(option);
      }

      // 他のプロジェクトを追加
      projectEntries.forEach(([projectId, project]) => {
        if (projectId === currentProjectId) return; // 現在のプロジェクトはすでに追加済み

        const option = document.createElement('option');
        option.value = projectId;
        option.textContent = project.projectName || '無題のプロジェクト';
        state.ui.projectSelect.appendChild(option);
      });

      // 区切り線とオプション
      if (projectEntries.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '────────────';
        state.ui.projectSelect.appendChild(separator);
      }

      // 新規プロジェクト作成オプション
      const newProjectOption = document.createElement('option');
      newProjectOption.value = '__new__';
      newProjectOption.textContent = '+ 新規プロジェクト作成';
      state.ui.projectSelect.appendChild(newProjectOption);

      console.log('[Gemini Slides] Project selector updated with', projectEntries.length, 'projects');
    } catch (error) {
      console.error('[Gemini Slides] Failed to update project selector:', error);
      state.ui.projectSelect.innerHTML = '<option value="">エラー</option>';
    }
  }

  /**
   * プロジェクト切り替えハンドラー
   */
  async function handleProjectSwitch(event) {
    const selectedProjectId = event.target.value;

    if (selectedProjectId === '__new__') {
      // 新規プロジェクト作成
      await createNewProject();
      return;
    }

    if (!selectedProjectId) return;

    try {
      // プロジェクトを読み込む
      const projectData = await loadProject(selectedProjectId);
      if (!projectData) {
        console.error('[Gemini Slides] Project not found:', selectedProjectId);
        return;
      }

      // 現在のプレゼンテーションIDに紐付け
      const presentationId = extractPresentationId();
      if (presentationId) {
        await saveUrlProjectMapping(presentationId, selectedProjectId);
      }

      // state を更新
      state.currentProjectId = selectedProjectId;

      // UI を更新
      updateProjectUI(projectData);

      // Phase 4: コンテキストインジケーター更新
      await updateContextIndicator();

      console.log('[Gemini Slides] Switched to project:', selectedProjectId);
    } catch (error) {
      console.error('[Gemini Slides] Failed to switch project:', error);
    }
  }

  /**
   * 新規プロジェクトを作成（Phase 6: ダイアログベース）
   */
  async function createNewProject() {
    // タイトルを事前に取得
    const defaultTitle = await getPresentationTitle() || '';

    return new Promise((resolve) => {
      // ダイアログを作成
      const dialogHTML = `
        <div class="create-project-dialog">
          <div class="dialog-overlay"></div>
          <div class="dialog-content">
            <div class="dialog-title">新規プロジェクト作成</div>

            <div class="form-group">
              <label class="form-label" for="project-name-input">プロジェクト名 *</label>
              <input
                type="text"
                id="project-name-input"
                class="form-input"
                placeholder="例: Q2 営業報告会"
                value="${defaultTitle}"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="kickoff-url-input">キックオフURL (任意)</label>
              <input
                type="url"
                id="kickoff-url-input"
                class="form-input"
                placeholder="https://docs.google.com/presentation/d/..."
              />
              <div class="form-hint">キックオフのGoogle SlidesのURLを入力すると、自動的にコンテキストを抽出します</div>
            </div>

            <div class="dialog-actions">
              <button class="button secondary" id="dialog-cancel">キャンセル</button>
              <button class="button primary" id="dialog-create">作成</button>
            </div>
          </div>
        </div>
      `;

      const dialogContainer = document.createElement('div');
      dialogContainer.innerHTML = dialogHTML;
      shadowRoot.appendChild(dialogContainer.firstElementChild);

      const dialog = shadowRoot.querySelector('.create-project-dialog');
      const overlay = dialog.querySelector('.dialog-overlay');
      const cancelButton = dialog.querySelector('#dialog-cancel');
      const createButton = dialog.querySelector('#dialog-create');
      const nameInput = dialog.querySelector('#project-name-input');
      const kickoffUrlInput = dialog.querySelector('#kickoff-url-input');

      // キャンセル処理
      const handleCancel = () => {
        dialog.remove();
        // ドロップダウンを元に戻す
        if (state.currentProjectId && state.ui.projectSelect) {
          state.ui.projectSelect.value = state.currentProjectId;
        }
        resolve(null);
      };

      overlay.addEventListener('click', handleCancel);
      cancelButton.addEventListener('click', handleCancel);

      // 作成処理
      createButton.addEventListener('click', async () => {
        const projectName = nameInput.value.trim();
        const kickoffUrl = kickoffUrlInput.value.trim();

        if (!projectName) {
          alert('プロジェクト名を入力してください');
          return;
        }

        dialog.remove();

        try {
          const projectId = generateProjectId();
          const newProject = {
            ...clone(DEFAULT_PROJECT_STRUCTURE),
            projectName: projectName,
            createdAt: new Date().toISOString()
          };

          // Phase 6: キックオフURLがある場合は自動抽出
          if (kickoffUrl) {
            newProject.staticContext.kickoffUrl = kickoffUrl;
          }

          await saveProject(projectId, newProject);

          // 現在のURLに紐付け
          const presentationId = extractPresentationId();
          if (presentationId) {
            await saveUrlProjectMapping(presentationId, projectId);
          }

          // state を更新
          state.currentProjectId = projectId;

          // UI を更新
          await updateProjectSelector();
          updateProjectUI(newProject);

          // Phase 4: コンテキストインジケーター更新
          await updateContextIndicator();

          console.log('[Gemini Slides] Created new project:', projectId);

          // Phase 6: キックオフURLから自動抽出
          if (kickoffUrl) {
            try {
              showLoadingDialog('キックオフURLからテキストを抽出中...');
              const extractedText = await extractTextFromKickoffUrl(kickoffUrl);

              if (extractedText && !extractedText.includes('エラー')) {
                showLoadingDialog('Gemini APIでコンテキストを解析中...');
                const context = await extractContextWithGemini(extractedText);

                if (context) {
                  showLoadingDialog('コンテキストを保存中...');
                  // 新規プロジェクトなので既存のコンテキストはない→直接設定
                  if (state.ui.contextPurpose) {
                    state.ui.contextPurpose.value = context.purpose || '';
                  }
                  if (state.ui.contextAudience) {
                    state.ui.contextAudience.value = context.audience || '';
                  }
                  await handleSaveContext();
                  hideLoadingDialog();
                  alert('プロジェクトを作成し、キックオフURLからコンテキストを自動設定しました！');
                } else {
                  hideLoadingDialog();
                }
              } else {
                hideLoadingDialog();
              }
            } catch (error) {
              hideLoadingDialog();
              console.error('[Phase 6] Auto-extraction failed:', error);
              // エラーは無視（手動入力にフォールバック）
            }
          }

          resolve(projectId);
        } catch (error) {
          console.error('[Gemini Slides] Failed to create new project:', error);
          alert('プロジェクトの作成に失敗しました: ' + error.message);
          resolve(null);
        }
      });
    });
  }

  /**
   * プロジェクトを削除
   */
  async function handleDeleteProject() {
    if (!state.currentProjectId) {
      alert('削除するプロジェクトを選択してください');
      return;
    }

    const project = await loadProject(state.currentProjectId);
    const projectName = project?.projectName || 'このプロジェクト';

    if (!confirm(`「${projectName}」を削除してもよろしいですか？\n\nこの操作は取り消せません。`)) {
      return;
    }

    try {
      const success = await deleteProject(state.currentProjectId);

      if (success) {
        console.log('[Gemini Slides] Project deleted successfully');

        // stateをクリア
        state.currentProjectId = null;

        // UIをクリア
        if (state.ui.contextPurpose) state.ui.contextPurpose.value = '';
        if (state.ui.contextAudience) state.ui.contextAudience.value = '';

        // 週次コンテキストコンテナをクリア
        const weeklyContainer = shadowRoot.querySelector('#weekly-contexts-container');
        if (weeklyContainer) {
          weeklyContainer.innerHTML = '';
        }

        // プロジェクトセレクターを更新
        await updateProjectSelector();

        // コンテキストインジケーターを更新
        await updateContextIndicator();

        alert('プロジェクトを削除しました');
      } else {
        alert('プロジェクトの削除に失敗しました');
      }
    } catch (error) {
      console.error('[Gemini Slides] Failed to delete project:', error);
      alert('プロジェクトの削除に失敗しました: ' + error.message);
    }
  }

  /**
   * 現在のプロジェクトを読み込む
   */
  async function loadCurrentProject() {
    try {
      const presentationId = extractPresentationId();
      if (!presentationId) {
        console.warn('[Gemini Slides] Could not extract presentation ID');
        await updateProjectSelector();
        return;
      }

      // URLからプロジェクトIDを取得
      const projectId = await getProjectIdByUrl(presentationId);

      // プロジェクトIDが見つからない場合は何もしない
      // detectProjectOnLoad()が類似プロジェクトの確認を行う
      if (!projectId) {
        console.log('[Gemini Slides] No project mapping found for this URL');
        await updateProjectSelector();
        return;
      }

      // 既存のプロジェクトを読み込む
      const projectData = await loadProject(projectId);
      if (projectData) {
        state.currentProjectId = projectId;
        console.log('[Gemini Slides] Loaded existing project:', projectId);
        await updateProjectSelector();
        updateProjectUI(projectData);
      } else {
        console.warn('[Gemini Slides] Project data not found for ID:', projectId);
        await updateProjectSelector();
      }
    } catch (error) {
      console.error('[Gemini Slides] Failed to load current project:', error);
      await updateProjectSelector();
    }
  }

  /**
   * プロジェクトUIを更新
   */
  function updateProjectUI(projectData) {
    if (!projectData) return;

    // 静的コンテキストを表示
    if (state.ui.contextPurpose) {
      state.ui.contextPurpose.value = projectData.staticContext?.purpose || '';
    }
    if (state.ui.contextAudience) {
      state.ui.contextAudience.value = projectData.staticContext?.audience || '';
    }

    // 静的コンテキストが入力済みの場合は折りたたむ
    const hasStaticContext = projectData.staticContext?.purpose || projectData.staticContext?.audience;
    if (hasStaticContext && state.ui.staticContextContent) {
      state.ui.staticContextContent.classList.add('collapsed');
      const toggleIcon = state.ui.staticContextToggle?.querySelector('.toggle-icon');
      if (toggleIcon) {
        toggleIcon.classList.add('collapsed');
      }
    }

    // 週次コンテキストを表示
    renderWeeklyContexts(projectData.externalContexts || []);
  }

  /**
   * 週次コンテキストをレンダリング
   */
  function renderWeeklyContexts(contexts) {
    if (!state.ui.weeklyContextsContainer) return;

    state.ui.weeklyContextsContainer.innerHTML = '';

    // コンテキストがない場合は1つ追加
    if (contexts.length === 0) {
      contexts = [{
        id: `ctx_${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        content: '',
        status: 'empty',
        createdAt: new Date().toISOString()
      }];
    }

    contexts.forEach((context, index) => {
      const contextElement = createWeeklyContextElement(context, index);
      state.ui.weeklyContextsContainer.appendChild(contextElement);
    });
  }

  /**
   * 週次コンテキスト要素を作成
   */
  function createWeeklyContextElement(context, index) {
    const wrapper = document.createElement('div');

    const div = document.createElement('div');
    div.className = 'weekly-input';
    div.dataset.contextId = context.id;

    const date = new Date(context.date || context.createdAt);
    const dateStr = date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });

    div.innerHTML = `
      <div class="weekly-input-header">
        <span class="weekly-input-date" data-date="${context.date || new Date().toISOString().split('T')[0]}">${dateStr}</span>
        ${index > 0 ? '<button class="remove-weekly-button" type="button">×</button>' : ''}
      </div>
      <textarea class="weekly-textarea" placeholder="議事録や関連情報を入力してください">${context.content || ''}</textarea>
    `;

    // 日付の編集機能
    const dateSpan = div.querySelector('.weekly-input-date');
    if (dateSpan) {
      dateSpan.addEventListener('click', () => handleDateEdit(dateSpan));
    }

    // 削除ボタンのイベントリスナー
    const removeButton = div.querySelector('.remove-weekly-button');
    if (removeButton) {
      removeButton.addEventListener('click', () => handleRemoveWeeklyContext(context.id));
    }

    // ホバーで表示される追加ボタンゾーン
    const addZone = document.createElement('div');
    addZone.className = 'weekly-add-zone';
    addZone.innerHTML = '<button class="weekly-add-button" type="button">+</button>';

    const addButton = addZone.querySelector('.weekly-add-button');
    addButton.addEventListener('click', () => handleAddWeeklyContextAfter(context.id));

    wrapper.appendChild(div);
    wrapper.appendChild(addZone);

    return wrapper;
  }

  /**
   * 日付の編集ハンドラー
   */
  function handleDateEdit(dateSpan) {
    // すでに編集中の場合は何もしない
    if (dateSpan.querySelector('.date-input')) return;

    const currentDate = dateSpan.dataset.date;
    const originalText = dateSpan.textContent;

    // 日付入力フィールドを作成
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'date-input';
    input.value = currentDate;

    // 編集状態に変更
    dateSpan.classList.add('editing');
    dateSpan.textContent = '';
    dateSpan.appendChild(input);
    input.focus();

    // 保存処理
    const saveDate = () => {
      const newDate = input.value;
      if (newDate) {
        dateSpan.dataset.date = newDate;
        const dateObj = new Date(newDate);
        const dateStr = dateObj.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
        dateSpan.textContent = dateStr;
      } else {
        dateSpan.textContent = originalText;
      }
      dateSpan.classList.remove('editing');
    };

    // Enterキーまたはフォーカス外で保存
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveDate();
      } else if (e.key === 'Escape') {
        dateSpan.textContent = originalText;
        dateSpan.classList.remove('editing');
      }
    });

    input.addEventListener('blur', () => {
      saveDate();
    });
  }

  /**
   * 静的コンテキストの折りたたみを切り替え
   */
  function handleToggleStaticContext() {
    if (!state.ui.staticContextContent) return;

    state.ui.staticContextContent.classList.toggle('collapsed');
    const toggleIcon = state.ui.staticContextToggle?.querySelector('.toggle-icon');
    if (toggleIcon) {
      toggleIcon.classList.toggle('collapsed');
    }
  }

  /**
   * 指定したコンテキストの後に週次コンテキストを追加
   */
  function handleAddWeeklyContextAfter(afterContextId) {
    const newContext = {
      id: `ctx_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      content: '',
      status: 'empty',
      createdAt: new Date().toISOString()
    };

    // 現在のコンテキストを取得
    const currentContexts = getAllWeeklyContextsFromUI();

    // 指定したIDの後に挿入
    const insertIndex = currentContexts.findIndex(ctx => ctx.id === afterContextId);
    if (insertIndex !== -1) {
      currentContexts.splice(insertIndex + 1, 0, newContext);
    } else {
      currentContexts.push(newContext);
    }

    // 再レンダリング
    renderWeeklyContexts(currentContexts);
  }

  /**
   * 週次コンテキストを削除
   */
  function handleRemoveWeeklyContext(contextId) {
    const currentContexts = getAllWeeklyContextsFromUI();
    const filtered = currentContexts.filter(ctx => ctx.id !== contextId);
    renderWeeklyContexts(filtered);
  }

  /**
   * UIから全ての週次コンテキストを取得
   */
  function getAllWeeklyContextsFromUI() {
    if (!state.ui.weeklyContextsContainer) return [];

    const contexts = [];
    const weeklyInputs = state.ui.weeklyContextsContainer.querySelectorAll('.weekly-input');

    weeklyInputs.forEach(input => {
      const id = input.dataset.contextId;
      const textarea = input.querySelector('.weekly-textarea');
      const content = textarea?.value || '';
      const dateSpan = input.querySelector('.weekly-input-date');
      const date = dateSpan?.dataset.date || new Date().toISOString().split('T')[0];

      contexts.push({
        id: id,
        date: date,
        content: content,
        status: content ? 'filled' : 'empty',
        createdAt: new Date().toISOString()
      });
    });

    return contexts;
  }

  /**
   * コンテキストを保存
   */
  async function handleSaveContext() {
    try {
      console.log('[handleSaveContext] Starting save...');

      if (!state.currentProjectId) {
        console.warn('[Gemini Slides] No current project ID');
        return;
      }

      // 現在のプロジェクトデータを取得
      console.log('[handleSaveContext] Loading project data...');
      const projectData = await loadProject(state.currentProjectId);
      if (!projectData) {
        console.error('[Gemini Slides] Project data not found');
        return;
      }

      // 静的コンテキストを更新
      projectData.staticContext = {
        purpose: state.ui.contextPurpose?.value || '',
        audience: state.ui.contextAudience?.value || ''
      };

      // 週次コンテキストを更新
      projectData.externalContexts = getAllWeeklyContextsFromUI();

      console.log('[handleSaveContext] Saving project data...');
      // 保存
      const success = await saveProject(state.currentProjectId, projectData);

      if (success) {
        console.log('[Gemini Slides] Context saved successfully');
        // 成功メッセージを表示（プロジェクトセレクトの背景色を一時的に変更）
        if (state.ui.projectSelect) {
          const originalBg = state.ui.projectSelect.style.background;
          const originalBorder = state.ui.projectSelect.style.borderColor;
          state.ui.projectSelect.style.background = 'rgba(16, 185, 129, 0.2)';
          state.ui.projectSelect.style.borderColor = 'rgba(16, 185, 129, 0.5)';
          setTimeout(() => {
            state.ui.projectSelect.style.background = originalBg;
            state.ui.projectSelect.style.borderColor = originalBorder;
          }, 1500);
        }

        console.log('[handleSaveContext] Updating context indicator...');
        // Phase 4: コンテキストインジケーター更新（タイムアウト付き）
        try {
          await Promise.race([
            updateContextIndicator(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('updateContextIndicator timeout')), 3000)
            )
          ]);
        } catch (error) {
          console.warn('[handleSaveContext] Context indicator update failed or timed out:', error);
        }

        console.log('[handleSaveContext] Updating storage info...');
        // Phase 5: ストレージ情報更新（タイムアウト付き）
        try {
          await Promise.race([
            updateStorageInfo(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('updateStorageInfo timeout')), 3000)
            )
          ]);
        } catch (error) {
          console.warn('[handleSaveContext] Storage info update failed or timed out:', error);
        }

        console.log('[handleSaveContext] Save completed successfully');
      } else {
        console.error('[Gemini Slides] Failed to save context');
      }
    } catch (error) {
      console.error('[Gemini Slides] Error saving context:', error);
    }
  }

  /**
   * Phase 6: キックオフURLからコンテキストを抽出（UIのみ実装）
   */
  async function handleExtractFromKickoff() {
    // プロジェクトが選択されているか確認
    if (!state.currentProjectId) {
      alert('プロジェクトを選択してください');
      return;
    }

    // キックオフURL入力ダイアログを表示
    return new Promise((resolve) => {
      const dialogHTML = `
        <div class="create-project-dialog">
          <div class="dialog-overlay"></div>
          <div class="dialog-content">
            <div class="dialog-title">キックオフURLから取得</div>

            <div class="form-group">
              <label class="form-label" for="kickoff-url-extract-input">キックオフURL</label>
              <input
                type="url"
                id="kickoff-url-extract-input"
                class="form-input"
                placeholder="https://docs.google.com/presentation/d/..."
              />
              <div class="form-hint">Google SlidesのURLを入力してください。コンテキストを自動的に抽出し、既存の情報に追記します。</div>
            </div>

            <div class="dialog-actions">
              <button class="button secondary" id="dialog-cancel-extract">キャンセル</button>
              <button class="button primary" id="dialog-extract">抽出</button>
            </div>
          </div>
        </div>
      `;

      const dialogContainer = document.createElement('div');
      dialogContainer.innerHTML = dialogHTML;
      shadowRoot.appendChild(dialogContainer.firstElementChild);

      const dialog = shadowRoot.querySelector('.create-project-dialog');
      const overlay = dialog.querySelector('.dialog-overlay');
      const cancelButton = dialog.querySelector('#dialog-cancel-extract');
      const extractButton = dialog.querySelector('#dialog-extract');
      const urlInput = dialog.querySelector('#kickoff-url-extract-input');

      // キャンセル処理
      const handleCancel = () => {
        dialog.remove();
        resolve(null);
      };

      overlay.addEventListener('click', handleCancel);
      cancelButton.addEventListener('click', handleCancel);

      // 抽出処理
      extractButton.addEventListener('click', async () => {
        const kickoffUrl = urlInput.value.trim();

        if (!kickoffUrl) {
          alert('URLを入力してください');
          return;
        }

        // URLバリデーション（基本的なチェック）
        if (!kickoffUrl.startsWith('https://docs.google.com/presentation/')) {
          alert('Google SlidesのURLを入力してください');
          return;
        }

        dialog.remove();

        // Phase 6-2, 6-3, 6-4: 実際の抽出処理
        try {
          console.log('[extractFromKickoffUrl] Starting extraction process...');
          showLoadingDialog('キックオフURLからテキストを抽出中...');

          // Step 1: URLからテキストを抽出
          console.log('[extractFromKickoffUrl] Step 1: Extracting text from URL...');
          const extractedText = await extractTextFromKickoffUrl(kickoffUrl);

          if (!extractedText || extractedText.includes('エラー')) {
            hideLoadingDialog();
            alert('テキストの抽出に失敗しました。\n\n' + extractedText);
            resolve(null);
            return;
          }

          console.log('[extractFromKickoffUrl] Text extracted successfully, length:', extractedText.length);
          showLoadingDialog('Gemini APIでコンテキストを解析中...');

          // Step 2: Gemini APIでコンテキストを抽出
          console.log('[extractFromKickoffUrl] Step 2: Extracting context with Gemini...');
          const context = await extractContextWithGemini(extractedText);

          if (!context) {
            hideLoadingDialog();
            alert('コンテキストの抽出に失敗しました。手動で入力してください。');
            resolve(null);
            return;
          }

          console.log('[extractFromKickoffUrl] Context extracted successfully:', context);
          showLoadingDialog('既存のコンテキストとマージ中...');

          // Step 3: 既存のコンテキストと差分マージ
          console.log('[extractFromKickoffUrl] Step 3: Merging context...');
          await mergeExtractedContext(context);

          console.log('[extractFromKickoffUrl] All steps completed successfully');
          hideLoadingDialog();
          alert('キックオフURLからコンテキストを取得しました！\n\nProject Contextセクションを確認してください。');
          resolve(context);
        } catch (error) {
          hideLoadingDialog();
          console.error('[Phase 6] Extraction failed:', error);
          alert('抽出中にエラーが発生しました:\n\n' + error.message);
          resolve(null);
        }
      });
    });
  }

  /**
   * Phase 6-2: URLからテキストを抽出（Background scriptに依頼）
   */
  async function extractTextFromKickoffUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'EXTRACT_FROM_KICKOFF_URL',
          url: url
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response && response.ok) {
            resolve(response.text);
          } else {
            reject(new Error(response?.error || 'テキストの抽出に失敗しました'));
          }
        }
      );
    });
  }

  /**
   * Phase 6-3: Gemini APIでコンテキストを抽出
   */
  async function extractContextWithGemini(rawText) {
    console.log('[extractContextWithGemini] Starting context extraction...');

    const prompt = `以下はGoogle Slidesから抽出されたテキストです。このテキストから、プレゼンテーションのコンテキスト情報を抽出してください。

抽出するべき情報：
1. purpose（目的）: このプレゼンテーションの目的や目標
2. audience（対象者）: 想定される聴衆や対象者

必ず以下のJSON形式で回答してください。他の説明文は含めないでください：
{
  "purpose": "抽出された目的",
  "audience": "抽出された対象者"
}

情報が見つからない場合は、空文字列を返してください。

テキスト：
${rawText}`;

    try {
      console.log('[extractContextWithGemini] Sending request to background script...');
      // Background scriptにGemini APIリクエストを送信
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'GEMINI_EXTRACT_CONTEXT',
            prompt: prompt
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      });

      console.log('[extractContextWithGemini] Received response:', response);

      if (!response || !response.ok) {
        throw new Error(response?.error || 'Gemini APIの呼び出しに失敗しました');
      }

      // JSONをパース
      const text = response.result.text;
      console.log('[Phase 6] Gemini response:', text);

      // JSON部分を抽出（マークダウンのコードブロックに囲まれている可能性があるため）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSONが見つかりませんでした');
      }

      const context = JSON.parse(jsonMatch[0]);
      console.log('[extractContextWithGemini] Parsed context:', context);
      return context;
    } catch (error) {
      console.error('[Phase 6] Gemini extraction failed:', error);
      throw error;
    }
  }

  /**
   * Phase 6-4: 抽出されたコンテキストを既存のコンテキストとマージ
   */
  async function mergeExtractedContext(extractedContext) {
    console.log('[mergeExtractedContext] Starting merge...', extractedContext);

    if (!state.currentProjectId) {
      throw new Error('プロジェクトが選択されていません');
    }

    console.log('[mergeExtractedContext] Loading project:', state.currentProjectId);
    const projectData = await loadProject(state.currentProjectId);
    if (!projectData) {
      throw new Error('プロジェクトデータが見つかりません');
    }

    console.log('[mergeExtractedContext] Project data loaded:', projectData);

    // 既存のコンテキストを取得
    const existingPurpose = projectData.staticContext?.purpose || '';
    const existingAudience = projectData.staticContext?.audience || '';

    // 差分をチェックして追記
    let newPurpose = existingPurpose;
    let newAudience = existingAudience;

    if (extractedContext.purpose) {
      if (existingPurpose && !existingPurpose.includes(extractedContext.purpose)) {
        // 既存の情報があり、新しい情報が含まれていない場合は追記
        newPurpose = existingPurpose + '\n\n' + extractedContext.purpose;
      } else if (!existingPurpose) {
        // 既存の情報がない場合は新しい情報をセット
        newPurpose = extractedContext.purpose;
      }
      // 既に含まれている場合は何もしない
    }

    if (extractedContext.audience) {
      if (existingAudience && !existingAudience.includes(extractedContext.audience)) {
        newAudience = existingAudience + '\n\n' + extractedContext.audience;
      } else if (!existingAudience) {
        newAudience = extractedContext.audience;
      }
    }

    console.log('[mergeExtractedContext] Updating UI with new values...');

    // UIを更新
    if (state.ui.contextPurpose) {
      state.ui.contextPurpose.value = newPurpose;
    }
    if (state.ui.contextAudience) {
      state.ui.contextAudience.value = newAudience;
    }

    console.log('[mergeExtractedContext] Saving context...');

    // 自動保存（タイムアウト付き）
    try {
      await Promise.race([
        handleSaveContext(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Save context timeout after 10 seconds')), 10000)
        )
      ]);
      console.log('[Phase 6] Context merged and saved');
    } catch (error) {
      console.error('[mergeExtractedContext] Failed to save context:', error);
      throw error;
    }
  }

  /**
   * Phase 6: ローディングダイアログを表示
   */
  function showLoadingDialog(message = 'Loading...') {
    const loadingHTML = `
      <div class="loading-overlay" id="loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">${message}</div>
        </div>
      </div>
    `;

    const loadingContainer = document.createElement('div');
    loadingContainer.innerHTML = loadingHTML;
    shadowRoot.appendChild(loadingContainer.firstElementChild);
  }

  /**
   * Phase 6: ローディングダイアログを非表示
   */
  function hideLoadingDialog() {
    const loadingOverlay = shadowRoot.querySelector('#loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.remove();
    }
  }

  // ========================================
  // Phase 4: レビュー統合
  // ========================================

  /**
   * プロジェクトのコンテキスト情報を統合し、プロンプト用のテキストを生成
   * @returns {Promise<string>} - 統合されたコンテキストプロンプト
   */
  async function buildContextPrompt() {
    try {
      const presentationId = extractPresentationId(window.location.href);
      if (!presentationId) {
        return ''; // コンテキストなし
      }

      const projectId = await getProjectIdByUrl(presentationId);
      if (!projectId) {
        return ''; // プロジェクト未設定
      }

      const project = await loadProject(projectId);
      if (!project) {
        return '';
      }

      let contextPrompt = '';

      // 1. プロジェクトコンテキスト（静的）
      if (project.staticContext.purpose || project.staticContext.audience) {
        contextPrompt += '[プロジェクトコンテキスト]\n';

        if (project.staticContext.purpose) {
          contextPrompt += `目的: ${project.staticContext.purpose}\n`;
        }

        if (project.staticContext.audience) {
          contextPrompt += `対象者: ${project.staticContext.audience}\n`;
        }

        contextPrompt += '\n';
      }

      // 2. 外部コンテキスト（動的、日付の新しい順）
      const filledContexts = project.externalContexts
        .filter(c => c.status === 'filled' && c.content.trim())
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      if (filledContexts.length > 0) {
        filledContexts.forEach(context => {
          contextPrompt += `[外部コンテキスト - ${context.date}]\n`;
          contextPrompt += `${context.content}\n\n`;
        });
      }

      return contextPrompt;
    } catch (error) {
      console.error('[Context Builder] Failed to build context prompt:', error);
      return '';
    }
  }

  /**
   * コンテキストインジケーターを更新
   */
  async function updateContextIndicator() {
    const indicator = shadowRoot?.querySelector('#context-indicator');
    if (!indicator) return;

    const contextPrompt = await buildContextPrompt();

    if (contextPrompt) {
      indicator.classList.add('active');
      const textElement = indicator.querySelector('.indicator-text');
      if (textElement) {
        textElement.textContent = 'Context: Active';
      }
    } else {
      indicator.classList.remove('active');
      const textElement = indicator.querySelector('.indicator-text');
      if (textElement) {
        textElement.textContent = 'Context: None';
      }
    }
  }

  // ========================================
  // Phase 3: インテリジェント機能
  // ========================================

  /**
   * ページ読み込み時にプロジェクトを自動検出
   * 新規URLの場合、タイトル類似度でプロジェクトを推測し、ユーザーに確認
   */
  async function detectProjectOnLoad() {
    try {
      const presentationId = extractPresentationId(window.location.href);
      if (!presentationId) {
        console.warn('[Project Detection] Cannot extract presentation ID');
        return;
      }

      // 既にマッピングが存在するか確認
      const existingProjectId = await getProjectIdByUrl(presentationId);
      if (existingProjectId) {
        console.log('[Project Detection] Existing project found:', existingProjectId);
        return; // 既存プロジェクトがあれば何もしない
      }

      // 新規URL: タイトル類似度チェック
      const currentTitle = await getPresentationTitle();
      if (!currentTitle) {
        console.warn('[Project Detection] Cannot get presentation title');
        return;
      }

      const allProjects = await getAllProjects();
      const similarProjects = findSimilarProjects(currentTitle, allProjects);

      if (similarProjects.length > 0) {
        // 類似プロジェクトが見つかった場合、ユーザーに確認
        await showProjectLinkingDialog(presentationId, currentTitle, similarProjects);
      } else {
        // 類似プロジェクトがない場合、何もしない（ユーザーが手動で作成）
        console.log('[Project Detection] No similar projects found');
      }
    } catch (error) {
      console.error('[Project Detection] Error during project detection:', error);
    }
  }

  /**
   * タイトルが類似しているプロジェクトを検索
   * @param {string} title - 現在のプレゼンテーションタイトル
   * @param {object} allProjects - すべてのプロジェクト
   * @returns {Array} - 類似プロジェクトの配列 [{projectId, projectName, similarity}, ...]
   */
  function findSimilarProjects(title, allProjects) {
    const similar = [];

    for (const [projectId, project] of Object.entries(allProjects)) {
      if (isSimilarTitle(title, project.projectName)) {
        similar.push({
          projectId,
          projectName: project.projectName,
          createdAt: project.createdAt
        });
      }
    }

    // 作成日時の新しい順にソート
    similar.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return similar;
  }

  /**
   * プロジェクト紐付け確認ダイアログを表示
   * @param {string} presentationId - 現在のプレゼンテーションID
   * @param {string} currentTitle - 現在のタイトル
   * @param {Array} similarProjects - 類似プロジェクトのリスト
   */
  async function showProjectLinkingDialog(presentationId, currentTitle, similarProjects) {
    // ダイアログ要素を作成
    const dialog = document.createElement('div');
    dialog.className = 'project-linking-dialog';
    dialog.innerHTML = `
      <div class="dialog-overlay"></div>
      <div class="dialog-content">
        <h2>Link to Existing Project?</h2>
        <p>Found projects with similar names to "${currentTitle}".</p>
        <p>Is this slide related to an existing project?</p>

        <div class="project-options">
          ${similarProjects.map(proj => `
            <label class="project-option">
              <input type="radio" name="project-choice" value="${proj.projectId}">
              <span>${proj.projectName}</span>
              <small>(Created: ${new Date(proj.createdAt).toLocaleDateString()})</small>
            </label>
          `).join('')}
          <label class="project-option">
            <input type="radio" name="project-choice" value="skip" checked>
            <span>Skip (I'll create manually later)</span>
          </label>
        </div>

        <div class="dialog-actions">
          <button class="button secondary" id="dialog-cancel">Cancel</button>
          <button class="button" id="dialog-confirm">Confirm</button>
        </div>
      </div>
    `;

    shadowRoot.appendChild(dialog);

    // ダイアログのイベントリスナー
    return new Promise((resolve) => {
      const confirmButton = dialog.querySelector('#dialog-confirm');
      const cancelButton = dialog.querySelector('#dialog-cancel');

      confirmButton.addEventListener('click', async () => {
        const selectedOption = dialog.querySelector('input[name="project-choice"]:checked');
        const selectedValue = selectedOption?.value;

        if (selectedValue && selectedValue !== 'skip') {
          // 既存プロジェクトに紐付け
          await saveUrlProjectMapping(presentationId, selectedValue);
          state.currentProjectId = selectedValue;
          console.log(`[Project Detection] Linked to existing project: ${selectedValue}`);

          // UIを更新
          await updateProjectSelector();
          const project = await loadProject(selectedValue);
          if (project) {
            updateProjectUI(project);
            await updateContextIndicator();
          }
        }

        // ダイアログを閉じる
        dialog.remove();
        resolve();
      });

      cancelButton.addEventListener('click', () => {
        dialog.remove();
        resolve();
      });
    });
  }

  /**
   * 週次入力欄を自動生成（必要に応じて）
   * 設定された曜日になったら、新しい入力欄を追加
   */
  async function generateWeeklyContextIfNeeded() {
    try {
      if (!state.currentProjectId) {
        return; // プロジェクトが設定されていない場合は何もしない
      }

      const project = await loadProject(state.currentProjectId);
      if (!project) return;

      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=日曜, 1=月曜, ..., 6=土曜

      // 設定された曜日と一致するか確認
      if (dayOfWeek !== project.weeklyInputDay) {
        return; // 今日は週次入力日ではない
      }

      // 今日の日付
      const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

      // 既に今日の日付の入力欄が存在するか確認
      const existingContext = project.externalContexts.find(c => c.date === todayStr);
      if (existingContext) {
        console.log('[Weekly Context] Today\'s context already exists');
        return;
      }

      // 新しい週次入力欄を作成
      const newContext = {
        id: `ctx_${Date.now()}`,
        date: todayStr,
        content: '',
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      project.externalContexts.push(newContext);
      await saveProject(state.currentProjectId, project);

      console.log('[Weekly Context] New weekly context created for', todayStr);

      // UIが表示されていて、Contextタブが開いている場合は再描画
      if (state.isPanelVisible && state.currentTab === 'context') {
        renderExternalContexts(project.externalContexts);
      }
    } catch (error) {
      console.error('[Weekly Context] Failed to generate weekly context:', error);
    }
  }

  /**
   * 3週間以上前のpending状態の入力欄を自動削除
   */
  async function cleanupOldPendingContexts() {
    try {
      if (!state.currentProjectId) {
        return;
      }

      const project = await loadProject(state.currentProjectId);
      if (!project || !project.externalContexts) return;

      const threeWeeksAgo = new Date();
      threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);

      const originalCount = project.externalContexts.length;

      // 3週間以上前のpending状態のコンテキストを削除
      project.externalContexts = project.externalContexts.filter(context => {
        if (context.status !== 'pending') {
          return true; // filled状態のものは保持
        }

        const contextDate = new Date(context.createdAt || context.date);
        return contextDate >= threeWeeksAgo; // 3週間以内のものは保持
      });

      const deletedCount = originalCount - project.externalContexts.length;

      if (deletedCount > 0) {
        await saveProject(state.currentProjectId, project);
        console.log(`[Context Cleanup] Deleted ${deletedCount} old pending contexts`);

        // UIが表示されていて、Contextタブが開いている場合は再描画
        if (state.isPanelVisible && state.currentTab === 'context') {
          renderExternalContexts(project.externalContexts);
        }
      }
    } catch (error) {
      console.error('[Context Cleanup] Failed to cleanup old contexts:', error);
    }
  }

  /**
   * 定期的なメンテナンス処理を開始
   * - 週次入力欄の自動生成
   * - 古い空欄の自動削除
   */
  function startPeriodicMaintenance() {
    // 初回実行
    generateWeeklyContextIfNeeded();
    cleanupOldPendingContexts();

    // 1日1回実行（24時間ごと）
    setInterval(() => {
      generateWeeklyContextIfNeeded();
      cleanupOldPendingContexts();
    }, 24 * 60 * 60 * 1000); // 24時間
  }

  // ========================================
  // Phase 5: 快適性向上
  // ========================================

  /**
   * エラーハンドリングを統一
   * @param {Error} error - エラーオブジェクト
   * @param {string} context - エラーが発生したコンテキスト
   */
  function handleError(error, context = '') {
    console.error(`[Gemini Slides] Error${context ? ` in ${context}` : ''}:`, error);

    let userMessage = '';

    if (error.message?.includes('Extension context invalidated')) {
      userMessage = 'Extension was reloaded. Please refresh the page.';
    } else if (error.message?.includes('API key')) {
      userMessage = 'API key is not set. Please configure it in extension options.';
    } else if (error.message?.includes('Network')) {
      userMessage = 'Network error occurred. Please check your internet connection.';
    } else if (error.message?.includes('quota')) {
      userMessage = 'API quota exceeded. Please try again later.';
    } else {
      userMessage = `Error: ${error.message}`;
    }

    setStatus(userMessage, 'error');
  }

  // ========================================
  // Phase 7: ピン留めフィードバック UI
  // ========================================

  async function initializePinFeature() {
    if (state.pinFeatureInitialized) {
      renderFeedbackList();
      renderPinsForCurrentSlide();
      return;
    }

    injectPinStyles();
    ensurePinOverlay();

    document.addEventListener("keydown", handlePinKeydown, true);

    if (!state.pinResizeHandler) {
      state.pinResizeHandler = debounce(updatePinOverlayBounds, 150);
    }
    window.addEventListener("resize", state.pinResizeHandler);
    window.addEventListener("scroll", state.pinResizeHandler, true);

    startPinSlideWatcher();
    registerPinDebugAPI();

    // Phase 7-2A: ストレージから復元
    const presentationId = extractPresentationId(window.location.href);
    let restoredFromStorage = false;

    if (presentationId) {
      const savedPins = await loadPinsFromStorage(presentationId);
      const savedFeedback = await loadFeedbackFromStorage(presentationId);

      if (Object.keys(savedPins).length > 0 || savedFeedback.length > 0) {
        // ストレージにデータがある場合は復元
        if (Object.keys(savedPins).length > 0) {
          state.pinsBySlide = savedPins;
          console.log('[Pins] Restored from storage:', Object.keys(savedPins).length, 'slides');
        }

        if (savedFeedback.length > 0) {
          state.feedbackItems = savedFeedback;
          console.log('[Feedback] Restored from storage:', savedFeedback.length, 'items');
        }

        restoredFromStorage = true;
        renderFeedbackList();
        updatePinOverlayVisibility();
      }
    }

    // ストレージから復元しなかった場合のみ、初期化処理を実行
    if (!restoredFromStorage) {
      if (shouldLoadPinMockData()) {
        setFeedbackItems(getMockFeedbackItems());
      } else if (!state.feedbackItems.length) {
        setFeedbackItems([]);
      } else {
        regeneratePinsFromFeedback();
        renderFeedbackList();
        updatePinOverlayVisibility();
      }
    }

    updatePinOverlayBounds();
    renderPinsForCurrentSlide();

    state.pinFeatureInitialized = true;
  }

  function injectPinStyles() {
    if (document.getElementById("gemini-pin-overlay-styles")) return;
    const style = document.createElement("style");
    style.id = "gemini-pin-overlay-styles";
    style.textContent = `
#gemini-pin-overlay {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 2147483648;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#gemini-pin-overlay.is-visible {
  opacity: 1;
}
#gemini-pin-overlay .gemini-pin-overlay__canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
#gemini-pin-overlay.pin-mode .gemini-pin-overlay__canvas {
  pointer-events: auto;
  cursor: crosshair;
}
#gemini-pin-overlay .gemini-pin-overlay__pins {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
#gemini-pin-overlay .gemini-pin-overlay__targets {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
#gemini-pin-overlay .gemini-pin-overlay__target {
  position: absolute;
  border: 2px solid rgba(138,180,248,0.55);
  background: rgba(138,180,248,0.2);
  box-shadow: 0 8px 20px rgba(0,0,0,0.35);
  border-radius: 12px;
  opacity: 0.6;
  transition: opacity 0.2s ease, box-shadow 0.2s ease;
  pointer-events: none;
  box-sizing: border-box;
}
#gemini-pin-overlay .gemini-pin-overlay__target.is-open {
  opacity: 0.95;
  box-shadow: 0 12px 28px rgba(0,0,0,0.45);
}
#gemini-pin-overlay .gemini-pin {
  position: absolute;
  pointer-events: auto;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  transform: translate(-50%, 0);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 1;
}
#gemini-pin-overlay .gemini-pin__icon {
  background: #1a73e8;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(26, 115, 232, 0.35);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__icon {
  background: #8ab4f8;
  color: #202124;
}
#gemini-pin-overlay .gemini-pin__bubble {
  position: absolute;
  min-width: 150px;
  max-width: 220px;
  background: rgba(32,33,36,0.92);
  color: #e8eaed;
  border: 1px solid rgba(138,180,248,0.35);
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 12px 24px rgba(0,0,0,0.35);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s ease;
  pointer-events: auto;
  box-sizing: border-box;
  z-index: 2;
  white-space: nowrap;
}

/* デフォルト位置: 右側 */
#gemini-pin-overlay .gemini-pin__bubble[data-position="right"] {
  left: calc(100% + 12px);
  top: 50%;
  transform: translate(0, -50%);
}
#gemini-pin-overlay .gemini-pin__bubble[data-position="left"] {
  right: calc(100% + 12px);
  top: 50%;
  transform: translate(0, -50%);
}
#gemini-pin-overlay .gemini-pin__bubble[data-position="top"] {
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translate(-50%, 0);
}
#gemini-pin-overlay .gemini-pin__bubble[data-position="bottom"] {
  top: calc(100% + 12px);
  left: 50%;
  transform: translate(-50%, 0);
}

/* 矢印の位置調整 */
#gemini-pin-overlay .gemini-pin__bubble::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  background: rgba(32,33,36,0.92);
  border: 1px solid rgba(138,180,248,0.35);
  transform: rotate(45deg);
}
/* 右側表示時: 矢印は左 */
#gemini-pin-overlay .gemini-pin__bubble[data-arrow-class="arrow-left"]::before {
  left: -6px;
  top: calc(50% - 6px);
  border-right: none;
  border-bottom: none;
}
/* 左側表示時: 矢印は右 */
#gemini-pin-overlay .gemini-pin__bubble[data-arrow-class="arrow-right"]::before {
  right: -6px;
  top: calc(50% - 6px);
  border-left: none;
  border-top: none;
}
/* 上側表示時: 矢印は下 */
#gemini-pin-overlay .gemini-pin__bubble[data-arrow-class="arrow-bottom"]::before {
  bottom: -6px;
  left: calc(50% - 6px);
  border-top: none;
  border-left: none;
}
/* 下側表示時: 矢印は上 */
#gemini-pin-overlay .gemini-pin__bubble[data-arrow-class="arrow-top"]::before {
  top: -6px;
  left: calc(50% - 6px);
  border-bottom: none;
  border-right: none;
}
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__bubble,
#gemini-pin-overlay .gemini-pin:hover .gemini-pin__bubble {
  opacity: 1;
  visibility: visible;
}
/* 位置ごとのホバー時トランスフォーム */
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__bubble[data-position="right"],
#gemini-pin-overlay .gemini-pin:hover .gemini-pin__bubble[data-position="right"] {
  transform: translate(0, -50%);
}
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__bubble[data-position="left"],
#gemini-pin-overlay .gemini-pin:hover .gemini-pin__bubble[data-position="left"] {
  transform: translate(0, -50%);
}
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__bubble[data-position="top"],
#gemini-pin-overlay .gemini-pin:hover .gemini-pin__bubble[data-position="top"] {
  transform: translate(-50%, 0);
}
#gemini-pin-overlay .gemini-pin.is-open .gemini-pin__bubble[data-position="bottom"],
#gemini-pin-overlay .gemini-pin:hover .gemini-pin__bubble[data-position="bottom"] {
  transform: translate(-50%, 0);
}
#gemini-pin-overlay .gemini-pin__bubble-title {
  font-size: 12px;
  font-weight: 600;
  display: block;
  margin: 0;
}
#gemini-pin-overlay .gemini-pin__bubble-body {
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
}
#gemini-pin-overlay .gemini-pin-overlay__hint {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(32,33,36,0.88);
  color: #e8eaed;
  border: 1px solid rgba(138,180,248,0.35);
  pointer-events: auto;
  font-size: 12px;
}
#gemini-pin-overlay.pin-mode .gemini-pin-overlay__hint {
  display: inline-flex;
}
#gemini-pin-overlay .gemini-pin-overlay__hint button {
  background: rgba(60,64,67,0.8);
  border: 1px solid rgba(138,180,248,0.3);
  color: #e8eaed;
  border-radius: 16px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
#gemini-pin-overlay .gemini-pin-overlay__hint button:hover {
  background: rgba(95,99,104,0.8);
}

/* 一時的な吹き出しのスタイル */
.gemini-temp-bubble {
  position: absolute;
  min-width: 200px;
  max-width: 320px;
  background: rgba(32,33,36,0.95);
  color: #e8eaed;
  border: 1px solid rgba(138,180,248,0.4);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  pointer-events: auto;
  z-index: 10;
  animation: bubbleFadeIn 0.3s ease;
}

@keyframes bubbleFadeIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.gemini-temp-bubble-content {
  padding: 16px;
  position: relative;
}

.gemini-temp-bubble-title {
  font-size: 14px;
  font-weight: 600;
  color: #8ab4f8;
  margin-bottom: 8px;
  display: block;
}

.gemini-temp-bubble-body {
  font-size: 13px;
  line-height: 1.6;
  color: #e8eaed;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.gemini-temp-bubble-close {
  position: absolute;
  top: 8px;
  right: 8px;
  background: transparent;
  border: none;
  color: #9aa0a6;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  transition: color 0.2s ease;
}

.gemini-temp-bubble-close:hover {
  color: #e8eaed;
}

/* 一時的なハイライト矩形 */
.gemini-temp-highlight {
  position: absolute;
  border: 2px solid rgba(138,180,248,0.8);
  background: rgba(138,180,248,0.15);
  box-shadow: 0 8px 20px rgba(138,180,248,0.3);
  border-radius: 8px;
  pointer-events: none;
  animation: highlightPulse 2s ease infinite;
}

@keyframes highlightPulse {
  0%, 100% {
    opacity: 0.8;
  }
  50% {
    opacity: 0.4;
  }
}
`;
    document.head.appendChild(style);
  }

  function ensurePinOverlay() {
    if (state.pinOverlay) return;
    const existing = document.getElementById("gemini-pin-overlay");
    if (existing) {
      existing.remove();
    }
    const overlay = document.createElement("div");
    overlay.id = "gemini-pin-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="gemini-pin-overlay__canvas"></div>
      <div class="gemini-pin-overlay__targets"></div>
      <div class="gemini-pin-overlay__pins" aria-live="polite"></div>
      <div class="gemini-pin-overlay__hint">
        <span>スライドをクリックしてピンを配置</span>
        <button type="button" class="gemini-pin-overlay__hint-cancel">キャンセル (Esc)</button>
      </div>
    `;
    document.body.appendChild(overlay);

    state.pinOverlay = overlay;
    state.pinOverlayCanvas = overlay.querySelector(".gemini-pin-overlay__canvas");
    state.pinOverlayTargets = overlay.querySelector(".gemini-pin-overlay__targets");
    state.pinOverlayPins = overlay.querySelector(".gemini-pin-overlay__pins");
    state.pinOverlayHint = overlay.querySelector(".gemini-pin-overlay__hint");

    state.pinOverlayCanvas?.addEventListener("click", handlePinOverlayClick);
    state.pinOverlayPins?.addEventListener("click", handlePinContainerClick);

    const cancelButton = overlay.querySelector(".gemini-pin-overlay__hint-cancel");
    cancelButton?.addEventListener("click", () => exitPinMode("cancel-button"));
  }

  function getMockFeedbackItems() {
    return [
      {
        id: "feedback-mock-1",
        title: "グラフの結論を先に提示しましょう",
        summary: "スライド2のグラフは補助線が多く視線が泳ぎます。強調色を1つに絞り、結論テキストをグラフの直上に配置すると理解が早まります。",
        anchors: [
          {
            slidePage: 2,
            rect: { x: 0.54, y: 0.32, width: 0.28, height: 0.36 }
          }
        ]
      },
      {
        id: "feedback-mock-2",
        title: "導入文に観点が不足しています",
        summary: "スライド1のリード文が抽象的です。「現状課題」「提案方針」の2点を冒頭で明示すると聞き手が目的を掴みやすくなります。",
        anchors: [
          {
            slidePage: 1,
            rect: { x: 0.25, y: 0.22, width: 0.42, height: 0.26 }
          }
        ]
      },
      {
        id: "feedback-mock-3",
        title: "CTAボタンのコントラストを調整",
        summary: "スライド4の行動喚起ボタンが背景と近い色味です。彩度を上げるか、外枠を追加して視認性を上げましょう。",
        anchors: [
          {
            slidePage: 4,
            rect: { x: 0.65, y: 0.68, width: 0.18, height: 0.14 }
          }
        ]
      }
    ];
  }

  function shouldLoadPinMockData() {
    if (window.__GEMINI_PINS_DEMO__ === true) {
      return true;
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (params.has("geminiPinsDemo")) {
        return true;
      }
    } catch (error) {
      // ignore malformed URL search params
    }
    return false;
  }

  function setFeedbackItems(items) {
    state.feedbackItems = Array.isArray(items)
      ? items.map((item) => ({ ...item }))
      : [];
    regeneratePinsFromFeedback();
    renderFeedbackList();
    updatePinOverlayVisibility();
  }

  function updateFeedbackFromResult(text) {
    const items = parseGeminiFeedbackText(text);
    console.log('[Gemini Slides] Parsed feedback items:', items);
    const enrichedItems = enrichFeedbackWithSlideIds(items);
    console.log('[Gemini Slides] Enriched with slideIds:', enrichedItems);
    setFeedbackItems(enrichedItems);
    focusInitialAnchor(enrichedItems);
  }

  /**
   * フィードバックアイテムのanchorsに現在のslideIdを追加
   * @param {Array} items - フィードバックアイテムの配列
   * @returns {Array} slideIdが追加されたフィードバックアイテムの配列
   */
  function enrichFeedbackWithSlideIds(items) {
    if (!Array.isArray(items)) return items;

    const currentSlideId = getCurrentSlideId();
    const currentSlideIndex = getActiveSlideIndex();

    if (!currentSlideId) {
      console.warn('[Gemini Slides] No slideId found in URL');
    }
    if (currentSlideIndex < 0) {
      console.warn('[Gemini Slides] No valid slideIndex found');
    }

    return items.map(item => {
      if (!Array.isArray(item.anchors) || item.anchors.length === 0) {
        return item;
      }

      const enrichedAnchors = item.anchors.map(anchor => ({
        ...anchor,
        slideId: currentSlideId,      // スライドID
        slideIndex: currentSlideIndex // フィルムストリップのインデックス（0始まり）
      }));

      return {
        ...item,
        anchors: enrichedAnchors
      };
    });
  }

  function appendFeedbackFormatInstructions(promptText) {
    const base = (promptText || "").trim();
    const marker = "[出力フォーマット]";
    if (!base) {
      return formatFeedbackSpecification(marker);
    }
    if (base.includes(marker) || base.includes("[OUTPUT FORMAT]")) {
      return base;
    }
    return `${base}\n\n${formatFeedbackSpecification(marker)}`;
  }

  async function focusInitialAnchor(items) {
    const list = Array.isArray(items) ? items : state.feedbackItems;
    if (!Array.isArray(list) || !list.length) return;
    const targetItem = list.find((item) => Array.isArray(item?.anchors) && item.anchors.length > 0)
      || list.find((item) => item.slidePage);
    if (!targetItem) return;

    const firstAnchor = Array.isArray(targetItem.anchors) && targetItem.anchors.length > 0
      ? targetItem.anchors[0]
      : null;
    const targetSlide = firstAnchor?.slidePage
      || normalizeSlidePage(targetItem.slidePage ?? targetItem.page ?? targetItem.slide ?? targetItem.pageNumber ?? targetItem.pageIndex);

    if (!targetSlide) return;

    const focusPin = () => {
      const pins = findPinsByFeedback(targetItem.id);
      if (pins.length) {
        const pin = pins[0];
        renderPinsForCurrentSlide();
        setOpenPin(pin.pinId, { scrollIntoView: true });
      } else {
        renderPinsForCurrentSlide();
      }
    };

    const currentSlide = getCurrentSlidePageNumber();
    if (currentSlide === targetSlide) {
      focusPin();
      return;
    }

    // ユーザーに手動でスライドを開くよう促す
    showSlideMessage(targetSlide, `スライド ${targetSlide} を開くとピンが表示されます`, "info");
  }

  function formatFeedbackSpecification(marker) {
    return `${marker}
以下のJSONのみをMarkdownの\`\`\`json コードブロック内で出力してください。他の文章や説明は不要です。
\`\`\`json
{
  "feedbackItems": [
    {
      "id": "string (一意のID。無い場合は生成)",
      "title": "短い指摘タイトル",
      "summary": "詳細な説明と改善提案",
      "slidePage": 1,
      "anchors": [
        {
          "slidePage": 1,
          "rect": { "x": 0.12, "y": 0.34, "width": 0.22, "height": 0.18 }
        }
      ]
    }
  ]
}
\`\`\`
- rect の各値 (x, y, width, height) は 0〜1 の相対座標で記載してください。
- 複数箇所に指摘がある場合は anchors に複数要素を入れてください。
- 位置が特定できない場合は anchors を空配列にし、slidePage はコメントの対象ページを設定してください。
- JSON以外のテキストや補足説明は出力しないでください。`;
  }

  function parseGeminiFeedbackText(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!trimmed) {
      return [];
    }

    const jsonBlocks = extractJsonBlocks(trimmed);
    if (jsonBlocks.length) {
      for (const block of jsonBlocks) {
        try {
          const parsed = JSON.parse(block);
          const items = normalizeFeedbackItemsFromJson(parsed);
          if (items.length) {
            return items;
          }
        } catch (error) {
          console.warn('[Gemini Slides] Failed to parse JSON block:', error);
        }
      }
    }

    const blocks = trimmed.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (!blocks.length) {
      return [{
        id: "feedback-auto-1",
        title: "Geminiレビュー結果",
        summary: trimmed,
        anchors: []
      }];
    }

    const items = blocks.slice(0, 12).map((block, index) => {
      const lines = block.split(/\n+/).filter(Boolean);
      const firstLine = lines.shift() || block;
      const title = tidyFeedbackTitle(firstLine, index);
      const summary = lines.length ? lines.join("\n").trim() : block;
      const anchors = extractAnchorsFromText(block);
      const slidePage = anchors[0]?.slidePage;
      return {
        id: `feedback-auto-${index + 1}`,
        title,
        summary: summary.length > 800 ? `${summary.slice(0, 800)}…` : summary,
        anchors,
        slidePage
      };
    });

    return items.length
      ? items
      : [{
          id: "feedback-auto-1",
          title: "Geminiレビュー結果",
          summary: trimmed,
          anchors: []
        }];
  }

  function extractJsonBlocks(text) {
    const blocks = [];
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match[1]) {
        blocks.push(match[1].trim());
      }
    }

    if (!blocks.length) {
      const braceRegex = /\{\s*"[^]*$/;
      const candidates = text.match(/\{[\s\S]*\}/g);
      if (candidates) {
        candidates.forEach((candidate) => {
          if (braceRegex.test(candidate)) {
            blocks.push(candidate.trim());
          }
        });
      }
    }

    return blocks;
  }

  function extractAnchorsFromText(block) {
    if (!block) return [];
    const anchors = [];
    const slideRegex = /(?:Slide|スライド|ページ)\s*(\d+)/gi;
    let match;
    const segments = [];

    while ((match = slideRegex.exec(block)) !== null) {
      const slidePage = Number(match[1]);
      if (!slidePage || Number.isNaN(slidePage)) continue;
      const start = match.index;
      slideRegex.lastIndex = match.index + match[0].length;
      const nextMatch = slideRegex.exec(block);
      const end = nextMatch ? nextMatch.index : block.length;
      if (nextMatch) {
        slideRegex.lastIndex = nextMatch.index;
      }
      const segment = block.slice(start, end);
      segments.push({ slidePage, segment });
    }

    if (!segments.length) {
      const rect = parseRectFromSegment(block);
      if (rect) {
        anchors.push({
          slidePage: 1,
          rect,
          source: "llm-text"
        });
      }
      return sanitizeAnchors(anchors);
    }

    segments.forEach(({ slidePage, segment }) => {
      const rect = parseRectFromSegment(segment);
      if (rect) {
        anchors.push({
          slidePage,
          rect,
          source: "llm-text"
        });
        return;
      }
      const point = parsePointFromSegment(segment);
      if (point) {
        anchors.push({
          slidePage,
          position: point,
          source: "llm-text"
        });
      }
    });

    return sanitizeAnchors(anchors);
  }

  function parseRectFromSegment(segment) {
    if (!segment) return null;
    const rectPatterns = [
      /rect(?:angle)?\s*[:=]?\s*\(\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*\)/i,
      /bbox\s*[:=]?\s*\(\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*\)/i,
      /area\s*[:=]?\s*\(\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*\)/i
    ];

    for (const pattern of rectPatterns) {
      const m = segment.match(pattern);
      if (m) {
        return {
          x: m[1],
          y: m[2],
          width: m[3],
          height: m[4]
        };
      }
    }

    const xywhPattern = /x\s*[:=]\s*([-+]?\d*\.?\d+%?)\D{0,20}?y\s*[:=]\s*([-+]?\d*\.?\d+%?)\D{0,20}?(?:w(?:idth)?|幅)\s*[:=]\s*([-+]?\d*\.?\d+%?)\D{0,20}?(?:h(?:eight)?|高さ)\s*[:=]\s*([-+]?\d*\.?\d+%?)/i;
    const xywh = segment.match(xywhPattern);
    if (xywh) {
      return {
        x: xywh[1],
        y: xywh[2],
        width: xywh[3],
        height: xywh[4]
      };
    }

    const numbers = segment.match(/[-+]?\d*\.?\d+%?/g);
    if (numbers && numbers.length >= 4) {
      return {
        x: numbers[0],
        y: numbers[1],
        width: numbers[2],
        height: numbers[3]
      };
    }

    return null;
  }

  function parsePointFromSegment(segment) {
    if (!segment) return null;
    const pointPatterns = [
      /center\s*\(\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*\)/i,
      /position\s*[:=]?\s*\(\s*([-+]?\d*\.?\d+%?)\s*,\s*([-+]?\d*\.?\d+%?)\s*\)/i
    ];

    for (const pattern of pointPatterns) {
      const m = segment.match(pattern);
      if (m) {
        return {
          x: m[1],
          y: m[2]
        };
      }
    }

    return null;
  }

  function normalizeFeedbackItemsFromJson(parsed) {
    if (!parsed) return [];
    const items = Array.isArray(parsed?.feedbackItems)
      ? parsed.feedbackItems
      : Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    if (!items.length) return [];
    return items.map((item, index) => {
      const anchors = sanitizeAnchors(Array.isArray(item?.anchors) ? item.anchors : []);
      const slidePage = anchors[0]?.slidePage
        || normalizeSlidePage(item?.slidePage ?? item?.page ?? item?.slide ?? item?.pageNumber ?? item?.pageIndex ?? item?.slide_number, index)
        || undefined;
      return {
        id: item?.id || `feedback-json-${index + 1}`,
        title: item?.title || tidyFeedbackTitle(item?.heading || item?.summary || `指摘 ${index + 1}`, index),
        summary: (item?.summary || item?.details || "").toString().trim(),
        anchors,
        slidePage
      };
    });
  }

  function tidyFeedbackTitle(rawTitle, index) {
    const fallback = `指摘 ${index + 1}`;
    if (!rawTitle) return fallback;
    return rawTitle
      .replace(/^[\s*-]+/, "")
      .replace(/^\d+\s*[\).:-]?\s*/, "")
      .trim() || fallback;
  }

  function sanitizeAnchors(anchorList) {
    return anchorList
      .map((anchor, index) => sanitizeAnchorData(anchor, index))
      .filter(Boolean);
  }

  function sanitizeAnchorData(anchor, index = 0) {
    if (!anchor) return null;
    const slidePageValue = anchor.slidePage ?? anchor.page ?? anchor.slide ?? anchor.pageNumber ?? anchor.pageIndex ?? anchor.slide_number;
    const slidePage = normalizeSlidePage(slidePageValue, index);
    if (!slidePage) {
      return null;
    }

    let rectCandidate = anchor.rect ?? anchor.box ?? anchor.bbox ?? anchor.bounds ?? anchor.rectangle;
    if (Array.isArray(rectCandidate) && rectCandidate.length >= 4) {
      rectCandidate = {
        x: rectCandidate[0],
        y: rectCandidate[1],
        width: rectCandidate[2],
        height: rectCandidate[3]
      };
    } else if (typeof rectCandidate === "string") {
      const match = rectCandidate.match(/([-+]?\d*\.?\d+%?)/g);
      if (match && match.length >= 4) {
        rectCandidate = {
          x: match[0],
          y: match[1],
          width: match[2],
          height: match[3]
        };
      }
    }

    const rect = rectCandidate ? normalizeRect(rectCandidate) : null;

    let positionCandidate = anchor.position ?? anchor.point ?? anchor.center;
    if (Array.isArray(positionCandidate) && positionCandidate.length >= 2) {
      positionCandidate = { x: positionCandidate[0], y: positionCandidate[1] };
    } else if (typeof positionCandidate === "string") {
      const coords = positionCandidate.match(/([-+]?\d*\.?\d+%?)/g);
      if (coords && coords.length >= 2) {
        positionCandidate = { x: coords[0], y: coords[1] };
      }
    }
    const position = positionCandidate ? normalizePoint(positionCandidate) : null;

    if (!rect && !position) {
      return null;
    }

    const confidenceValue = anchor.confidence ?? anchor.score ?? anchor.confidenceScore;
    const confidence = typeof confidenceValue === "number"
      ? confidenceValue
      : confidenceValue
        ? Number.parseFloat(String(confidenceValue))
        : undefined;

    return {
      slidePage: slidePage,
      rect: rect || null,
      position: rect ? null : position, // rect優先
      anchorIndex: typeof anchor.anchorIndex === "number" ? anchor.anchorIndex : index,
      source: anchor.source || "ai",
      confidence: Number.isFinite(confidence) ? confidence : undefined
    };
  }

  function normalizeSlidePage(value, fallbackIndex = 0) {
    if (value === undefined || value === null) {
      return fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value >= 1 ? Math.floor(value) : Math.floor(value) + 1;
    }

    const stringValue = String(value).trim();
    const digitMatch = stringValue.match(/\d+/);
    if (!digitMatch) {
      return fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
    }
    const parsed = Number.parseInt(digitMatch[0], 10);
    if (Number.isNaN(parsed)) {
      return fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
    }
    return parsed >= 1 ? parsed : 1;
  }

  function normalizeRect(rect) {
    if (!rect) return null;
    const x = toRatioNumber(rect.x ?? rect.left ?? rect.startX);
    const y = toRatioNumber(rect.y ?? rect.top ?? rect.startY);
    const width = toRatioNumber(rect.width ?? rect.w ?? rect.right ?? rect.endX, { clamp: false });
    const height = toRatioNumber(rect.height ?? rect.h ?? rect.bottom ?? rect.endY, { clamp: false });

    if ([x, y, width, height].some((value) => value === null)) {
      return null;
    }

    return {
      x: clamp01(x),
      y: clamp01(y),
      width: clamp01(width),
      height: clamp01(height)
    };
  }

  function normalizePoint(point) {
    if (!point) return null;
    const x = toRatioNumber(point.x ?? point[0]);
    const y = toRatioNumber(point.y ?? point[1]);
    if (x === null || y === null) {
      return null;
    }
    return {
      x: clamp01(x),
      y: clamp01(y)
    };
  }

  function toRatioNumber(value, options = { clamp: true }) {
    if (value === undefined || value === null) {
      return null;
    }

    let stringValue = value;
    if (typeof stringValue === "string") {
      stringValue = stringValue.trim();
      if (!stringValue) return null;
    }

    const percent = typeof stringValue === "string" && stringValue.includes("%");
    const numeric = Number.parseFloat(String(stringValue).replace(/[^\d.+-eE]/g, ""));
    if (!Number.isFinite(numeric)) {
      return null;
    }

    let ratio = numeric;

    if (percent) {
      ratio = numeric / 100;
    } else if (ratio > 1) {
      if (ratio <= 5 && !percent) {
        // assume already ratio (e.g., 1.2)
      } else if (ratio <= 100) {
        ratio = ratio / 100;
      } else if (ratio <= 1000) {
        ratio = ratio / 1000;
      } else {
        ratio = ratio / 10000;
      }
    }

    if (!options.clamp) {
      return ratio;
    }

    return clamp01(ratio);
  }

  function registerPinDebugAPI() {
    if (window.__geminiPinsDebugRegistered) return;
    Object.defineProperty(window, "__geminiPinsDebugRegistered", {
      value: true,
      writable: false,
      configurable: true
    });
    window.geminiPins = {
      set: (items) => {
        setFeedbackItems(Array.isArray(items) ? items : []);
      },
      clear: () => {
        setFeedbackItems([]);
      },
      mock: () => {
        setFeedbackItems(getMockFeedbackItems());
      },
      state: () => ({
        feedbackItems: state.feedbackItems,
        pinsBySlide: state.pinsBySlide
      })
    };
    console.info('[Gemini Slides] Pin debug helpers available via window.geminiPins');
  }

  /**
   * Phase 7-2A: ピンデータをストレージに保存
   */
  async function savePinsToStorage(presentationId, pinsBySlide) {
    const key = `pins:${presentationId}`;
    const data = {
      version: "1.0",
      presentationId,
      lastModified: new Date().toISOString(),
      pins: pinsBySlide
    };

    try {
      await chrome.storage.local.set({ [key]: data });
      console.log('[Pins] Saved to storage:', key, 'Total slides:', Object.keys(pinsBySlide).length);
    } catch (error) {
      console.error('[Pins] Failed to save:', error);
    }
  }

  /**
   * Phase 7-2A: ストレージからピンデータを読み込み
   */
  async function loadPinsFromStorage(presentationId) {
    const key = `pins:${presentationId}`;

    try {
      const result = await chrome.storage.local.get(key);
      if (result[key]) {
        console.log('[Pins] Loaded from storage:', key, 'Last modified:', result[key].lastModified);
        return result[key].pins || {};
      }
    } catch (error) {
      console.error('[Pins] Failed to load:', error);
    }

    return {};
  }

  /**
   * Phase 7-2A: フィードバックアイテムをストレージに保存
   */
  async function saveFeedbackToStorage(presentationId, feedbackItems) {
    const key = `feedback:${presentationId}`;
    const data = {
      version: "1.0",
      items: feedbackItems,
      lastModified: new Date().toISOString()
    };

    try {
      await chrome.storage.local.set({ [key]: data });
      console.log('[Feedback] Saved to storage:', key, 'Total items:', feedbackItems.length);
    } catch (error) {
      console.error('[Feedback] Failed to save:', error);
    }
  }

  /**
   * Phase 7-2A: ストレージからフィードバックアイテムを読み込み
   */
  async function loadFeedbackFromStorage(presentationId) {
    const key = `feedback:${presentationId}`;

    try {
      const result = await chrome.storage.local.get(key);
      if (result[key]) {
        console.log('[Feedback] Loaded from storage:', key, 'Last modified:', result[key].lastModified);
        return result[key].items || [];
      }
    } catch (error) {
      console.error('[Feedback] Failed to load:', error);
    }

    return [];
  }

  function regeneratePinsFromFeedback() {
    state.pinsBySlide = {};
    const items = Array.isArray(state.feedbackItems) ? state.feedbackItems : [];

    items.forEach((item) => {
      const anchors = Array.isArray(item.anchors) ? item.anchors : [];
      anchors.forEach((anchor, index) => {
        const normalized = normalizeAnchor(anchor);
        if (!normalized) {
          console.warn('[Gemini Slides] Anchor normalization failed for', anchor);
          return;
        }

        const slidePage = normalized.slidePage || Number(anchor.slidePage || item.slidePage || item.slidePage);
        if (!slidePage || Number.isNaN(slidePage)) return;

        const pin = {
          pinId: anchor.pinId || generatePinId(),
          feedbackId: item.id,
          slidePage,
          position: normalized.position,
          rect: normalized.rect,
          anchorIndex: typeof anchor.anchorIndex === "number" ? anchor.anchorIndex : index,
          source: anchor.source || "ai"
        };

        if (!state.pinsBySlide[slidePage]) {
          state.pinsBySlide[slidePage] = [];
        }
        state.pinsBySlide[slidePage].push(pin);
        debugLog('Pin generated:', {
          pinId: pin.pinId,
          slidePage: pin.slidePage,
          position: pin.position,
          rect: pin.rect,
          hasRect: !!pin.rect
        });
      });
    });

    debugLog('pinsBySlide after regeneration:', state.pinsBySlide);
    Object.values(state.pinsBySlide).forEach((pinList) => {
      pinList.sort((a, b) => a.anchorIndex - b.anchorIndex);
    });

    updatePinModeBadge();
    renderPinsForCurrentSlide();

    // Phase 7-2A: 自動保存
    const presentationId = extractPresentationId(window.location.href);
    if (presentationId) {
      savePinsToStorage(presentationId, state.pinsBySlide);
      saveFeedbackToStorage(presentationId, state.feedbackItems);
    }
  }

  function formatSlideLabel(anchors, fallbackSlidePage) {
    // スライド番号の表示は不要になったため、空文字列を返す
    return "";
  }

  function normalizeAnchor(anchor) {
    if (!anchor) return null;
    const result = {
      position: null,
      rect: null
    };

    if (anchor.rect) {
      const rect = {
        x: clamp01(anchor.rect.x),
        y: clamp01(anchor.rect.y),
        width: clamp01(anchor.rect.width),
        height: clamp01(anchor.rect.height)
      };
      if (rect.width > 0 && rect.height > 0) {
        result.rect = rect;
        result.position = {
          x: clamp01(rect.x + rect.width / 2),
          y: clamp01(rect.y + rect.height / 2)
        };
      }
    }

    if (!result.position && anchor.position) {
      result.position = {
        x: clamp01(anchor.position.x),
        y: clamp01(anchor.position.y)
      };
    }

    if (!result.position) {
      return null;
    }

    return result;
  }

  function clamp01(value) {
    const number = Number(value);
    if (Number.isNaN(number)) return 0;
    return Math.min(1, Math.max(0, number));
  }

  function getAnchorsForFeedback(feedbackId) {
    if (!feedbackId) return [];
    const feedback = state.feedbackItems.find((item) => item.id === feedbackId);
    return Array.isArray(feedback?.anchors) ? feedback.anchors : [];
  }

  function toggleFeedbackPopup() {
    const popup = state.ui.feedbackPopup;
    if (!popup) return;
    popup.classList.toggle("visible");
  }

  function initializeDraggableFeedbackButton(buttonGroup) {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let buttonStartX = 0;
    let buttonStartY = 0;
    let hasMoved = false;

    // Load saved position from localStorage
    const savedPosition = loadFeedbackButtonPosition();
    if (savedPosition) {
      buttonGroup.style.right = 'auto';
      buttonGroup.style.bottom = 'auto';
      buttonGroup.style.left = `${savedPosition.x}px`;
      buttonGroup.style.top = `${savedPosition.y}px`;
    }

    const handleMouseDown = (e) => {
      // Only allow dragging with left mouse button
      if (e.button !== 0) return;

      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const rect = buttonGroup.getBoundingClientRect();
      buttonStartX = rect.left;
      buttonStartY = rect.top;

      buttonGroup.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;

      // Mark as moved if dragged more than 5px
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved = true;
      }

      const newX = buttonStartX + deltaX;
      const newY = buttonStartY + deltaY;

      // Constrain to viewport bounds
      const maxX = window.innerWidth - buttonGroup.offsetWidth;
      const maxY = window.innerHeight - buttonGroup.offsetHeight;

      const constrainedX = Math.max(0, Math.min(newX, maxX));
      const constrainedY = Math.max(0, Math.min(newY, maxY));

      buttonGroup.style.right = 'auto';
      buttonGroup.style.bottom = 'auto';
      buttonGroup.style.left = `${constrainedX}px`;
      buttonGroup.style.top = `${constrainedY}px`;

      e.preventDefault();
    };

    const handleMouseUp = (e) => {
      if (!isDragging) return;

      isDragging = false;
      buttonGroup.style.cursor = 'grab';

      // Save position to localStorage
      const rect = buttonGroup.getBoundingClientRect();
      saveFeedbackButtonPosition({ x: rect.left, y: rect.top });

      // Prevent click event if button was dragged
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        // Add a temporary flag to prevent click
        buttonGroup.dataset.justDragged = 'true';
        setTimeout(() => {
          delete buttonGroup.dataset.justDragged;
        }, 100);
      }
    };

    // Prevent click when just dragged
    const handleClick = (e) => {
      if (buttonGroup.dataset.justDragged === 'true') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    buttonGroup.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    buttonGroup.addEventListener('click', handleClick, true);

    // Cleanup function
    return () => {
      buttonGroup.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      buttonGroup.removeEventListener('click', handleClick, true);
    };
  }

  function saveFeedbackButtonPosition(position) {
    try {
      localStorage.setItem('gemini-feedback-button-position', JSON.stringify(position));
    } catch (error) {
      console.warn('Failed to save feedback button position:', error);
    }
  }

  function loadFeedbackButtonPosition() {
    try {
      const saved = localStorage.getItem('gemini-feedback-button-position');
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.warn('Failed to load feedback button position:', error);
      return null;
    }
  }

  function handleFeedbackPopupClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const item = target.closest(".feedback-popup-item");
    if (!item) return;

    const feedbackId = item.dataset.feedbackId;
    if (!feedbackId) return;

    // Close popup
    if (state.ui.feedbackPopup?.classList.contains("visible")) {
      toggleFeedbackPopup();
    }

    // Show temporary bubble for clicked feedback only
    showTemporaryFeedbackBubble(feedbackId);
  }

  function showTemporaryFeedbackBubble(feedbackId) {
    if (!feedbackId) return;

    // 既存の一時的な吹き出しを削除
    const existingBubble = document.getElementById("gemini-temp-feedback-bubble");
    if (existingBubble) {
      existingBubble.remove();
    }

    // フィードバックアイテムを取得
    const feedback = state.feedbackItems.find((item) => item.id === feedbackId);
    if (!feedback) return;

    // アンカー情報を取得
    const anchors = Array.isArray(feedback.anchors) ? feedback.anchors : [];
    if (anchors.length === 0) {
      console.log('No anchors for feedback:', feedbackId);
      return;
    }

    const anchor = anchors[0]; // 最初のアンカーを使用
    const targetSlideIndex = anchor.slideIndex;

    // スライドに移動（slideIndexを使用）
    if (typeof targetSlideIndex === 'number' && targetSlideIndex >= 0) {
      const currentSlideIndex = getActiveSlideIndex();
      if (currentSlideIndex !== targetSlideIndex) {
        console.log('[Gemini Slides] Moving from slide', currentSlideIndex, 'to', targetSlideIndex);
        navigateToSlideByIndex(targetSlideIndex);
        // スライド移動後に少し待ってから吹き出しを表示
        setTimeout(() => {
          renderTemporaryBubble(feedback, anchor);
        }, 500);
        return;
      }
    }

    // 既に正しいスライドにいる場合、または移動不要な場合
    renderTemporaryBubble(feedback, anchor);
  }

  function renderTemporaryBubble(feedback, anchor) {
    if (!state.pinOverlay || !anchor.rect) return;

    updatePinOverlayBounds();

    // 一時的な吹き出しを作成
    const bubble = document.createElement("div");
    bubble.id = "gemini-temp-feedback-bubble";
    bubble.className = "gemini-temp-bubble";

    // 矩形の位置を計算
    const rectX = (anchor.rect.x || 0) + (anchor.rect.width || 0) / 2;
    const rectY = (anchor.rect.y || 0);

    // 吹き出しの位置を自動計算
    const bubblePos = calculateBubblePosition(rectX, rectY);

    // 吹き出しのスタイルを設定
    bubble.style.position = "absolute";
    bubble.style.left = `${rectX * 100}%`;
    bubble.style.top = `${rectY * 100}%`;
    bubble.style.transform = getBubbleTransform(bubblePos.position);
    bubble.dataset.position = bubblePos.position;
    bubble.dataset.arrowClass = bubblePos.arrowClass;

    // コンテンツを作成
    const content = document.createElement("div");
    content.className = "gemini-temp-bubble-content";

    const title = document.createElement("div");
    title.className = "gemini-temp-bubble-title";
    title.textContent = feedback.title || "フィードバック";

    const body = document.createElement("div");
    body.className = "gemini-temp-bubble-body";
    body.textContent = feedback.summary || feedback.body || "";

    const closeBtn = document.createElement("button");
    closeBtn.className = "gemini-temp-bubble-close";
    closeBtn.textContent = "×";
    closeBtn.onclick = () => bubble.remove();

    content.append(title, body, closeBtn);
    bubble.appendChild(content);

    // ハイライト矩形を作成
    if (state.pinOverlayTargets && anchor.rect) {
      const highlight = document.createElement("div");
      highlight.className = "gemini-temp-highlight";
      highlight.style.left = `${(anchor.rect.x || 0) * 100}%`;
      highlight.style.top = `${(anchor.rect.y || 0) * 100}%`;
      highlight.style.width = `${(anchor.rect.width || 0) * 100}%`;
      highlight.style.height = `${(anchor.rect.height || 0) * 100}%`;
      state.pinOverlayTargets.appendChild(highlight);

      // 5秒後に削除
      setTimeout(() => {
        highlight.remove();
      }, 5000);
    }

    state.pinOverlay.appendChild(bubble);

    // 5秒後に自動的に削除
    setTimeout(() => {
      bubble.remove();
    }, 5000);

    // オーバーレイを表示
    if (state.pinOverlay) {
      state.pinOverlay.classList.add("is-visible");
    }
  }

  function getBubbleTransform(position) {
    switch (position) {
      case "right":
        return "translate(12px, -50%)";
      case "left":
        return "translate(calc(-100% - 12px), -50%)";
      case "top":
        return "translate(-50%, calc(-100% - 12px))";
      case "bottom":
        return "translate(-50%, 12px)";
      default:
        return "translate(12px, -50%)";
    }
  }

  function renderFeedbackPopup() {
    if (!state.ui.feedbackPopupList || !state.ui.feedbackPopupEmpty) return;

    const list = state.ui.feedbackPopupList;
    const emptyState = state.ui.feedbackPopupEmpty;
    const items = Array.isArray(state.feedbackItems) ? state.feedbackItems : [];

    list.innerHTML = "";

    if (!items.length) {
      emptyState.hidden = false;
      list.hidden = true;
      return;
    }

    emptyState.hidden = true;
    list.hidden = false;

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "feedback-popup-item";
      li.dataset.feedbackId = item.id;

      const header = document.createElement("div");
      header.className = "feedback-popup-item-header";

      const title = document.createElement("div");
      title.className = "feedback-popup-item-title";
      title.textContent = item.title || `指摘 ${index + 1}`;

      const anchors = Array.isArray(item.anchors) ? item.anchors : [];
      const slideLabel = formatSlideLabel(anchors, item.slidePage);

      const badge = document.createElement("span");
      badge.className = "feedback-popup-item-badge";
      if (anchors.length > 0) {
        badge.classList.add("pinned");
        badge.textContent = `📍 ${slideLabel}`;
      } else {
        badge.textContent = slideLabel;
      }

      header.append(title, badge);

      const summary = document.createElement("div");
      summary.className = "feedback-popup-item-summary";
      summary.textContent = item.summary || item.body || "";

      li.append(header, summary);
      list.appendChild(li);
    });
  }

  function renderFeedbackList() {
    // Legacy function - now delegates to popup
    renderFeedbackPopup();
  }

  function focusFeedback(feedbackId) {
    if (!feedbackId) return;
    const pins = findPinsByFeedback(feedbackId);
    if (!pins.length) {
      setOpenPin(null);
      highlightFeedback(feedbackId, { scrollIntoView: true });
      return;
    }

    const currentPage = getCurrentSlidePageNumber();
    let targetPin = pins.find((pin) => pin.slidePage === currentPage);
    if (!targetPin) {
      targetPin = pins[0];
    }

    if (!targetPin) {
      setOpenPin(null);
      highlightFeedback(feedbackId, { scrollIntoView: true });
      return;
    }

    if (targetPin.slidePage !== currentPage) {
      // 別のスライドにピンがある場合、ユーザーに促す
      highlightFeedback(feedbackId, { scrollIntoView: true });
      showSlideMessage(targetPin.slidePage, `スライド ${targetPin.slidePage} を開くとピンが表示されます`, "info");
    } else {
      // 現在のスライドにピンがある場合、即座に表示
      setOpenPin(targetPin.pinId, { scrollIntoView: true });
    }
  }

  function enterPinMode(feedbackId) {
    state.pinMode.isActive = true;
    state.pinMode.feedbackId = feedbackId;

    if (state.pinOverlay) {
      state.pinOverlay.classList.add("pin-mode");
    }

    updatePinOverlayVisibility();
    updatePinModeBadge();
    highlightFeedback(feedbackId, { scrollIntoView: true });
    updatePinOverlayBounds();
  }

  function exitPinMode(reason = "") {
    if (!state.pinMode.isActive) return;
    state.pinMode.isActive = false;
    state.pinMode.feedbackId = null;

    if (state.pinOverlay) {
      state.pinOverlay.classList.remove("pin-mode");
    }

    updatePinOverlayVisibility();
    updatePinModeBadge();

    if (reason !== "placed") {
      const openFeedbackId = state.openPinId ? findPinById(state.openPinId)?.feedbackId : null;
      highlightFeedback(openFeedbackId);
    }
  }

  function updatePinModeBadge() {
    // No longer needed - removed from UI
  }

  function handlePinKeydown(event) {
    if (event.key === "Escape" && state.pinMode.isActive) {
      event.preventDefault();
      exitPinMode("escape");
    }
  }

  function handlePinOverlayClick(event) {
    if (!state.pinMode.isActive || !state.pinOverlayCanvas || !state.pinMode.feedbackId) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = state.pinOverlayCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const xClamped = Math.max(0.02, Math.min(0.98, x));
    const yClamped = Math.max(0.02, Math.min(0.98, y));

    const slidePage = getCurrentSlidePageNumber();
    const newPin = addPinAt(state.pinMode.feedbackId, slidePage, { x: xClamped, y: yClamped });
    renderPinsForCurrentSlide();
    setOpenPin(newPin.pinId, { scrollIntoView: true });
    exitPinMode("placed");
  }

  function addPinAt(feedbackId, slidePage, position) {
    const pin = {
      pinId: generatePinId(),
      feedbackId,
      slidePage,
      position: { x: position.x, y: position.y },
      createdAt: new Date().toISOString()
    };

    if (!state.pinsBySlide[slidePage]) {
      state.pinsBySlide[slidePage] = [];
    }
    state.pinsBySlide[slidePage].push(pin);
    return pin;
  }

  /**
   * 吹き出しの最適な位置を計算（画面端を考慮して自動調整）
   * @param {number} pinX - ピンのX座標（0-1の正規化座標）
   * @param {number} pinY - ピンのY座標（0-1の正規化座標）
   * @returns {{position: string, offset: {x: string, y: string}, arrowClass: string}}
   */
  const calculateBubblePosition = (pinX, pinY) => {
    const EDGE_THRESHOLD = 0.3; // 画面端の判定閾値（30%）
    const BUBBLE_OFFSET = 12; // 吹き出しとピンの間隔(px)

    // デフォルトは右側に表示
    let position = 'right';
    let arrowClass = 'arrow-left';

    // 右端に近い場合は左側に表示
    if (pinX > 1 - EDGE_THRESHOLD) {
      position = 'left';
      arrowClass = 'arrow-right';
    }
    // 上端に近い場合は下側に表示
    else if (pinY < EDGE_THRESHOLD) {
      position = 'bottom';
      arrowClass = 'arrow-top';
    }
    // 下端に近い場合は上側に表示
    else if (pinY > 1 - EDGE_THRESHOLD) {
      position = 'top';
      arrowClass = 'arrow-bottom';
    }

    return {
      position,
      arrowClass,
      offset: BUBBLE_OFFSET
    };
  };

  function renderPinsForCurrentSlide() {
    // ピン表示を完全に無効化（ポップアップリストのみ使用）
    if (!state.pinOverlayPins) return;

    updatePinOverlayBounds();

    const slideIndex = getActiveSlideIndex();
    const slidePage = slideIndex >= 0 ? slideIndex + 1 : 1;

    const pins = state.pinsBySlide[slidePage] || [];
    debugLog('Pins exist for slide', slidePage, pins.length, 'but not rendering them (hidden by design)');

    // ピンとターゲットを非表示に
    state.pinOverlayPins.innerHTML = "";
    if (state.pinOverlayTargets) {
      state.pinOverlayTargets.innerHTML = "";
    }

    // ピンモード時のみオーバーレイを表示
    updatePinOverlayVisibility();
  }

  function handlePinContainerClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const pinElement = target.closest(".gemini-pin");
    if (!pinElement) return;

    const pinId = pinElement.dataset.pinId;
    if (!pinId) return;

    if (state.openPinId === pinId) {
      setOpenPin(null);
    } else {
      setOpenPin(pinId, { scrollIntoView: false });
    }
  }

  function setOpenPin(pinId, options = {}) {
    state.openPinId = pinId || null;

    if (state.pinOverlayPins) {
      const pinButtons = state.pinOverlayPins.querySelectorAll(".gemini-pin");
      pinButtons.forEach((button) => {
        button.classList.toggle("is-open", button.dataset.pinId === state.openPinId);
      });
    }
    if (state.pinOverlayTargets) {
      const targetRects = state.pinOverlayTargets.querySelectorAll(".gemini-pin-overlay__target");
      targetRects.forEach((target) => {
        target.classList.toggle("is-open", target.dataset.pinId === state.openPinId);
      });
    }

    const pin = pinId ? findPinById(pinId) : null;
    const feedbackId = pin?.feedbackId || null;

    highlightFeedback(feedbackId, options);
  }

  function highlightFeedback(feedbackId, options = {}) {
    // No longer needed - feedback list moved to popup
  }

  function updatePinOverlayBounds() {
    if (!state.pinOverlay) return;
    const rect = findSlideViewportRect();
    if (!rect) {
      state.pinOverlay.style.opacity = "0";
      state.pinOverlay.classList.remove("is-visible");
      return;
    }

    state.pinOverlay.style.top = `${rect.top + window.scrollY}px`;
    state.pinOverlay.style.left = `${rect.left + window.scrollX}px`;
    state.pinOverlay.style.width = `${rect.width}px`;
    state.pinOverlay.style.height = `${rect.height}px`;

    updatePinOverlayVisibility();
  }

  function updatePinOverlayVisibility() {
    if (!state.pinOverlay) return;
    const slidePage = getCurrentSlidePageNumber();
    const pins = state.pinsBySlide[slidePage] || [];
    const shouldShow = state.pinMode.isActive || pins.length > 0;
    console.log('[Gemini Slides] Overlay visibility check', {
      slidePage,
      pinCount: pins.length,
      shouldShow,
      pinMode: state.pinMode.isActive
    });
    state.pinOverlay.classList.toggle("is-visible", shouldShow);
    state.pinOverlay.classList.toggle("pin-mode", state.pinMode.isActive);
  }

  function findSlideViewportRect() {
    const selectors = [
      "#punch-app .punch-viewer-content svg",
      "#punch-app .punch-viewer-content canvas",
      ".punch-viewer-content svg",
      ".punch-viewer-content canvas",
      "#canvas",
      "#canvas-container svg",
      "#canvas-container canvas",
      ".punch-present-canvas svg",
      ".punch-present-canvas canvas"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 150) {
        return rect;
      }
    }

    const fallbackSvg = Array.from(document.querySelectorAll("svg")).find(isMainSlideSVG);
    if (fallbackSvg) {
      const rect = fallbackSvg.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 150) {
        return rect;
      }
    }

    return null;
  }

  function startPinSlideWatcher() {
    stopPinSlideWatcher();
    state.pinSlideWatcher = window.setInterval(checkSlideIndexForPins, 800);
    checkSlideIndexForPins();
  }

  function stopPinSlideWatcher() {
    if (state.pinSlideWatcher) {
      clearInterval(state.pinSlideWatcher);
      state.pinSlideWatcher = null;
    }
  }

  function checkSlideIndexForPins() {
    const currentIndex = getActiveSlideIndex();
    if (currentIndex === state.lastRenderedSlideIndex) {
      if (state.pinMode.isActive) {
        updatePinOverlayBounds();
      }
      return;
    }

    state.lastRenderedSlideIndex = currentIndex;
    renderPinsForCurrentSlide();
  }

  function findPinById(pinId) {
    if (!pinId) return null;
    for (const pins of Object.values(state.pinsBySlide)) {
      const found = pins?.find((pin) => pin.pinId === pinId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function findPinsByFeedback(feedbackId) {
    if (!feedbackId) return [];
    const pins = [];
    for (const slidePins of Object.values(state.pinsBySlide)) {
      slidePins?.forEach((pin) => {
        if (pin.feedbackId === feedbackId) {
          pins.push(pin);
        }
      });
    }
    return pins;
  }

  function isFeedbackPinned(feedbackId) {
    if (!feedbackId) return false;
    return findPinsByFeedback(feedbackId).length > 0;
  }

  function showSlideMessage(slidePage, message, variant = "info") {
    // サイドパネルにメッセージを表示
    if (state.ui.result) {
      const prevContent = state.ui.result.textContent;
      const prevClass = state.ui.result.className;

      const classMap = {
        error: "status error",
        info: "status",
        success: "status success"
      };

      state.ui.result.className = classMap[variant] || "status";
      state.ui.result.textContent = message;

      // 5秒後に元に戻す
      setTimeout(() => {
        state.ui.result.className = prevClass;
        state.ui.result.textContent = prevContent;
      }, 5000);
    }
  }

  function getCurrentSlidePageNumber() {
    const index = getActiveSlideIndex();
    return index >= 0 ? index + 1 : 1;
  }

  /**
   * 現在のスライドIDを取得
   * @returns {string|null} スライドID (例: "p3", "g12345678")
   */
  function getCurrentSlideId() {
    const hash = window.location.hash;
    const match = hash.match(/#slide=id\.(.+)/);
    return match ? match[1] : null;
  }

  /**
   * 指定したスライドIDのスライドに移動
   * @param {string} slideId - スライドID
   */
  function navigateToSlideById(slideId) {
    if (!slideId) return;
    window.location.hash = `#slide=id.${slideId}`;
  }

  /**
   * 指定したインデックスのスライドに移動（フィルムストリップのサムネイルをクリック）
   * @param {number} slideIndex - スライドのインデックス（0始まり）
   */
  function navigateToSlideByIndex(slideIndex) {
    if (typeof slideIndex !== 'number' || slideIndex < 0) return;

    const slideNodes = getSlideOptionNodes();
    if (slideIndex >= slideNodes.length) {
      console.warn('[Gemini Slides] slideIndex out of range:', slideIndex, 'max:', slideNodes.length - 1);
      return;
    }

    const targetNode = slideNodes[slideIndex];
    if (targetNode) {
      console.log('[Gemini Slides] Navigating to slide index:', slideIndex);
      targetNode.click();  // サムネイルをクリックしてスライド移動
    }
  }

  /**
   * デバウンス処理
   * @param {Function} func - 実行する関数
   * @param {number} wait - 待機時間（ミリ秒）
   * @returns {Function} - デバウンスされた関数
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * キーボードショートカットを初期化
   */
  function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      // Ctrl+Shift+G または Cmd+Shift+G でパネルを開閉
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'G') {
        event.preventDefault();
        togglePanel();
      }

      // パネルが開いている場合
      if (state.isPanelVisible) {
        // Ctrl+Enter または Cmd+Enter でレビュー実行
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (state.ui.runButton && !state.ui.runButton.disabled) {
            handleRunCheck();
          }
        }

        // Ctrl+Shift+Enter または Cmd+Shift+Enter で全スライドレビュー
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
          event.preventDefault();
          if (state.ui.runAllButton && !state.ui.runAllButton.disabled) {
            handleRunAllSlides();
          }
        }
      }
    });

    console.log('[Gemini Slides] Keyboard shortcuts initialized');
  }

  /**
   * 外部コンテキストを圧縮（古いfilled以外のデータを削除）
   * @param {Array} contexts - 外部コンテキストの配列
   * @returns {Array} - 圧縮されたコンテキスト配列
   */
  function compressExternalContexts(contexts) {
    if (!contexts || !Array.isArray(contexts)) return [];

    // filled状態のコンテキストのみ保持（最大20件）
    const filled = contexts
      .filter(c => c.status === 'filled')
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);

    // pending状態のコンテキスト（3週間以内のもの）
    const threeWeeksAgo = new Date();
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);

    const pending = contexts.filter(c => {
      if (c.status !== 'pending') return false;
      const contextDate = new Date(c.createdAt || c.date);
      return contextDate >= threeWeeksAgo;
    });

    return [...filled, ...pending];
  }

  /**
   * デバッグモードを有効化
   * コンソールに詳細ログを出力
   */
  function enableDebugMode() {
    window.__geminiSlidesDebug = true;
    console.log('[Gemini Slides] Debug mode enabled');

    // デバッグ用のグローバル関数を追加
    window.geminiDebug = {
      getState: () => state,
      getProject: async () => {
        if (!state.currentProjectId) return null;
        return await loadProject(state.currentProjectId);
      },
      getAllProjects: async () => await getAllProjects(),
      buildContext: async () => await buildContextPrompt(),
      clearStorage: async () => {
        await chrome.storage.local.clear();
        console.log('Storage cleared');
      }
    };

    console.log('Debug functions available at window.geminiDebug');
  }

  /**
   * 週次入力が未入力の場合、リマインダーを表示
   */
  async function showWeeklyInputReminder() {
    try {
      if (!state.currentProjectId) return;

      const project = await loadProject(state.currentProjectId);
      if (!project || !project.externalContexts) return;

      // 未入力（pending）のコンテキストを確認
      const pendingContexts = project.externalContexts.filter(c => c.status === 'pending');

      if (pendingContexts.length === 0) {
        return; // リマインダー不要
      }

      // 最新の未入力コンテキストを確認
      const latestPending = pendingContexts.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const daysSinceCreated = Math.floor((Date.now() - new Date(latestPending.createdAt)) / (1000 * 60 * 60 * 24));

      // 3日以上経過している場合、リマインダーを表示
      if (daysSinceCreated >= 3) {
        showReminderNotification(latestPending.date);
      }
    } catch (error) {
      console.error('[Reminder] Failed to check reminder:', error);
    }
  }

  /**
   * リマインダー通知を表示
   * @param {string} date - 未入力の日付
   */
  function showReminderNotification(date) {
    const existing = shadowRoot.querySelector('#reminder-notification');
    if (existing) return; // 既に表示されている

    // リマインダー要素を作成
    const element = document.createElement('div');
    element.id = 'reminder-notification';
    element.className = 'reminder-notification';
    element.innerHTML = `
      <div class="reminder-content">
        <span class="reminder-icon">⏰</span>
        <span class="reminder-text">Context for ${date} is still empty</span>
        <button class="reminder-action">Fill Now</button>
        <button class="reminder-dismiss">×</button>
      </div>
    `;

    const panel = shadowRoot.querySelector('.gemini-panel');
    if (panel) {
      panel.insertBefore(element, panel.firstChild);
    }

    // イベントリスナー
    element.querySelector('.reminder-action')?.addEventListener('click', () => {
      switchTab('context');
      element.remove();
    });

    element.querySelector('.reminder-dismiss')?.addEventListener('click', () => {
      element.remove();
    });
  }

  /**
   * ストレージ使用状況を更新
   */
  async function updateStorageInfo() {
    const storageInfo = shadowRoot.querySelector('#storage-info');
    if (!storageInfo) return;

    try {
      const allData = await chrome.storage.local.get(null);
      const dataString = JSON.stringify(allData);
      const bytesUsed = new Blob([dataString]).size;
      const mbUsed = (bytesUsed / (1024 * 1024)).toFixed(2);
      const percentUsed = ((bytesUsed / (10 * 1024 * 1024)) * 100).toFixed(1);

      storageInfo.innerHTML = `
        <small>Storage: ${mbUsed} MB / 10 MB (${percentUsed}%)</small>
      `;
    } catch (error) {
      console.error('[Storage Info] Failed to calculate storage usage:', error);
      storageInfo.innerHTML = '<small>Storage: Calculation Error</small>';
    }
  }

  // URLパラメータに ?debug=true があれば自動有効化
  if (window.location.search.includes('debug=true')) {
    enableDebugMode();
  }
})();
