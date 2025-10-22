# Phase 6: キックオフURL自動入力機能

## 概要

プロジェクト作成時または既存プロジェクトで、キックオフMTGのGoogle SlidesのURLを指定することで、Project Context（目的・対象者）を自動的に抽出・入力する機能を実装する。

## 目的

- プロジェクト開始時のコンテキスト入力の手間を削減
- キックオフ資料から正確な情報を自動抽出
- プロジェクトの一貫性を保つ

## ユースケース

### ユースケース1: 新規プロジェクト作成時にキックオフURLを指定

**前提条件**:
- ユーザーがGoogle Slidesで新しいプレゼンテーションを開いている
- キックオフMTGのGoogle Slidesが存在する

**フロー**:
1. ユーザーがプロジェクトセレクターで「+ 新規プロジェクト作成」を選択
2. プロジェクト作成ダイアログが表示される
   - プロジェクト名入力欄
   - キックオフURL入力欄（任意）
3. ユーザーがプロジェクト名とキックオフURLを入力
4. 「作成」ボタンをクリック
5. システムがキックオフURLからコンテキストを抽出
   - 抽出中はローディング表示
6. 抽出が完了すると、Project Contextに自動入力される
7. プロジェクトが作成され、Contextタブで確認可能

**期待結果**:
- Project Contextの「Purpose」と「Audience」が自動入力されている
- キックオフURLがプロジェクトデータに保存されている

### ユースケース2: 既存プロジェクトにキックオフURLを追加

**前提条件**:
- 既存のプロジェクトが選択されている
- Project Contextに既存の内容がある（または空）

**フロー**:
1. ユーザーがContextタブを開く
2. 「🔗 キックオフURLから取得」ボタンをクリック
3. URL入力ダイアログが表示される
4. ユーザーがキックオフURLを入力して「取得」をクリック
5. システムがコンテキストを抽出
6. 既存のコンテキストとのDiffを計算
7. 差分があれば、追記または更新の確認ダイアログを表示
8. ユーザーが承認すると、コンテキストが更新される

**期待結果**:
- 既存のコンテキストに新しい情報が追記される
- 重複は避け、新しい情報のみが追加される

## 機能仕様

### 1. データ構造の拡張

**プロジェクトデータ構造に追加**:

```javascript
const DEFAULT_PROJECT_STRUCTURE = {
  projectName: '',
  createdAt: '',
  updatedAt: '',
  weeklyInputDay: 1,
  staticContext: {
    purpose: '',
    audience: '',
    kickoffUrl: ''  // NEW: キックオフURL
  },
  externalContexts: []
};
```

### 2. コンテキスト抽出フロー

```
┌─────────────────┐
│ User Input URL  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Validate URL    │
│ (Google Slides) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Open URL in     │
│ Background Tab  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Extract Text    │
│ (Content Script)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send to Gemini  │
│ API             │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Parse JSON      │
│ Response        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Calculate Diff  │
│ (if existing)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Update Context  │
│ & Save          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Close Tab       │
│ & Show Result   │
└─────────────────┘
```

### 3. UI設計

#### 3.1 新規プロジェクト作成ダイアログ（改善）

**HTML**:

```html
<div class="create-project-dialog">
  <div class="dialog-overlay"></div>
  <div class="dialog-content">
    <h2>新規プロジェクト作成</h2>

    <div class="field">
      <label for="new-project-name">プロジェクト名 *</label>
      <input
        type="text"
        id="new-project-name"
        placeholder="例: 営業資料リニューアル"
        required
      />
    </div>

    <div class="field">
      <label for="new-project-kickoff-url">キックオフURL（任意）</label>
      <input
        type="url"
        id="new-project-kickoff-url"
        placeholder="https://docs.google.com/presentation/d/..."
      />
      <small class="field-hint">
        キックオフMTGのGoogle Slidesを指定すると、目的・対象者を自動抽出します
      </small>
    </div>

    <div class="dialog-actions">
      <button class="button secondary" id="cancel-create-project">キャンセル</button>
      <button class="button primary" id="confirm-create-project">作成</button>
    </div>
  </div>

  <!-- 抽出中の表示 -->
  <div class="extracting-overlay" style="display:none;">
    <div class="extracting-content">
      <div class="spinner"></div>
      <p>キックオフ資料からコンテキストを抽出中...</p>
    </div>
  </div>
</div>
```

**CSS**:

```css
.create-project-dialog .dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2147483646;
}

.create-project-dialog .dialog-content {
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

.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #9aa0a6;
  line-height: 1.4;
}

.extracting-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(45, 46, 48, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  z-index: 2147483648;
}

.extracting-content {
  text-align: center;
  color: #e8eaed;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(138, 180, 248, 0.3);
  border-top-color: #8ab4f8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

#### 3.2 Contextタブに「キックオフURLから取得」ボタン追加

**HTML**:

```html
<div class="context-section">
  <div class="context-section-title" data-toggle="static-context">
    <span>Project Context</span>
    <span class="toggle-icon">▼</span>
  </div>
  <div class="context-section-content" id="static-context-content">
    <!-- NEW: キックオフURL取得ボタン -->
    <button class="button secondary small" id="extract-from-kickoff">
      🔗 キックオフURLから取得
    </button>

    <div class="field">
      <label for="gemini-context-purpose">Purpose</label>
      <textarea id="gemini-context-purpose" placeholder="このプレゼンテーションの目的を入力してください"></textarea>
    </div>

    <div class="field">
      <label for="gemini-context-audience">Audience</label>
      <textarea id="gemini-context-audience" placeholder="想定される聴衆を入力してください"></textarea>
    </div>

    <!-- NEW: キックオフURL表示 -->
    <div class="kickoff-url-display" id="kickoff-url-display" style="display:none;">
      <small>キックオフURL:</small>
      <a href="#" target="_blank" id="kickoff-url-link"></a>
    </div>
  </div>
</div>
```

**CSS**:

```css
.button.small {
  padding: 6px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}

.kickoff-url-display {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(138, 180, 248, 0.05);
  border-radius: 6px;
  border: 1px solid rgba(138, 180, 248, 0.2);
}

.kickoff-url-display small {
  display: block;
  color: #9aa0a6;
  font-size: 11px;
  margin-bottom: 4px;
}

.kickoff-url-display a {
  color: #8ab4f8;
  text-decoration: none;
  font-size: 12px;
  word-break: break-all;
}

.kickoff-url-display a:hover {
  text-decoration: underline;
}
```

#### 3.3 キックオフURL入力ダイアログ

**HTML**:

```html
<div class="kickoff-url-dialog">
  <div class="dialog-overlay"></div>
  <div class="dialog-content">
    <h2>キックオフURLから取得</h2>
    <p>キックオフMTGのGoogle Slidesから、プロジェクトの目的と対象者を抽出します。</p>

    <div class="field">
      <label for="kickoff-url-input">Google Slides URL</label>
      <input
        type="url"
        id="kickoff-url-input"
        placeholder="https://docs.google.com/presentation/d/..."
      />
    </div>

    <div class="dialog-actions">
      <button class="button secondary" id="cancel-extract">キャンセル</button>
      <button class="button primary" id="confirm-extract">取得</button>
    </div>
  </div>
</div>
```

### 4. 実装関数

#### 4.1 プロジェクト作成ダイアログ表示

**ファイル**: `src/contentScript/index.js`

**関数**: `showCreateProjectDialog()`

```javascript
/**
 * 新規プロジェクト作成ダイアログを表示
 * @returns {Promise<{name: string, kickoffUrl: string}|null>}
 */
async function showCreateProjectDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'create-project-dialog';
    dialog.innerHTML = `
      <div class="dialog-overlay"></div>
      <div class="dialog-content">
        <h2>新規プロジェクト作成</h2>

        <div class="field">
          <label for="new-project-name">プロジェクト名 *</label>
          <input
            type="text"
            id="new-project-name"
            placeholder="例: 営業資料リニューアル"
            value="${getPresentationTitle() || ''}"
          />
        </div>

        <div class="field">
          <label for="new-project-kickoff-url">キックオフURL（任意）</label>
          <input
            type="url"
            id="new-project-kickoff-url"
            placeholder="https://docs.google.com/presentation/d/..."
          />
          <small class="field-hint">
            キックオフMTGのGoogle Slidesを指定すると、目的・対象者を自動抽出します
          </small>
        </div>

        <div class="dialog-actions">
          <button class="button secondary" id="cancel-create-project">キャンセル</button>
          <button class="button primary" id="confirm-create-project">作成</button>
        </div>
      </div>

      <div class="extracting-overlay" style="display:none;">
        <div class="extracting-content">
          <div class="spinner"></div>
          <p>キックオフ資料からコンテキストを抽出中...</p>
        </div>
      </div>
    `;

    shadowRoot.appendChild(dialog);

    const nameInput = dialog.querySelector('#new-project-name');
    const urlInput = dialog.querySelector('#new-project-kickoff-url');
    const confirmBtn = dialog.querySelector('#confirm-create-project');
    const cancelBtn = dialog.querySelector('#cancel-create-project');

    // フォーカス
    nameInput.focus();

    confirmBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const kickoffUrl = urlInput.value.trim();

      if (!name) {
        alert('プロジェクト名を入力してください');
        return;
      }

      dialog.remove();
      resolve({ name, kickoffUrl });
    });

    cancelBtn.addEventListener('click', () => {
      dialog.remove();
      resolve(null);
    });
  });
}
```

#### 4.2 キックオフURLからコンテキスト抽出

**ファイル**: `src/contentScript/index.js`

**関数**: `extractContextFromKickoffUrl(url)`

```javascript
/**
 * キックオフURLからコンテキストを抽出
 * @param {string} url - キックオフGoogle SlidesのURL
 * @returns {Promise<{purpose: string, audience: string}|null>}
 */
async function extractContextFromKickoffUrl(url) {
  try {
    console.log('[Kickoff Extract] Starting extraction from:', url);

    // URLバリデーション
    if (!url || !url.includes('docs.google.com/presentation')) {
      throw new Error('Google SlidesのURLを指定してください');
    }

    // Background scriptに抽出リクエストを送信
    const response = await chrome.runtime.sendMessage({
      type: 'EXTRACT_CONTEXT_FROM_URL',
      payload: { url }
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'コンテキストの抽出に失敗しました');
    }

    console.log('[Kickoff Extract] Extraction successful:', response.data);
    return response.data;

  } catch (error) {
    console.error('[Kickoff Extract] Failed:', error);
    throw error;
  }
}
```

#### 4.3 既存コンテキストとのDiff計算

**ファイル**: `src/contentScript/index.js`

**関数**: `mergeContextWithDiff(existing, extracted)`

```javascript
/**
 * 既存コンテキストと抽出コンテキストをマージ
 * @param {object} existing - 既存のコンテキスト {purpose, audience}
 * @param {object} extracted - 抽出されたコンテキスト {purpose, audience}
 * @returns {object} - マージされたコンテキスト
 */
function mergeContextWithDiff(existing, extracted) {
  const merged = {
    purpose: '',
    audience: ''
  };

  // Purpose: 既存と抽出を改行で結合（重複を避ける）
  const existingPurpose = (existing.purpose || '').trim();
  const extractedPurpose = (extracted.purpose || '').trim();

  if (existingPurpose && extractedPurpose) {
    // 既存と抽出が異なる場合は追記
    if (!existingPurpose.includes(extractedPurpose)) {
      merged.purpose = `${existingPurpose}\n\n${extractedPurpose}`;
    } else {
      merged.purpose = existingPurpose;
    }
  } else {
    merged.purpose = extractedPurpose || existingPurpose;
  }

  // Audience: 同様に処理
  const existingAudience = (existing.audience || '').trim();
  const extractedAudience = (extracted.audience || '').trim();

  if (existingAudience && extractedAudience) {
    if (!existingAudience.includes(extractedAudience)) {
      merged.audience = `${existingAudience}\n\n${extractedAudience}`;
    } else {
      merged.audience = existingAudience;
    }
  } else {
    merged.audience = extractedAudience || existingAudience;
  }

  return merged;
}
```

#### 4.4 新規プロジェクト作成処理の更新

**ファイル**: `src/contentScript/index.js`

**関数**: `createNewProject()` を更新

```javascript
/**
 * 新規プロジェクトを作成
 */
async function createNewProject() {
  // ダイアログを表示
  const result = await showCreateProjectDialog();

  if (!result) {
    // キャンセルされた場合
    if (state.currentProjectId && state.ui.projectSelect) {
      state.ui.projectSelect.value = state.currentProjectId;
    }
    return;
  }

  try {
    const projectId = generateProjectId();
    const newProject = {
      ...clone(DEFAULT_PROJECT_STRUCTURE),
      projectName: result.name,
      createdAt: new Date().toISOString()
    };

    // キックオフURLが指定されている場合、コンテキストを抽出
    if (result.kickoffUrl) {
      try {
        const extractedContext = await extractContextFromKickoffUrl(result.kickoffUrl);

        if (extractedContext) {
          newProject.staticContext = {
            purpose: extractedContext.purpose || '',
            audience: extractedContext.audience || '',
            kickoffUrl: result.kickoffUrl
          };
        }
      } catch (error) {
        console.error('[Project Create] Context extraction failed:', error);
        alert(`コンテキストの抽出に失敗しました: ${error.message}\n\nプロジェクトは作成されますが、コンテキストは手動で入力してください。`);
      }
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
  } catch (error) {
    console.error('[Gemini Slides] Failed to create new project:', error);
    alert('プロジェクトの作成に失敗しました: ' + error.message);
  }
}
```

#### 4.5 既存プロジェクトへのキックオフURL追加

**ファイル**: `src/contentScript/index.js`

**関数**: `handleExtractFromKickoff()`

```javascript
/**
 * キックオフURLからコンテキストを取得してマージ
 */
async function handleExtractFromKickoff() {
  if (!state.currentProjectId) {
    alert('プロジェクトを選択してください');
    return;
  }

  // URL入力ダイアログを表示
  const url = prompt('キックオフMTGのGoogle Slides URLを入力してください:');

  if (!url) return;

  try {
    // ローディング表示
    setStatus('キックオフ資料からコンテキストを抽出中...', 'loading');

    // コンテキスト抽出
    const extractedContext = await extractContextFromKickoffUrl(url);

    if (!extractedContext) {
      throw new Error('コンテキストの抽出に失敗しました');
    }

    // 既存のコンテキストを取得
    const project = await loadProject(state.currentProjectId);
    const existingContext = project.staticContext || {};

    // マージ
    const mergedContext = mergeContextWithDiff(existingContext, extractedContext);

    // UIに反映
    if (state.ui.contextPurpose) {
      state.ui.contextPurpose.value = mergedContext.purpose;
    }
    if (state.ui.contextAudience) {
      state.ui.contextAudience.value = mergedContext.audience;
    }

    // プロジェクトデータを更新
    project.staticContext = {
      ...mergedContext,
      kickoffUrl: url
    };

    await saveProject(state.currentProjectId, project);

    // キックオフURLを表示
    updateKickoffUrlDisplay(url);

    setStatus('コンテキストを取得しました', 'success');

    // コンテキストインジケーター更新
    await updateContextIndicator();

  } catch (error) {
    console.error('[Extract Kickoff] Failed:', error);
    alert(`コンテキストの取得に失敗しました: ${error.message}`);
    setStatus('', '');
  }
}

/**
 * キックオフURLの表示を更新
 */
function updateKickoffUrlDisplay(url) {
  const display = shadowRoot.querySelector('#kickoff-url-display');
  const link = shadowRoot.querySelector('#kickoff-url-link');

  if (display && link && url) {
    link.href = url;
    link.textContent = url;
    display.style.display = 'block';
  } else if (display) {
    display.style.display = 'none';
  }
}
```

### 5. Background Script実装

**ファイル**: `src/background/index.js`

**新規メッセージハンドラー**: `EXTRACT_CONTEXT_FROM_URL`

```javascript
/**
 * キックオフURLからコンテキストを抽出
 */
async function handleExtractContextFromUrl(url) {
  try {
    // 1. 新しいタブでURLを開く
    const tab = await chrome.tabs.create({
      url: url,
      active: false  // バックグラウンドで開く
    });

    // 2. タブが読み込まれるまで待つ
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // 3. Content Scriptを注入してテキストを取得
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Google Slidesのテキストを抽出
        const textElements = document.querySelectorAll('.sketchy-text-content-wrapper, [role="textbox"]');
        const texts = Array.from(textElements).map(el => el.textContent.trim()).filter(t => t);
        return texts.join('\n\n');
      }
    });

    const extractedText = result.result;

    if (!extractedText) {
      throw new Error('テキストを抽出できませんでした');
    }

    // 4. Gemini APIでコンテキストを抽出
    const context = await extractContextWithGemini(extractedText);

    // 5. タブを閉じる
    await chrome.tabs.remove(tab.id);

    return {
      success: true,
      data: context
    };

  } catch (error) {
    console.error('[Background] Extract context failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gemini APIでコンテキストを抽出
 */
async function extractContextWithGemini(text) {
  const prompt = `
以下のキックオフMTG資料から、プロジェクトのコンテキスト情報を抽出してください。

【抽出項目】
1. 目的（Purpose）: このプロジェクトで達成したいこと、解決したい課題を1-2文で簡潔に
2. 対象者（Audience）: このプロジェクトの成果物を利用する人、影響を受ける人を具体的に

【出力形式】
必ずJSON形式で出力してください：
{
  "purpose": "プロジェクトの目的",
  "audience": "対象者"
}

【資料内容】
${text}
`;

  const response = await callGeminiAPI(prompt, null);

  // JSONをパース
  try {
    // レスポンスからJSONを抽出（```json ... ``` の場合も対応）
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON形式のレスポンスが見つかりません');
    }

    const context = JSON.parse(jsonMatch[0]);
    return {
      purpose: context.purpose || '',
      audience: context.audience || ''
    };

  } catch (error) {
    console.error('[Gemini] JSON parse failed:', error);
    throw new Error('コンテキストの解析に失敗しました');
  }
}

// メッセージリスナーに追加
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTEXT_FROM_URL') {
    handleExtractContextFromUrl(message.payload.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // 非同期レスポンス
  }

  // ... 既存のハンドラー
});
```

### 6. イベントリスナー登録

**ファイル**: `src/contentScript/index.js`

**`initialize()` 関数に追加**:

```javascript
async function initialize() {
  // ... 既存の初期化処理

  // Phase 6: キックオフURL取得ボタン
  const extractKickoffBtn = shadowRoot.querySelector('#extract-from-kickoff');
  extractKickoffBtn?.addEventListener('click', handleExtractFromKickoff);

  // ... 残りの初期化処理
}
```

### 7. エラーハンドリング

#### 7.1 URLが開けない場合

```javascript
// タブの作成に失敗した場合
try {
  const tab = await chrome.tabs.create({ url });
} catch (error) {
  return {
    success: false,
    error: 'URLを開けませんでした。Google Slidesへのアクセス権限を確認してください。'
  };
}
```

#### 7.2 Gemini APIが失敗した場合

```javascript
try {
  const context = await extractContextWithGemini(text);
} catch (error) {
  return {
    success: false,
    error: 'コンテキストの抽出に失敗しました。手動で入力してください。'
  };
}
```

#### 7.3 ユーザーへのフィードバック

```javascript
// Content Script側
try {
  const context = await extractContextFromKickoffUrl(url);
} catch (error) {
  alert(`エラー: ${error.message}\n\n手動でコンテキストを入力してください。`);
  // ダイアログを閉じずに、手動入力に切り替える
}
```

## テストシナリオ

### シナリオ1: 新規プロジェクト作成時にキックオフURLを指定

1. Google Slidesを開く
2. 「+ 新規プロジェクト作成」をクリック
3. プロジェクト名: "営業資料リニューアル"
4. キックオフURL: 有効なGoogle Slides URL
5. 「作成」をクリック
6. **期待結果**:
   - ローディング表示が出る
   - 数秒後、プロジェクトが作成される
   - Contextタブで自動入力されたコンテキストを確認できる
   - キックオフURLが表示されている

### シナリオ2: 既存プロジェクトにキックオフURLを追加（空のコンテキスト）

1. プロジェクトを選択（コンテキストは空）
2. Contextタブを開く
3. 「🔗 キックオフURLから取得」をクリック
4. URLを入力して「取得」
5. **期待結果**:
   - コンテキストが自動入力される
   - キックオフURLが表示される

### シナリオ3: 既存プロジェクトにキックオフURLを追加（既存コンテキストあり）

1. プロジェクトを選択（既にコンテキストあり）
2. Contextタブを開く
3. 「🔗 キックオフURLから取得」をクリック
4. URLを入力して「取得」
5. **期待結果**:
   - 既存のコンテキストに新しい情報が追記される
   - 重複は避けられる

### シナリオ4: 無効なURLを指定

1. 「🔗 キックオフURLから取得」をクリック
2. 無効なURL（Google Slides以外）を入力
3. **期待結果**:
   - エラーメッセージが表示される
   - 「Google SlidesのURLを指定してください」

### シナリオ5: アクセス権限がないURL

1. 「🔗 キックオフURLから取得」をクリック
2. アクセス権限がないGoogle Slides URLを入力
3. **期待結果**:
   - エラーメッセージが表示される
   - 「アクセス権限を確認してください」

## 実装チェックリスト

### Phase 6-1: UI実装
- [ ] 新規プロジェクト作成ダイアログの実装
- [ ] キックオフURL入力欄の追加
- [ ] ローディング表示の実装
- [ ] Contextタブに「キックオフURLから取得」ボタン追加
- [ ] キックオフURLの表示欄追加
- [ ] CSS追加

### Phase 6-2: データ構造
- [ ] `DEFAULT_PROJECT_STRUCTURE`に`kickoffUrl`を追加

### Phase 6-3: Content Script実装
- [ ] `showCreateProjectDialog()` 実装
- [ ] `extractContextFromKickoffUrl()` 実装
- [ ] `mergeContextWithDiff()` 実装
- [ ] `createNewProject()` 更新
- [ ] `handleExtractFromKickoff()` 実装
- [ ] `updateKickoffUrlDisplay()` 実装
- [ ] イベントリスナー登録

### Phase 6-4: Background Script実装
- [ ] `handleExtractContextFromUrl()` 実装
- [ ] `extractContextWithGemini()` 実装
- [ ] メッセージハンドラー登録

### Phase 6-5: テスト
- [ ] シナリオ1: 新規作成時にキックオフURL指定
- [ ] シナリオ2: 既存プロジェクト（空）に追加
- [ ] シナリオ3: 既存プロジェクト（あり）に追加
- [ ] シナリオ4: 無効なURL
- [ ] シナリオ5: アクセス権限なし

## 次のステップ

1. Phase 6-1から順番に実装
2. 各ステップでテスト
3. エラーハンドリングを確認
4. UI/UXの微調整
5. コミットとPR作成

---

## 備考

- Google Slidesのテキスト抽出は、`.sketchy-text-content-wrapper` または `[role="textbox"]` セレクタを使用
- Gemini APIのレスポンスはJSON形式を強制するプロンプトを使用
- 既存コンテキストとのマージは、単純な文字列比較で重複をチェック
- キックオフURLは`staticContext`に保存し、後から参照可能
