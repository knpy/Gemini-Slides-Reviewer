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

  const state = {
    prompts: [],
    selectedPromptId: null,
    ui: {},
    isPanelVisible: false,
    latestResult: null
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
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .gemini-panel header h1 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        .gemini-panel header button {
          background: transparent;
          border: none;
          color: #9aa0a6;
          font-size: 18px;
          cursor: pointer;
        }
        .gemini-panel header button:hover {
          color: #fff;
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
      </style>
      <button class=\"gemini-floating-button\" aria-haspopup=\"true\">Gemini check</button>
      <section class=\"gemini-panel\" role=\"complementary\" aria-label=\"Gemini Slides Reviewer\">
        <header>
          <h1>Gemini Slides Reviewer</h1>
          <button type=\"button\" aria-label=\"Close panel\">×</button>
        </header>
        <main>
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

      const promptText = state.ui.promptTextarea.value.trim();
      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK",
        payload: {
          prompt: promptText,
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
      const slideNodes = getSlideOptionNodes();
      const totalSlides = slideNodes.length;

      if (totalSlides === 0) {
        throw new Error("スライドが見つかりません");
      }

      setStatusWithSpinner(`全${totalSlides}スライドを収集中...\n\n`, "streaming");

      // Step 1: Collect all slides
      const allSlides = [];
      for (let i = 0; i < totalSlides; i++) {
        setStatusWithSpinner(`スライド ${i + 1}/${totalSlides} を収集中...\n\n`, "streaming");

        slideNodes[i].click();
        await new Promise(resolve => setTimeout(resolve, 500));

        const summary = await collectPresentationSummary();
        if (summary?.slides?.[0]) {
          allSlides.push({
            number: i + 1,
            screenshot: summary.slides[0].screenshot
          });
        }
      }

      // Step 2: Send all slides to Gemini for holistic analysis
      setStatusWithSpinner(`全体のストーリーを分析中...\n\n`, "streaming");

      const promptText = state.ui.promptTextarea.value.trim();
      const response = await chrome.runtime.sendMessage({
        type: "GEMINI_RUN_CHECK",
        payload: {
          prompt: promptText,
          presentationSummary: {
            capturedAt: Date.now(),
            slides: allSlides
          }
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

  async function collectPresentationSummary() {
    const summary = {
      capturedAt: Date.now(),
      slides: []
    };

    // Capture screenshot of current slide
    const screenshot = await captureSlideScreenshot();

    // Get slide number
    const slideNodes = getSlideOptionNodes();
    const activeOrder = getActiveSlideOrder(slideNodes);
    const slideNumber = activeOrder !== -1 ? activeOrder + 1 : 1;

    summary.slides.push({
      number: slideNumber,
      screenshot: screenshot
    });

    return summary;
  }

  async function captureSlideScreenshot() {
    try {
      // Find the main slide canvas/SVG
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

      // Use html2canvas-like approach with native DOM
      const rect = slideElement.getBoundingClientRect();
      console.log('[Gemini Slides] Slide element rect:', rect);

      // Log children
      console.log('[Gemini Slides] Slide element children count:', slideElement.children.length);
      if (slideElement.children.length > 0) {
        console.log('[Gemini Slides] First child tag:', slideElement.children[0].tagName);
      }

      // Create a canvas to draw the element
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d');

      // Try to find SVG in multiple ways
      let svgElement = slideElement.tagName === 'SVG' ? slideElement : null;

      if (!svgElement) {
        // Look for SVG child
        svgElement = slideElement.querySelector('svg');
        console.log('[Gemini Slides] SVG querySelector result:', svgElement);
      }

      if (!svgElement) {
        // Look for SVG in parent or siblings
        const parent = slideElement.parentElement;
        svgElement = parent?.querySelector('svg');
        console.log('[Gemini Slides] SVG in parent result:', svgElement);
      }

      // Try to find all SVGs in document
      if (!svgElement) {
        const allSvgs = document.querySelectorAll('svg');
        console.log('[Gemini Slides] Total SVGs in document:', allSvgs.length);
        if (allSvgs.length > 0) {
          // Use the largest SVG (likely the slide)
          svgElement = Array.from(allSvgs).reduce((largest, svg) => {
            const svgRect = svg.getBoundingClientRect();
            const largestRect = largest.getBoundingClientRect();
            return (svgRect.width * svgRect.height) > (largestRect.width * largestRect.height) ? svg : largest;
          });
          console.log('[Gemini Slides] Using largest SVG');
        }
      }

      console.log('[Gemini Slides] Final SVG element:', svgElement ? svgElement.tagName : 'not found');

      if (svgElement) {
        const svgData = new XMLSerializer().serializeToString(svgElement);
        console.log('[Gemini Slides] SVG data length:', svgData.length);

        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();

        // Increase resolution by scaling up (2x or 3x for higher quality)
        const scale = 2; // 2x resolution
        const highResWidth = rect.width * scale;
        const highResHeight = rect.height * scale;

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
            const result = canvas.toDataURL('image/png', 1.0); // 1.0 = maximum quality
            console.log('[Gemini Slides] High-res screenshot created:', result.substring(0, 50) + '...');
            resolve(result);
          };
          img.onerror = (error) => {
            console.error('[Gemini Slides] Image load error:', error);
            reject(error);
          };
          img.src = url;
        });

        return dataUrl;
      }

      console.warn('[Gemini Slides] No SVG found, cannot create screenshot');
      return null;
    } catch (error) {
      console.error('[Gemini Slides] Screenshot capture failed:', error);
      return null;
    }
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
})();
