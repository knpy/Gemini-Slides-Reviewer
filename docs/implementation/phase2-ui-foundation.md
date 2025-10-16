# Phase 2: UI基盤の実装

## 概要

タブ切り替え式のUIを実装し、コンテキスト入力機能を追加する。

## 実装内容

### 1. タブ切り替えUI構造

**ファイル**: `src/contentScript/index.js`

**HTML構造**（Shadow DOM内）:

```html
<section class="gemini-panel" role="complementary">
  <header>
    <h1>Gemini Slides Reviewer</h1>
    <!-- プロジェクト名表示を追加 -->
    <div class="project-name" id="gemini-project-name">プロジェクト: 読み込み中...</div>
    <button type="button" aria-label="Close panel">×</button>
  </header>

  <!-- タブナビゲーション -->
  <nav class="tab-navigation">
    <button class="tab-button active" data-tab="review">レビュー</button>
    <button class="tab-button" data-tab="context">コンテキスト</button>
  </nav>

  <main>
    <!-- レビュータブの内容（既存のUI） -->
    <div class="tab-content active" id="tab-review">
      <!-- 既存のプロンプト選択、実行ボタンなど -->
    </div>

    <!-- コンテキストタブの内容（新規） -->
    <div class="tab-content" id="tab-context">
      <!-- 静的コンテキスト入力欄 -->
      <section class="context-section">
        <h3>プロジェクトコンテキスト</h3>

        <div class="field">
          <label for="context-purpose">目的</label>
          <textarea id="context-purpose" rows="3" placeholder="例：新規顧客向けの製品紹介"></textarea>
        </div>

        <div class="field">
          <label for="context-audience">対象者</label>
          <textarea id="context-audience" rows="2" placeholder="例：技術者ではない経営層"></textarea>
        </div>

        <button class="button" id="save-static-context">保存</button>
      </section>

      <!-- 外部コンテキスト入力欄 -->
      <section class="context-section">
        <h3>外部コンテキスト（週次入力）</h3>

        <div class="field">
          <label>週次入力の曜日</label>
          <select id="weekly-input-day">
            <option value="0">日曜日</option>
            <option value="1" selected>月曜日</option>
            <option value="2">火曜日</option>
            <option value="3">水曜日</option>
            <option value="4">木曜日</option>
            <option value="5">金曜日</option>
            <option value="6">土曜日</option>
          </select>
        </div>

        <!-- 週次入力欄のリスト -->
        <div id="external-contexts-list">
          <!-- 動的に生成される -->
        </div>

        <button class="button secondary" id="add-external-context">新しい入力欄を追加</button>
      </section>
    </div>
  </main>
</section>
```

---

### 2. CSS追加

**ファイル**: `src/contentScript/index.js` の `<style>` タグ内

```css
/* プロジェクト名表示 */
.project-name {
  font-size: 11px;
  color: #9aa0a6;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* タブナビゲーション */
.tab-navigation {
  display: flex;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  background: #2d2e30;
}

.tab-button {
  flex: 1;
  background: transparent;
  border: none;
  color: #9aa0a6;
  padding: 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-button:hover {
  color: #e8eaed;
  background: rgba(255,255,255,0.04);
}

.tab-button.active {
  color: #8ab4f8;
  border-bottom-color: #8ab4f8;
}

/* タブコンテンツ */
.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

/* コンテキストセクション */
.context-section {
  margin-bottom: 24px;
  padding: 16px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.05);
}

.context-section h3 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: #e8eaed;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* 外部コンテキストカード */
.external-context-card {
  background: #2d2e30;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}

.external-context-card .context-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.external-context-card .context-date {
  font-size: 12px;
  color: #9aa0a6;
  font-weight: 500;
}

.external-context-card .context-status {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.context-status.filled {
  background: rgba(52, 168, 83, 0.2);
  color: #81c995;
}

.context-status.pending {
  background: rgba(251, 188, 4, 0.2);
  color: #fdd663;
}

.external-context-card textarea {
  margin-bottom: 8px;
}

.external-context-card .card-actions {
  display: flex;
  gap: 8px;
}

.external-context-card .card-actions button {
  flex: 1;
  padding: 6px;
  font-size: 12px;
}
```

---

### 3. タブ切り替え機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * タブ切り替えの初期化
 */
function initializeTabs() {
  const tabButtons = shadowRoot.querySelectorAll('.tab-button');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      switchTab(targetTab);
    });
  });
}

/**
 * 指定されたタブに切り替え
 * @param {string} tabName - タブ名（'review' or 'context'）
 */
function switchTab(tabName) {
  // タブボタンのアクティブ状態を更新
  shadowRoot.querySelectorAll('.tab-button').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // タブコンテンツの表示/非表示を切り替え
  shadowRoot.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  console.log(`[Gemini Slides] Switched to ${tabName} tab`);
}
```

---

### 4. プロジェクト名表示機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 現在のプロジェクト名を取得してUIに表示
 */
async function updateProjectNameDisplay() {
  const projectNameElement = shadowRoot.querySelector('#gemini-project-name');
  if (!projectNameElement) return;

  try {
    // プレゼンテーションIDを取得
    const presentationId = extractPresentationId(window.location.href);
    if (!presentationId) {
      projectNameElement.textContent = 'プロジェクト: 不明';
      return;
    }

    // プロジェクトIDを取得
    const projectId = await getProjectIdByUrl(presentationId);

    if (projectId) {
      // 既存プロジェクト
      const project = await loadProject(projectId);
      projectNameElement.textContent = `プロジェクト: ${project.projectName}`;
    } else {
      // 新規プロジェクト
      const title = getPresentationTitle();
      projectNameElement.textContent = `プロジェクト: ${title} (新規)`;
    }
  } catch (error) {
    console.error('[Gemini Slides] Failed to update project name:', error);
    projectNameElement.textContent = 'プロジェクト: エラー';
  }
}
```

---

### 5. 静的コンテキスト保存機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 静的コンテキスト（目的、対象者）を保存
 */
async function saveStaticContext() {
  const purposeTextarea = shadowRoot.querySelector('#context-purpose');
  const audienceTextarea = shadowRoot.querySelector('#context-audience');

  const purpose = purposeTextarea?.value.trim() || '';
  const audience = audienceTextarea?.value.trim() || '';

  try {
    // 現在のプロジェクトIDを取得または作成
    const projectId = await getCurrentOrCreateProjectId();

    // プロジェクトを読み込み
    const project = await loadProject(projectId);

    // 静的コンテキストを更新
    project.staticContext = {
      purpose,
      audience
    };

    // 保存
    await saveProject(projectId, project);

    setStatus('コンテキストを保存しました', 'success');
    console.log('[Gemini Slides] Static context saved');
  } catch (error) {
    console.error('[Gemini Slides] Failed to save static context:', error);
    setStatus('保存に失敗しました: ' + error.message, 'error');
  }
}
```

---

### 6. プロジェクトID取得または作成機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 現在のプレゼンテーションに紐付くプロジェクトIDを取得、
 * 存在しない場合は新規作成
 * @returns {Promise<string>} - プロジェクトID
 */
async function getCurrentOrCreateProjectId() {
  const presentationId = extractPresentationId(window.location.href);
  if (!presentationId) {
    throw new Error('プレゼンテーションIDを取得できませんでした');
  }

  // 既存のマッピングを確認
  let projectId = await getProjectIdByUrl(presentationId);

  if (!projectId) {
    // 新規プロジェクト作成
    projectId = generateProjectId();
    const title = getPresentationTitle();

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

    console.log(`[Gemini Slides] New project created: ${projectId}`);
  }

  return projectId;
}
```

---

### 7. コンテキスト読み込み機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * プロジェクトのコンテキストをUIに読み込み
 */
async function loadContextToUI() {
  try {
    const presentationId = extractPresentationId(window.location.href);
    if (!presentationId) return;

    const projectId = await getProjectIdByUrl(presentationId);
    if (!projectId) {
      console.log('[Gemini Slides] No existing project found');
      return;
    }

    const project = await loadProject(projectId);
    if (!project) return;

    // 静的コンテキストを入力欄に反映
    const purposeTextarea = shadowRoot.querySelector('#context-purpose');
    const audienceTextarea = shadowRoot.querySelector('#context-audience');
    const weeklyDaySelect = shadowRoot.querySelector('#weekly-input-day');

    if (purposeTextarea) purposeTextarea.value = project.staticContext.purpose || '';
    if (audienceTextarea) audienceTextarea.value = project.staticContext.audience || '';
    if (weeklyDaySelect) weeklyDaySelect.value = project.weeklyInputDay || 1;

    // 外部コンテキストを描画
    renderExternalContexts(project.externalContexts || []);

    console.log('[Gemini Slides] Context loaded to UI');
  } catch (error) {
    console.error('[Gemini Slides] Failed to load context to UI:', error);
  }
}
```

---

### 8. 外部コンテキスト描画機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 外部コンテキストのリストを描画
 * @param {Array} externalContexts - 外部コンテキストの配列
 */
function renderExternalContexts(externalContexts) {
  const listContainer = shadowRoot.querySelector('#external-contexts-list');
  if (!listContainer) return;

  // 日付の新しい順にソート
  const sorted = [...externalContexts].sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  listContainer.innerHTML = '';

  sorted.forEach(context => {
    const card = createExternalContextCard(context);
    listContainer.appendChild(card);
  });

  if (sorted.length === 0) {
    listContainer.innerHTML = '<p style="color: #9aa0a6; font-size: 12px; text-align: center;">まだ外部コンテキストがありません</p>';
  }
}

/**
 * 外部コンテキストカードのHTML要素を作成
 * @param {object} context - 外部コンテキストデータ
 * @returns {HTMLElement} - カード要素
 */
function createExternalContextCard(context) {
  const card = document.createElement('div');
  card.className = 'external-context-card';
  card.dataset.contextId = context.id;

  const statusClass = context.status === 'filled' ? 'filled' : 'pending';
  const statusText = context.status === 'filled' ? '入力済み' : '未入力';

  card.innerHTML = `
    <div class="context-header">
      <span class="context-date">${context.date}</span>
      <span class="context-status ${statusClass}">${statusText}</span>
    </div>
    <textarea rows="4" placeholder="議事録や会議での指摘事項など...">${context.content || ''}</textarea>
    <div class="card-actions">
      <button class="button" data-action="save">保存</button>
      <button class="button danger" data-action="delete">削除</button>
    </div>
  `;

  // イベントリスナーを追加
  const saveButton = card.querySelector('[data-action="save"]');
  const deleteButton = card.querySelector('[data-action="delete"]');
  const textarea = card.querySelector('textarea');

  saveButton.addEventListener('click', () => saveExternalContext(context.id, textarea.value));
  deleteButton.addEventListener('click', () => deleteExternalContext(context.id));

  return card;
}
```

---

### 9. 外部コンテキスト保存機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 外部コンテキストを保存
 * @param {string} contextId - コンテキストID
 * @param {string} content - 入力内容
 */
async function saveExternalContext(contextId, content) {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

    // 対象のコンテキストを探して更新
    const context = project.externalContexts.find(c => c.id === contextId);
    if (context) {
      context.content = content.trim();
      context.status = content.trim() ? 'filled' : 'pending';
    }

    await saveProject(projectId, project);

    // UI再描画
    renderExternalContexts(project.externalContexts);

    setStatus('外部コンテキストを保存しました', 'success');
  } catch (error) {
    console.error('[Gemini Slides] Failed to save external context:', error);
    setStatus('保存に失敗しました', 'error');
  }
}
```

---

### 10. 外部コンテキスト追加機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 新しい外部コンテキスト入力欄を追加
 */
async function addExternalContext() {
  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

    // 新しいコンテキストを作成
    const newContext = {
      id: `ctx_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],  // YYYY-MM-DD
      content: '',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    project.externalContexts.push(newContext);

    await saveProject(projectId, project);

    // UI再描画
    renderExternalContexts(project.externalContexts);

    setStatus('新しい入力欄を追加しました', 'success');
  } catch (error) {
    console.error('[Gemini Slides] Failed to add external context:', error);
    setStatus('追加に失敗しました', 'error');
  }
}
```

---

### 11. 外部コンテキスト削除機能

**ファイル**: `src/contentScript/index.js`

```javascript
/**
 * 外部コンテキストを削除
 * @param {string} contextId - コンテキストID
 */
async function deleteExternalContext(contextId) {
  if (!confirm('この入力欄を削除してもよろしいですか？')) {
    return;
  }

  try {
    const projectId = await getCurrentOrCreateProjectId();
    const project = await loadProject(projectId);

    // 対象のコンテキストを削除
    project.externalContexts = project.externalContexts.filter(c => c.id !== contextId);

    await saveProject(projectId, project);

    // UI再描画
    renderExternalContexts(project.externalContexts);

    setStatus('外部コンテキストを削除しました', 'success');
  } catch (error) {
    console.error('[Gemini Slides] Failed to delete external context:', error);
    setStatus('削除に失敗しました', 'error');
  }
}
```

---

### 12. 初期化処理の修正

**ファイル**: `src/contentScript/index.js` の `initialize()` 関数

```javascript
async function initialize() {
  if (shadowRoot) return;
  createPanelShell();
  await loadPrompts();
  bindUI();
  hydratePromptsUI();

  // イベントリスナーの設定
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

  // **新規追加**: タブ切り替え、コンテキスト管理
  initializeTabs();
  shadowRoot.querySelector('#save-static-context')?.addEventListener('click', saveStaticContext);
  shadowRoot.querySelector('#add-external-context')?.addEventListener('click', addExternalContext);

  // **新規追加**: プロジェクト名表示とコンテキスト読み込み
  await updateProjectNameDisplay();
  await loadContextToUI();

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

- [ ] HTML構造の追加（タブナビゲーション、コンテキスト入力欄）
- [ ] CSS追加（タブUI、コンテキストカード）
- [ ] `initializeTabs()` の実装
- [ ] `switchTab()` の実装
- [ ] `updateProjectNameDisplay()` の実装
- [ ] `saveStaticContext()` の実装
- [ ] `getCurrentOrCreateProjectId()` の実装
- [ ] `loadContextToUI()` の実装
- [ ] `renderExternalContexts()` の実装
- [ ] `createExternalContextCard()` の実装
- [ ] `saveExternalContext()` の実装
- [ ] `addExternalContext()` の実装
- [ ] `deleteExternalContext()` の実装
- [ ] `initialize()` の修正

---

## テストシナリオ

### シナリオ1: タブ切り替え
1. パネルを開く
2. 「コンテキスト」タブをクリック
3. コンテキスト入力欄が表示される
4. 「レビュー」タブに戻る
5. プロンプト選択画面が表示される

### シナリオ2: 静的コンテキストの保存
1. 「コンテキスト」タブを開く
2. 目的欄に「新規顧客向けの製品紹介」と入力
3. 対象者欄に「経営層」と入力
4. 「保存」ボタンをクリック
5. 成功メッセージが表示される
6. ページをリロード
7. 入力内容が保持されている

### シナリオ3: 外部コンテキストの追加・保存
1. 「コンテキスト」タブを開く
2. 「新しい入力欄を追加」ボタンをクリック
3. 新しいカードが表示される
4. テキストエリアに「キックオフ議事録」と入力
5. 「保存」ボタンをクリック
6. ステータスが「入力済み」に変わる

---

## 次のフェーズ

Phase 2完了後、Phase 3（インテリジェント機能）の実装に進む。
