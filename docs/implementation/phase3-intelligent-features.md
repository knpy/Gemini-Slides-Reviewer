# Phase 3: インテリジェント機能の実装

## 概要

タイトル類似度判定、プロジェクト紐付け確認ダイアログ、週次入力欄のステータス管理など、より高度な機能を実装する。

## 実装内容

### 1. プロジェクト自動検出機能

**ファイル**: `src/contentScript/index.js`

**関数**: `detectProjectOnLoad()`

```javascript
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
    const allProjects = await getAllProjects();

    const similarProjects = findSimilarProjects(currentTitle, allProjects);

    if (similarProjects.length > 0) {
      // 類似プロジェクトが見つかった場合、ユーザーに確認
      await showProjectLinkingDialog(presentationId, currentTitle, similarProjects);
    } else {
      // 類似プロジェクトがない場合、自動的に新規プロジェクトを作成
      console.log('[Project Detection] No similar projects found, creating new project');
      await createNewProject(presentationId, currentTitle);
    }
  } catch (error) {
    console.error('[Project Detection] Error during project detection:', error);
  }
}
```

---

### 2. 類似プロジェクト検索機能

**ファイル**: `src/contentScript/index.js`

**関数**: `findSimilarProjects(title, allProjects)`

```javascript
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
```

---

### 3. プロジェクト紐付け確認ダイアログ

**ファイル**: `src/contentScript/index.js`

**関数**: `showProjectLinkingDialog(presentationId, currentTitle, similarProjects)`

```javascript
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
      <h2>プロジェクトの紐付け</h2>
      <p>「${currentTitle}」と似た名前のプロジェクトが見つかりました。</p>
      <p>このスライドは既存のプロジェクトに関連していますか？</p>

      <div class="project-options">
        ${similarProjects.map(proj => `
          <label class="project-option">
            <input type="radio" name="project-choice" value="${proj.projectId}">
            <span>${proj.projectName}</span>
            <small>(作成日: ${new Date(proj.createdAt).toLocaleDateString('ja-JP')})</small>
          </label>
        `).join('')}
        <label class="project-option">
          <input type="radio" name="project-choice" value="new" checked>
          <span>新しいプロジェクトとして作成</span>
        </label>
      </div>

      <div class="dialog-actions">
        <button class="button secondary" id="dialog-cancel">キャンセル</button>
        <button class="button" id="dialog-confirm">確定</button>
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

      if (selectedValue === 'new') {
        // 新規プロジェクト作成
        await createNewProject(presentationId, currentTitle);
      } else {
        // 既存プロジェクトに紐付け
        await saveUrlProjectMapping(presentationId, selectedValue);
        console.log(`[Project Detection] Linked to existing project: ${selectedValue}`);
      }

      // ダイアログを閉じる
      dialog.remove();

      // UIを更新
      await updateProjectNameDisplay();
      await loadContextToUI();

      resolve();
    });

    cancelButton.addEventListener('click', () => {
      dialog.remove();
      resolve();
    });
  });
}
```

**CSS追加**:

```css
/* プロジェクト紐付けダイアログ */
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
```

---

### 4. 新規プロジェクト作成機能

**ファイル**: `src/contentScript/index.js`

**関数**: `createNewProject(presentationId, title)`

```javascript
/**
 * 新規プロジェクトを作成
 * @param {string} presentationId - プレゼンテーションID
 * @param {string} title - プロジェクト名
 * @returns {Promise<string>} - 作成されたプロジェクトID
 */
async function createNewProject(presentationId, title) {
  const projectId = generateProjectId();

  const projectData = {
    projectName: title,
    createdAt: new Date().toISOString(),
    weeklyInputDay: 1,  // デフォルト: 月曜日
    staticContext: {
      purpose: '',
      audience: ''
    },
    externalContexts: []
  };

  await saveProject(projectId, projectData);
  await saveUrlProjectMapping(presentationId, projectId);

  console.log(`[Project Manager] New project created: ${projectId} - ${title}`);

  return projectId;
}
```

---

### 5. 週次入力欄の自動生成機能

**ファイル**: `src/contentScript/index.js`

**関数**: `generateWeeklyContextIfNeeded()`

```javascript
/**
 * 週次入力欄を自動生成（必要に応じて）
 * 設定された曜日になったら、新しい入力欄を追加
 */
async function generateWeeklyContextIfNeeded() {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

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
    await saveProject(projectId, project);

    console.log('[Weekly Context] New weekly context created for', todayStr);

    // UIが表示されている場合は再描画
    if (state.isPanelVisible) {
      renderExternalContexts(project.externalContexts);
    }
  } catch (error) {
    console.error('[Weekly Context] Failed to generate weekly context:', error);
  }
}
```

---

### 6. 古い空欄の自動削除機能

**ファイル**: `src/contentScript/index.js`

**関数**: `cleanupOldPendingContexts()`

```javascript
/**
 * 3週間以上前のpending状態の入力欄を自動削除
 */
async function cleanupOldPendingContexts() {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

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
      await saveProject(projectId, project);
      console.log(`[Context Cleanup] Deleted ${deletedCount} old pending contexts`);

      // UIが表示されている場合は再描画
      if (state.isPanelVisible) {
        renderExternalContexts(project.externalContexts);
      }
    }
  } catch (error) {
    console.error('[Context Cleanup] Failed to cleanup old contexts:', error);
  }
}
```

---

### 7. 週次曜日設定の保存機能

**ファイル**: `src/contentScript/index.js`

**関数**: `saveWeeklyInputDay()`

```javascript
/**
 * 週次入力の曜日設定を保存
 */
async function saveWeeklyInputDay() {
  const weeklyDaySelect = shadowRoot.querySelector('#weekly-input-day');
  const selectedDay = parseInt(weeklyDaySelect?.value, 10);

  if (isNaN(selectedDay)) return;

  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

    project.weeklyInputDay = selectedDay;

    await saveProject(projectId, project);

    console.log(`[Gemini Slides] Weekly input day set to: ${selectedDay}`);
  } catch (error) {
    console.error('[Gemini Slides] Failed to save weekly input day:', error);
  }
}
```

**イベントリスナー追加**（`initialize()` 関数内）:

```javascript
shadowRoot.querySelector('#weekly-input-day')?.addEventListener('change', saveWeeklyInputDay);
```

---

### 8. 定期的なメンテナンス処理

**ファイル**: `src/contentScript/index.js`

**関数**: `startPeriodicMaintenance()`

```javascript
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
```

**`initialize()` 関数に追加**:

```javascript
// 定期メンテナンス開始
startPeriodicMaintenance();
```

---

### 9. プロジェクト検出の実行

**ファイル**: `src/contentScript/index.js`

**`initialize()` 関数に追加**:

```javascript
async function initialize() {
  if (shadowRoot) return;
  createPanelShell();
  await loadPrompts();
  bindUI();
  hydratePromptsUI();

  // イベントリスナーの設定
  // ... (既存のイベントリスナー)

  // タブ切り替え、コンテキスト管理
  initializeTabs();
  shadowRoot.querySelector('#save-static-context')?.addEventListener('click', saveStaticContext);
  shadowRoot.querySelector('#add-external-context')?.addEventListener('click', addExternalContext);
  shadowRoot.querySelector('#weekly-input-day')?.addEventListener('change', saveWeeklyInputDay);

  // **新規追加**: プロジェクト自動検出
  await detectProjectOnLoad();

  // プロジェクト名表示とコンテキスト読み込み
  await updateProjectNameDisplay();
  await loadContextToUI();

  // 定期メンテナンス開始
  startPeriodicMaintenance();

  // 最後に選択したプロンプトの復元
  const stored = await chrome.storage.sync.get("geminiLastPromptId");
  if (stored?.geminiLastPromptId) {
    selectPromptById(stored.geminiLastPromptId);
  } else if (state.prompts[0]) {
    selectPromptById(state.prompts[0].id);
  }
}
```

---

## 実装チェックリスト

- [ ] `detectProjectOnLoad()` の実装
- [ ] `findSimilarProjects()` の実装
- [ ] `showProjectLinkingDialog()` の実装
- [ ] ダイアログCSS の追加
- [ ] `createNewProject()` の実装
- [ ] `generateWeeklyContextIfNeeded()` の実装
- [ ] `cleanupOldPendingContexts()` の実装
- [ ] `saveWeeklyInputDay()` の実装
- [ ] `startPeriodicMaintenance()` の実装
- [ ] `initialize()` の修正（プロジェクト検出、定期メンテナンス）

---

## テストシナリオ

### シナリオ1: 類似プロジェクトの検出と紐付け
1. 既存プロジェクト「営業資料」を作成済み
2. Google Slidesで「営業資料」をコピー（新URL）
3. コピーしたスライドを開く
4. ダイアログが表示される
5. 「営業資料」を選択して「確定」
6. プロジェクト名が「営業資料」と表示される
7. コンテキストタブを開く
8. 既存のコンテキストが読み込まれている

### シナリオ2: 新規プロジェクトとして作成
1. 既存プロジェクト「営業資料」があるが、全く新しい「技術資料」を作成
2. 「技術資料」を開く
3. タイトルが類似していないため、ダイアログは表示されない
4. 自動的に新規プロジェクトが作成される

### シナリオ3: 週次入力欄の自動生成
1. プロジェクトの週次入力日を「月曜日」に設定
2. 月曜日に拡張機能を開く
3. 自動的に今日の日付の入力欄が追加される
4. 翌週の月曜日にも自動的に追加される

### シナリオ4: 古い空欄の自動削除
1. 4週間前のpending状態の入力欄を手動で作成
2. 24時間待つ（または手動で `cleanupOldPendingContexts()` を実行）
3. 古い空欄が自動的に削除される
4. 2週間前のfilled状態の入力欄は残っている

---

## 次のフェーズ

Phase 3完了後、Phase 4（レビュー統合）の実装に進む。
