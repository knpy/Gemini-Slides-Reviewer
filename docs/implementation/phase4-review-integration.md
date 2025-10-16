# Phase 4: レビュー統合の実装

## 概要

保存されたコンテキスト情報を統合し、Geminiへのプロンプト生成とレビュー実行時の送信機能を実装する。

## 実装内容

### 1. コンテキスト統合機能

**ファイル**: `src/contentScript/index.js`

**関数**: `buildContextPrompt()`

```javascript
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
```

---

### 2. 単一スライドレビュー時のコンテキスト送信

**ファイル**: `src/contentScript/index.js`

**関数**: `handleRunCheck()` の修正

```javascript
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

    // **新規追加**: コンテキスト統合
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
```

---

### 3. 全スライドレビュー時のコンテキスト送信

**ファイル**: `src/contentScript/index.js`

**関数**: `handleRunAllSlides()` の修正

```javascript
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
            await new Promise(resolve => setTimeout(resolve, 400));
          } else {
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
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Step 2: Create PDF from all screenshots
    setStatusWithSpinner(`PDFを作成中...\n\n`, "streaming");
    const pdfDataUrl = await createPDFFromScreenshots(allSlides);

    // Step 3: Send PDF to Gemini for holistic analysis
    setStatusWithSpinner(`全体のストーリーを分析中...\n\n`, "streaming");

    // **新規追加**: コンテキスト統合
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
```

---

### 4. コンテキスト表示インジケーター

**ファイル**: `src/contentScript/index.js`

レビュータブに、現在のコンテキスト状態を表示する簡易インジケーターを追加。

**HTML追加**（レビュータブ内、実行ボタンの上）:

```html
<div class="context-indicator" id="context-indicator">
  <span class="indicator-icon">📋</span>
  <span class="indicator-text">コンテキスト: 未設定</span>
</div>
```

**CSS追加**:

```css
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
```

**関数**: `updateContextIndicator()`

```javascript
/**
 * コンテキストインジケーターを更新
 */
async function updateContextIndicator() {
  const indicator = shadowRoot.querySelector('#context-indicator');
  if (!indicator) return;

  const contextPrompt = await buildContextPrompt();

  if (contextPrompt) {
    indicator.classList.add('active');
    const textElement = indicator.querySelector('.indicator-text');
    if (textElement) {
      textElement.textContent = 'コンテキスト: 設定済み';
    }
  } else {
    indicator.classList.remove('active');
    const textElement = indicator.querySelector('.indicator-text');
    if (textElement) {
      textElement.textContent = 'コンテキスト: 未設定';
    }
  }
}
```

**`initialize()` 関数に追加**:

```javascript
// コンテキストインジケーター更新
await updateContextIndicator();
```

**コンテキスト保存時に更新**（`saveStaticContext()`, `saveExternalContext()` の最後）:

```javascript
// コンテキストインジケーター更新
await updateContextIndicator();
```

---

### 5. コンテキストプレビュー機能（オプション）

レビュータブで、現在のコンテキストをプレビューできる機能。

**HTML追加**（コンテキストインジケーターの下）:

```html
<details class="context-preview" id="context-preview">
  <summary>コンテキストをプレビュー</summary>
  <pre class="context-preview-content"></pre>
</details>
```

**CSS追加**:

```css
.context-preview {
  margin-bottom: 12px;
  font-size: 12px;
}

.context-preview summary {
  cursor: pointer;
  color: #9aa0a6;
  padding: 8px;
  background: rgba(255,255,255,0.02);
  border-radius: 6px;
}

.context-preview summary:hover {
  background: rgba(255,255,255,0.05);
}

.context-preview .context-preview-content {
  margin-top: 8px;
  padding: 12px;
  background: #2d2e30;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: #e8eaed;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}
```

**関数**: `updateContextPreview()`

```javascript
/**
 * コンテキストプレビューを更新
 */
async function updateContextPreview() {
  const preview = shadowRoot.querySelector('#context-preview');
  if (!preview) return;

  const contextPrompt = await buildContextPrompt();
  const contentElement = preview.querySelector('.context-preview-content');

  if (contentElement) {
    if (contextPrompt) {
      contentElement.textContent = contextPrompt;
    } else {
      contentElement.textContent = 'コンテキストが設定されていません。';
    }
  }
}
```

**コンテキスト保存時に更新**:

```javascript
// コンテキストプレビュー更新
await updateContextPreview();
```

---

### 6. Background Script の修正（不要）

現在の `runGeminiCheckStreaming()` と `runGeminiCheckWithPDF()` は、
すでに `payload.prompt` をそのまま受け取って送信しているため、
コンテキスト統合済みのプロンプトが自動的に送信される。

**修正不要**: Background Script は現状のまま動作する。

---

## 実装チェックリスト

- [ ] `buildContextPrompt()` の実装
- [ ] `handleRunCheck()` の修正（コンテキスト統合）
- [ ] `handleRunAllSlides()` の修正（コンテキスト統合）
- [ ] コンテキストインジケーターのHTML追加
- [ ] コンテキストインジケーターのCSS追加
- [ ] `updateContextIndicator()` の実装
- [ ] コンテキストプレビューのHTML追加（オプション）
- [ ] コンテキストプレビューのCSS追加（オプション）
- [ ] `updateContextPreview()` の実装（オプション）
- [ ] `initialize()` の修正（インジケーター更新）
- [ ] コンテキスト保存時のインジケーター更新

---

## テストシナリオ

### シナリオ1: コンテキストなしでレビュー
1. 新規プロジェクトでコンテキストを設定しない
2. 「現在のスライドを分析」を実行
3. 通常のプロンプトのみが送信される
4. レビュー結果が表示される

### シナリオ2: 静的コンテキストのみでレビュー
1. コンテキストタブで目的と対象者を入力
2. 保存する
3. レビュータブに戻る
4. コンテキストインジケーターが「設定済み」になる
5. 「現在のスライドを分析」を実行
6. プロンプトに「[プロジェクトコンテキスト]」が含まれる
7. より的確なレビュー結果が返ってくる

### シナリオ3: 外部コンテキスト込みでレビュー
1. 静的コンテキストを設定
2. 外部コンテキストを追加して議事録を入力
3. 保存する
4. レビュータブで「コンテキストをプレビュー」を開く
5. 静的コンテキストと外部コンテキストが表示される
6. 「全スライドを分析」を実行
7. プロンプトに両方のコンテキストが含まれる
8. 過去の議論を踏まえたレビュー結果が返ってくる

### シナリオ4: コンテキストの更新反映
1. コンテキストを設定してレビュー実行
2. 結果を確認
3. コンテキストタブで外部コンテキストを追加
4. 保存する
5. レビュータブに戻る
6. 再度レビュー実行
7. 新しいコンテキストが反映されたレビューが返ってくる

---

## 次のフェーズ

Phase 4完了後、Phase 5（快適性向上）の実装に進む。
