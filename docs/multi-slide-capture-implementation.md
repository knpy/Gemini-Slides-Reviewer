# 全スライド一括キャプチャ機能の実装

## 概要
Google Slidesプレゼンテーション内の全スライドのスクリーンショットを自動的に収集し、Gemini APIに送信して一括分析する機能。

## 実装済みの機能

### 1. サムネイルの遅延読み込み対応
Google Slidesはサムネイルを遅延読み込みするため、スクロールして全サムネイルを読み込む必要がある。

```javascript
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
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Scroll back to top
  filmstripScroll.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 300));

  console.log('[Gemini Slides] All thumbnails loaded');
}
```

### 2. キーボードナビゲーションでスライド移動
サムネイルをクリックすると予期しないページ遷移が発生する問題を回避するため、キーボードイベントを使用。

```javascript
// Navigate to first slide
document.body.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Home',
  code: 'Home',
  keyCode: 36,
  bubbles: true,
  cancelable: true
}));
await new Promise(resolve => setTimeout(resolve, 1000));

// Navigate to next slide
document.body.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'ArrowDown',
  code: 'ArrowDown',
  keyCode: 40,
  bubbles: true,
  cancelable: true
}));
await new Promise(resolve => setTimeout(resolve, 800));
```

### 3. スライド数の検出
サムネイル要素の数をカウントして総スライド数を取得。

```javascript
function getSlideOptionNodes() {
  const thumbnails = document.querySelectorAll('.punch-filmstrip-thumbnail');
  console.log(`[Gemini Slides] Found ${thumbnails.length} slide thumbnails`);

  // Return dummy objects since we use keyboard navigation
  return Array.from({ length: thumbnails.length }, (_, i) => ({ index: i }));
}
```

### 4. 全スライド収集ループ
```javascript
async function handleRunAllSlides(event) {
  // Prevent default behavior
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

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

    // Navigate to first slide first
    if (totalSlides > 0) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Home',
        code: 'Home',
        keyCode: 36,
        bubbles: true,
        cancelable: true
      }));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    for (let i = 0; i < totalSlides; i++) {
      setStatusWithSpinner(`スライド ${i + 1}/${totalSlides} を収集中...\n\n`, "streaming");

      const summary = await collectPresentationSummary(i + 1);

      if (summary?.slides?.[0]) {
        allSlides.push({
          number: i + 1,
          screenshot: summary.slides[0].screenshot
        });
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
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    // Send all slides to Gemini for holistic analysis
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
```

### 5. Gemini APIへの複数画像送信
背景スクリプト (background.js) で複数画像を含むリクエストを作成。

```javascript
async function runGeminiCheckStreaming(payload, tabId) {
  const apiKey = await resolveApiKey();
  const userPrompt = payload.prompt.trim();

  // Check if this is a multi-slide analysis
  const slides = payload.presentationSummary.slides || [];
  const isMultiSlideAnalysis = slides.length > 1;

  // Build the parts array with appropriate context
  let promptText = userPrompt;
  if (isMultiSlideAnalysis) {
    promptText = `以下の${slides.length}枚のスライド画像を順番に分析してください。各スライドを確認した上で、以下の指示に従ってください：\n\n${userPrompt}`;
  }

  const parts = [{ text: promptText }];

  // Add all screenshots
  let screenshotCount = 0;

  slides.forEach((slide, index) => {
    const screenshot = slide?.screenshot;
    if (screenshot && typeof screenshot === 'string' && screenshot.includes(',')) {
      const base64Data = screenshot.split(',')[1];
      if (base64Data) {
        parts.push({
          inline_data: {
            mime_type: "image/png",
            data: base64Data
          }
        });
        screenshotCount++;
      }
    }
  });

  console.log(`[Gemini API] Sending ${screenshotCount} screenshot(s) to Gemini Vision`);

  const streamEndpoint = GEMINI_ENDPOINT.replace(':generateContent', ':streamGenerateContent');
  const response = await fetch(`${streamEndpoint}?key=${encodeURIComponent(apiKey)}&alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    })
  });

  // ... streaming response handling
}
```

## 解決した問題

### 問題1: サムネイルクリックでページ遷移
**症状**: サムネイルをクリックすると `https://docs.google.com/presentation/u/0/?tgif=d` に遷移してしまう

**解決策**: キーボードイベント (Home, ArrowDown) を使用してスライド間を移動

### 問題2: 一部のスライドしか検出されない
**症状**: 25スライド中12スライドしか検出されない

**原因**: Google Slidesの遅延読み込み

**解決策**: `ensureAllThumbnailsLoaded()` 関数でフィルムストリップをスクロールして全サムネイルを読み込む

### 問題3: Geminiが画像を分析しない
**症状**: 25枚の画像が送信されているのに、Geminiがプレゼンテーションと無関係な内容を返す

**原因**: プロンプトに画像を分析する指示がなかった

**解決策**: 複数スライドの場合、プロンプトの前に「以下のX枚のスライド画像を順番に分析してください」という指示を追加

## 未解決の問題

### スクリーンショット品質の問題
**症状**: キャプチャされた画像が潰れたり、複数スライドが1つの画像に含まれてしまう

**原因**: SVG要素の選択ロジックが不適切

**詳細**:
- `#canvas` DIV要素は空（children count: 0）
- SVGは `#canvas` の外側にある
- 全SVG要素から最大のものを選ぶと、フィルムストリップ全体のSVGが選ばれる可能性がある

**試行した解決策**:
1. `svgRect` を使用してアスペクト比を保つ → 効果なし
2. `#canvas` 内のSVGのみを検索 → SVGが見つからない
3. 可視範囲のSVGをフィルタリング → まだテスト中

## タイミングパラメータ

```javascript
// サムネイルスクロール時の待機時間
await new Promise(resolve => setTimeout(resolve, 200));

// スクロール完了後の待機時間
await new Promise(resolve => setTimeout(resolve, 300));

// 最初のスライドへの移動後の待機時間
await new Promise(resolve => setTimeout(resolve, 1000));

// 次のスライドへの移動後の待機時間
await new Promise(resolve => setTimeout(resolve, 800));
```

これらのタイミングは、Google SlidesのDOM更新を待つために必要。

## UI変更

### ボタンの追加
```html
<button type="button" class="button" id="gemini-run-button">現在のスライドを分析</button>
<button type="button" class="button" id="gemini-run-all-button">全スライドを分析</button>
```

## 今後の改善案

1. **スクリーンショット品質の改善**
   - 正しいSVG要素を特定するロジックの改善
   - Chrome Tab Capture APIの使用を検討

2. **パフォーマンス最適化**
   - 並列キャプチャの可能性を検討
   - タイミング値の最適化

3. **エラーハンドリング**
   - スライドキャプチャ失敗時のリトライ
   - 部分的な成功時の処理

4. **プログレス表示**
   - より詳細な進捗インジケーター
   - キャンセル機能の追加
