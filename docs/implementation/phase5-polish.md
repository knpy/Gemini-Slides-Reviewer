# Phase 5: 快適性向上の実装

## 概要

入力リマインダー、エラーハンドリングの改善、パフォーマンス最適化など、ユーザー体験を向上させる機能を実装する。

## 実装内容

### 1. 入力リマインダー機能

**ファイル**: `src/contentScript/index.js`

**関数**: `showWeeklyInputReminder()`

```javascript
/**
 * 週次入力が未入力の場合、リマインダーを表示
 */
async function showWeeklyInputReminder() {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

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
  const reminder = shadowRoot.querySelector('#reminder-notification');
  if (!reminder) {
    // リマインダー要素を作成
    const element = document.createElement('div');
    element.id = 'reminder-notification';
    element.className = 'reminder-notification';
    element.innerHTML = `
      <div class="reminder-content">
        <span class="reminder-icon">⏰</span>
        <span class="reminder-text">${date} のコンテキスト入力がまだです</span>
        <button class="reminder-action">入力する</button>
        <button class="reminder-dismiss">×</button>
      </div>
    `;

    shadowRoot.querySelector('.gemini-panel')?.appendChild(element);

    // イベントリスナー
    element.querySelector('.reminder-action')?.addEventListener('click', () => {
      switchTab('context');
      element.remove();
    });

    element.querySelector('.reminder-dismiss')?.addEventListener('click', () => {
      element.remove();
    });
  }
}
```

**CSS追加**:

```css
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
```

**`initialize()` に追加**:

```javascript
// 入力リマインダーチェック
await showWeeklyInputReminder();
```

---

### 2. エラーハンドリングの改善

**ファイル**: `src/contentScript/index.js`

**関数**: `handleError(error, context)`

```javascript
/**
 * エラーハンドリングを統一
 * @param {Error} error - エラーオブジェクト
 * @param {string} context - エラーが発生したコンテキスト（例: "レビュー実行中"）
 */
function handleError(error, context = '') {
  console.error(`[Gemini Slides] Error${context ? ` in ${context}` : ''}:`, error);

  let userMessage = '';

  if (error.message?.includes('Extension context invalidated')) {
    userMessage = '拡張機能が再読み込みされました。ページを更新してください。';
  } else if (error.message?.includes('API key')) {
    userMessage = 'APIキーが設定されていません。拡張機能のオプションで設定してください。';
  } else if (error.message?.includes('Network')) {
    userMessage = 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
  } else if (error.message?.includes('quota')) {
    userMessage = 'APIの利用制限に達しました。しばらく待ってから再試行してください。';
  } else {
    userMessage = `エラーが発生しました: ${error.message}`;
  }

  setStatus(userMessage, 'error');
}
```

**使用例**（既存のtry-catchを修正）:

```javascript
async function handleRunCheck() {
  // ... (省略)
  try {
    // ... (処理)
  } catch (error) {
    handleError(error, 'レビュー実行');
  } finally {
    state.ui.runButton.disabled = false;
  }
}
```

---

### 3. ローディング状態の改善

**ファイル**: `src/contentScript/index.js`

プロジェクト読み込み中の表示を改善。

**関数**: `setLoadingState(isLoading, message = '')`

```javascript
/**
 * ローディング状態を設定
 * @param {boolean} isLoading - ローディング中かどうか
 * @param {string} message - 表示メッセージ
 */
function setLoadingState(isLoading, message = 'Loading...') {
  const panel = shadowRoot.querySelector('.gemini-panel');
  if (!panel) return;

  if (isLoading) {
    panel.classList.add('loading');
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-content">
        <div class="spinner"></div>
        <p>${message}</p>
      </div>
    `;
    panel.appendChild(overlay);
  } else {
    panel.classList.remove('loading');
    const overlay = panel.querySelector('.loading-overlay');
    overlay?.remove();
  }
}
```

**CSS追加**:

```css
.gemini-panel.loading {
  pointer-events: none;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(32, 33, 36, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.loading-content {
  text-align: center;
}

.loading-content p {
  margin-top: 16px;
  color: #9aa0a6;
  font-size: 13px;
}
```

**`initialize()` で使用**:

```javascript
async function initialize() {
  if (shadowRoot) return;

  setLoadingState(true, 'プロジェクトを読み込んでいます...');

  createPanelShell();
  await loadPrompts();
  // ... (他の初期化処理)

  setLoadingState(false);
}
```

---

### 4. データサイズ最適化

**ファイル**: `src/contentScript/index.js`

**関数**: `compressExternalContexts(contexts)`

```javascript
/**
 * 外部コンテキストを圧縮（古いfilled以外のデータを削除）
 * @param {Array} contexts - 外部コンテキストの配列
 * @returns {Array} - 圧縮されたコンテキスト配列
 */
function compressExternalContexts(contexts) {
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
```

**`saveProject()` を修正**:

```javascript
async function saveProject(projectId, projectData) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PROJECTS);
    const projects = stored[STORAGE_KEYS.PROJECTS] || {};

    // 外部コンテキストを圧縮
    if (projectData.externalContexts) {
      projectData.externalContexts = compressExternalContexts(projectData.externalContexts);
    }

    projects[projectId] = {
      ...DEFAULT_PROJECT_STRUCTURE,
      ...projectData,
      updatedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.PROJECTS]: projects
    });

    console.log(`[Project Manager] Project saved: ${projectId}`);
  } catch (error) {
    console.error('[Project Manager] Failed to save project:', error);
    throw error;
  }
}
```

---

### 5. キーボードショートカット

**ファイル**: `src/contentScript/index.js`

**関数**: `initializeKeyboardShortcuts()`

```javascript
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
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
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
```

**`initialize()` に追加**:

```javascript
// キーボードショートカット
initializeKeyboardShortcuts();
```

---

### 6. ストレージ使用状況の表示

**ファイル**: `src/contentScript/index.js`

**HTML追加**（コンテキストタブの最下部）:

```html
<div class="storage-info" id="storage-info">
  <small>ストレージ使用量: 計算中...</small>
</div>
```

**CSS追加**:

```css
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
```

**関数**: `updateStorageInfo()`

```javascript
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
      <small>ストレージ使用量: ${mbUsed} MB / 10 MB (${percentUsed}%)</small>
    `;
  } catch (error) {
    console.error('[Storage Info] Failed to calculate storage usage:', error);
    storageInfo.innerHTML = '<small>ストレージ使用量: 計算エラー</small>';
  }
}
```

**コンテキスト保存時に更新**:

```javascript
await updateStorageInfo();
```

---

### 7. デバッグモード

**ファイル**: `src/contentScript/index.js`

**関数**: `enableDebugMode()`

```javascript
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
      const projectId = await getCurrentOrCreateProjectId();
      return await loadProject(projectId);
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

// URLパラメータに ?debug=true があれば自動有効化
if (window.location.search.includes('debug=true')) {
  enableDebugMode();
}
```

---

### 8. パフォーマンス最適化

**ファイル**: `src/contentScript/index.js`

**関数**: デバウンス処理

```javascript
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

// テキストエリアの入力イベントにデバウンスを適用
const debouncedUpdatePreview = debounce(updateContextPreview, 500);
```

**使用例**:

```javascript
// コンテキスト入力欄にリアルタイムプレビュー（デバウンス付き）
shadowRoot.querySelector('#context-purpose')?.addEventListener('input', debouncedUpdatePreview);
shadowRoot.querySelector('#context-audience')?.addEventListener('input', debouncedUpdatePreview);
```

---

### 9. エクスポート機能（オプション）

**ファイル**: `src/contentScript/index.js`

**関数**: `exportProjectData()`

```javascript
/**
 * プロジェクトデータをJSON形式でエクスポート
 */
async function exportProjectData() {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

    if (!project) {
      setStatus('プロジェクトが見つかりません', 'error');
      return;
    }

    const dataStr = JSON.stringify(project, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName}_context_${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);

    setStatus('プロジェクトデータをエクスポートしました', 'success');
  } catch (error) {
    console.error('[Export] Failed to export project data:', error);
    setStatus('エクスポートに失敗しました', 'error');
  }
}
```

**HTML追加**（コンテキストタブの下部）:

```html
<button class="button secondary" id="export-project">プロジェクトデータをエクスポート</button>
```

**イベントリスナー追加**:

```javascript
shadowRoot.querySelector('#export-project')?.addEventListener('click', exportProjectData);
```

---

## 実装チェックリスト

- [ ] `showWeeklyInputReminder()` の実装
- [ ] `showReminderNotification()` の実装
- [ ] リマインダーCSS の追加
- [ ] `handleError()` の実装と既存エラー処理の置き換え
- [ ] `setLoadingState()` の実装
- [ ] ローディングCSS の追加
- [ ] `compressExternalContexts()` の実装
- [ ] `saveProject()` の修正（圧縮処理追加）
- [ ] `initializeKeyboardShortcuts()` の実装
- [ ] `updateStorageInfo()` の実装とHTML/CSS追加
- [ ] `enableDebugMode()` の実装
- [ ] `debounce()` の実装と適用
- [ ] `exportProjectData()` の実装（オプション）

---

## テストシナリオ

### シナリオ1: 入力リマインダー
1. プロジェクトを作成
2. 週次入力欄を追加（3日以上前の日付で）
3. 内容を空のまま保存
4. パネルを開く
5. リマインダー通知が表示される
6. 「入力する」をクリック
7. コンテキストタブに移動する

### シナリオ2: キーボードショートカット
1. Ctrl+Shift+G でパネルを開く
2. Ctrl+Enter で単一スライドレビュー実行
3. Ctrl+Shift+Enter で全スライドレビュー実行

### シナリオ3: ストレージ使用状況
1. コンテキストタブを開く
2. 下部にストレージ使用量が表示される
3. 複数のプロジェクトを作成
4. 使用量が増加する

### シナリオ4: エクスポート
1. プロジェクトのコンテキストを入力
2. 「プロジェクトデータをエクスポート」ボタンをクリック
3. JSONファイルがダウンロードされる
4. ファイルを開いてデータを確認

---

## 完成

Phase 5の実装により、すべてのMVP機能が完成します。

### 最終チェック項目

- [ ] すべてのPhaseの実装が完了
- [ ] エラーハンドリングが適切
- [ ] パフォーマンスが良好
- [ ] UIが使いやすい
- [ ] データの永続化が正常に動作
- [ ] コンテキストが正しくGeminiに送信される
- [ ] ドキュメントが最新

---

## 次のステップ

1. 実装開始（Phase 1から順番に）
2. 各Phaseごとにテストとコミット
3. 全Phase完了後、統合テスト
4. PR作成とレビュー
5. ユーザーフィードバック収集
6. 将来の拡張機能の検討
