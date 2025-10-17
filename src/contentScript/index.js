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
      audience: ''
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

    // Phase 2: Tab switching
    state.ui.tabButtons?.forEach(button => {
      button.addEventListener("click", handleTabSwitch);
    });

    // Phase 2: Context management
    state.ui.saveContextButton?.addEventListener("click", handleSaveContext);
    state.ui.staticContextToggle?.addEventListener("click", handleToggleStaticContext);

    // Phase 2: Project selector
    state.ui.projectSelect?.addEventListener("change", handleProjectSwitch);

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
          background: #1b73e8;
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 8px 20px rgba(27,115,232,0.35);
          cursor: pointer;
          z-index: 2147483646;
        }
        .gemini-floating-button:hover {
          background: #1559b5;
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
      <button class=\"gemini-floating-button\" aria-haspopup=\"true\">Gemini check</button>
      <section class=\"gemini-panel\" role=\"complementary\" aria-label=\"Gemini Slides Reviewer\">
        <header>
          <div class=\"header-top\">
            <h1>Gemini Slides Reviewer</h1>
            <button type=\"button\" aria-label=\"Close panel\">×</button>
          </div>
          <div class=\"project-selector\">
            <label for=\"gemini-project-select\">📁 Project:</label>
            <select id=\"gemini-project-select\">
              <option value=\"\">Loading...</option>
            </select>
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
            <div class=\"button-row\">
              <button class=\"button secondary\" id=\"gemini-save-prompt\">プリセット保存</button>
              <button class=\"button secondary\" id=\"gemini-add-prompt\">複製して新規作成</button>
              <button class=\"button danger\" id=\"gemini-reset-prompt\">デフォルトに戻す</button>
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
    state.ui.openButton = shadowRoot.querySelector(".gemini-floating-button");
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
      const fullPrompt = contextPrompt
        ? `${contextPrompt}[レビュー依頼]\n${userPrompt}\n\n以下のスライドを、上記のコンテキストを踏まえてレビューしてください。`
        : userPrompt;

      console.log('[Gemini Slides] Full prompt with context:', fullPrompt);

      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK",
        payload: {
          prompt: fullPrompt,  // コンテキスト統合済みプロンプト
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
      const fullPrompt = contextPrompt
        ? `${contextPrompt}[レビュー依頼]\n${userPrompt}\n\n以下の${allSlides.length}枚のスライドを含むプレゼンテーションを、上記のコンテキストを踏まえてレビューしてください。`
        : userPrompt;

      console.log('[Gemini Slides] Full prompt with context (PDF):', fullPrompt);

      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK_PDF",
        payload: {
          prompt: fullPrompt,  // コンテキスト統合済みプロンプト
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

    // Get slide number (use provided or detect)
    let finalSlideNumber = slideNumber;
    if (!finalSlideNumber) {
      const slideNodes = getSlideOptionNodes();
      const activeOrder = getActiveSlideOrder(slideNodes);
      finalSlideNumber = activeOrder !== -1 ? activeOrder + 1 : 1;
    }

    summary.slides.push({
      number: finalSlideNumber,
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
    const selectors = [
      '[role="listbox"] [role="option"]',
      '[role="grid"] [role="option"]',
      '[aria-label*="Slide"]',
      '[aria-label*="スライド"]',
      '[aria-label*="ページ"]'
    ];
    const nodes = [];
    const seen = new WeakSet();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((candidate) => {
        if (!(candidate instanceof HTMLElement)) return;
        if (seen.has(candidate)) return;
        if (!isSlideOptionNode(candidate)) return;
        seen.add(candidate);
        nodes.push(candidate);
      });
    });
    return nodes.sort((a, b) => {
      const ai = getSlideIndex(a);
      const bi = getSlideIndex(b);
      if (ai === null && bi === null) return 0;
      if (ai === null) return 1;
      if (bi === null) return -1;
      return ai - bi;
    });
  }

  function isSlideOptionNode(node) {
    if (!node) return false;
    if (node.hasAttribute("data-slide-index") || node.dataset?.slideIndex) {
      return true;
    }
    const label = node.getAttribute("aria-label") || "";
    if (!label) return false;
    if (/(?:Slide|スライド|ページ|Diapositiva|Diapositive)\s*\d+/i.test(label)) {
      return true;
    }
    const lower = label.toLowerCase();
    return lower.includes("slide") || label.includes("スライド") || label.includes("ページ");
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
      if (node.getAttribute("aria-selected") === "true") return true;
      return (
        node.classList.contains("punch-filmstrip-thumbnail-active") ||
        node.classList.contains("punch-filmstrip-selected") ||
        node.classList.contains("is-selected")
      );
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
   * @returns {string} タイトル（取得できない場合は空文字列）
   */
  function getPresentationTitle() {
    // Google Slidesのタイトル要素を探す
    const titleSelectors = [
      '.docs-title-input',
      '[role="textbox"][aria-label*="title"]',
      '[role="textbox"][aria-label*="タイトル"]'
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    return '';
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
   * 新規プロジェクトを作成
   */
  async function createNewProject() {
    const projectName = prompt('新しいプロジェクト名を入力してください:', getPresentationTitle() || '無題のプロジェクト');

    if (!projectName) {
      // キャンセルされた場合、ドロップダウンを元に戻す
      if (state.currentProjectId && state.ui.projectSelect) {
        state.ui.projectSelect.value = state.currentProjectId;
      }
      return;
    }

    try {
      const projectId = generateProjectId();
      const newProject = {
        ...clone(DEFAULT_PROJECT_STRUCTURE),
        projectName: projectName.trim(),
        createdAt: new Date().toISOString()
      };

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
    } catch (error) {
      console.error('[Gemini Slides] Failed to create new project:', error);
      alert('プロジェクトの作成に失敗しました: ' + error.message);
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
      let projectId = await getProjectIdByUrl(presentationId);

      // プロジェクトIDが見つからない場合、新規作成
      if (!projectId) {
        projectId = generateProjectId();
        const title = getPresentationTitle() || '無題のプレゼンテーション';

        const newProject = {
          ...clone(DEFAULT_PROJECT_STRUCTURE),
          projectName: title,
          createdAt: new Date().toISOString()
        };

        await saveProject(projectId, newProject);
        await saveUrlProjectMapping(presentationId, projectId);

        console.log('[Gemini Slides] Created new project:', projectId);
        state.currentProjectId = projectId;

        // UIを更新
        await updateProjectSelector();
        updateProjectUI(newProject);
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
      if (!state.currentProjectId) {
        console.warn('[Gemini Slides] No current project ID');
        return;
      }

      // 現在のプロジェクトデータを取得
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

        // Phase 4: コンテキストインジケーター更新
        await updateContextIndicator();

        // Phase 5: ストレージ情報更新
        await updateStorageInfo();
      } else {
        console.error('[Gemini Slides] Failed to save context');
      }
    } catch (error) {
      console.error('[Gemini Slides] Error saving context:', error);
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
      const currentTitle = getPresentationTitle();
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
