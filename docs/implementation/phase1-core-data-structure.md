# Phase 1: コアデータ構造の実装

## 概要

プロジェクト管理の基盤となるデータ構造と、Chrome Storage への保存/読み込み機能を実装する。

## 実装内容

### 1. プロジェクトID生成機能

**ファイル**: `src/contentScript/index.js`

**関数**: `generateProjectId()`

```javascript
/**
 * ユニークなプロジェクトIDを生成
 * @returns {string} - 例: "proj_1a2b3c4d"
 */
function generateProjectId() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `proj_${timestamp}_${randomStr}`;
}
```

**テスト**:
```javascript
console.log(generateProjectId()); // "proj_l8x9m2_a3b4c5"
console.log(generateProjectId()); // "proj_l8x9m3_d6e7f8" (異なるID)
```

---

### 2. プレゼンテーションID抽出機能

**ファイル**: `src/contentScript/index.js`

**関数**: `extractPresentationId(url)`

```javascript
/**
 * Google SlidesのURLからプレゼンテーションIDを抽出
 * @param {string} url - Google SlidesのURL
 * @returns {string|null} - プレゼンテーションID（例: "1ABC123XYZ"）
 */
function extractPresentationId(url) {
  if (!url) return null;

  // URL形式: https://docs.google.com/presentation/d/1ABC123XYZ/edit
  const match = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
```

**テスト**:
```javascript
const url1 = "https://docs.google.com/presentation/d/1ABC123XYZ/edit#slide=id.p";
console.log(extractPresentationId(url1)); // "1ABC123XYZ"

const url2 = "https://docs.google.com/presentation/d/1ABC123XYZ_copy/edit";
console.log(extractPresentationId(url2)); // "1ABC123XYZ_copy"

const url3 = "https://example.com";
console.log(extractPresentationId(url3)); // null
```

---

### 3. プレゼンテーションタイトル取得機能

**ファイル**: `src/contentScript/index.js`

**関数**: `getPresentationTitle()`

```javascript
/**
 * 現在開いているGoogle Slidesのタイトルを取得
 * @returns {string} - プレゼンテーションのタイトル
 */
function getPresentationTitle() {
  // 優先順位1: .docs-title-input の value
  const titleInput = document.querySelector('.docs-title-input');
  if (titleInput?.value) {
    return titleInput.value.trim();
  }

  // 優先順位2: document.title から " - Google スライド" を削除
  const docTitle = document.title.replace(/\s*-\s*Google\s*(スライド|Slides)\s*$/, '');
  if (docTitle && docTitle !== document.title) {
    return docTitle.trim();
  }

  // 優先順位3: メタタグの og:title
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  if (ogTitle) {
    return ogTitle.trim();
  }

  // フォールバック
  return '無題のプレゼンテーション';
}
```

**テスト**:
```javascript
// Google Slides上で実行
console.log(getPresentationTitle()); // "2025年Q1営業資料"
```

---

### 4. タイトル類似度判定機能

**ファイル**: `src/contentScript/index.js`

**関数**: `isSimilarTitle(title1, title2)`

```javascript
/**
 * 2つのタイトルが類似しているかを前方一致で判定
 * @param {string} title1 - タイトル1
 * @param {string} title2 - タイトル2
 * @returns {boolean} - 類似している場合true
 */
function isSimilarTitle(title1, title2) {
  if (!title1 || !title2) return false;

  const normalized1 = title1.trim().toLowerCase();
  const normalized2 = title2.trim().toLowerCase();

  // どちらかがもう一方の前方一致
  return normalized1.startsWith(normalized2) ||
         normalized2.startsWith(normalized1);
}
```

**テスト**:
```javascript
console.log(isSimilarTitle("営業資料", "営業資料_コピー")); // true
console.log(isSimilarTitle("営業資料_コピー", "営業資料")); // true
console.log(isSimilarTitle("営業資料", "技術資料")); // false
console.log(isSimilarTitle("Sales Deck", "sales deck 2025")); // true (大文字小文字無視)
```

---

### 5. データ構造定義

**ファイル**: `src/contentScript/index.js`

**定数**: データ構造のキー定義

```javascript
const STORAGE_KEYS = {
  PROJECTS: 'gemini_projects',           // プロジェクト本体
  URL_PROJECT_MAP: 'gemini_url_project_map'  // URL→プロジェクトIDのマッピング
};

const DEFAULT_PROJECT_STRUCTURE = {
  projectName: '',
  createdAt: null,
  weeklyInputDay: 1,  // デフォルト: 月曜日 (0=日曜, 1=月曜, ..., 6=土曜)
  staticContext: {
    purpose: '',
    audience: ''
  },
  externalContexts: []
};
```

---

### 6. Chrome Storage 保存機能

**ファイル**: `src/contentScript/index.js`

**関数**: `saveProject(projectId, projectData)`

```javascript
/**
 * プロジェクトデータをChrome Storageに保存
 * @param {string} projectId - プロジェクトID
 * @param {object} projectData - プロジェクトデータ
 * @returns {Promise<void>}
 */
async function saveProject(projectId, projectData) {
  try {
    // 既存のプロジェクト一覧を取得
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PROJECTS);
    const projects = stored[STORAGE_KEYS.PROJECTS] || {};

    // 新しいプロジェクトを追加/更新
    projects[projectId] = {
      ...DEFAULT_PROJECT_STRUCTURE,
      ...projectData,
      updatedAt: new Date().toISOString()
    };

    // 保存
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

### 7. Chrome Storage 読み込み機能

**ファイル**: `src/contentScript/index.js`

**関数**: `loadProject(projectId)`

```javascript
/**
 * プロジェクトデータをChrome Storageから読み込み
 * @param {string} projectId - プロジェクトID
 * @returns {Promise<object|null>} - プロジェクトデータ、存在しない場合null
 */
async function loadProject(projectId) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PROJECTS);
    const projects = stored[STORAGE_KEYS.PROJECTS] || {};

    return projects[projectId] || null;
  } catch (error) {
    console.error('[Project Manager] Failed to load project:', error);
    return null;
  }
}
```

---

### 8. URL→プロジェクトID マッピング保存

**ファイル**: `src/contentScript/index.js`

**関数**: `saveUrlProjectMapping(presentationId, projectId)`

```javascript
/**
 * URL（プレゼンテーションID）とプロジェクトIDのマッピングを保存
 * @param {string} presentationId - プレゼンテーションID
 * @param {string} projectId - プロジェクトID
 * @returns {Promise<void>}
 */
async function saveUrlProjectMapping(presentationId, projectId) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.URL_PROJECT_MAP);
    const urlProjectMap = stored[STORAGE_KEYS.URL_PROJECT_MAP] || {};

    // マッピングを追加
    urlProjectMap[presentationId] = projectId;

    // 保存
    await chrome.storage.local.set({
      [STORAGE_KEYS.URL_PROJECT_MAP]: urlProjectMap
    });

    console.log(`[Project Manager] URL mapping saved: ${presentationId} -> ${projectId}`);
  } catch (error) {
    console.error('[Project Manager] Failed to save URL mapping:', error);
    throw error;
  }
}
```

---

### 9. URL→プロジェクトID マッピング読み込み

**ファイル**: `src/contentScript/index.js`

**関数**: `getProjectIdByUrl(presentationId)`

```javascript
/**
 * プレゼンテーションIDからプロジェクトIDを取得
 * @param {string} presentationId - プレゼンテーションID
 * @returns {Promise<string|null>} - プロジェクトID、存在しない場合null
 */
async function getProjectIdByUrl(presentationId) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.URL_PROJECT_MAP);
    const urlProjectMap = stored[STORAGE_KEYS.URL_PROJECT_MAP] || {};

    return urlProjectMap[presentationId] || null;
  } catch (error) {
    console.error('[Project Manager] Failed to get project ID by URL:', error);
    return null;
  }
}
```

---

### 10. 全プロジェクト取得機能

**ファイル**: `src/contentScript/index.js`

**関数**: `getAllProjects()`

```javascript
/**
 * すべてのプロジェクトを取得（タイトル類似度判定用）
 * @returns {Promise<object>} - プロジェクトID→プロジェクトデータのマップ
 */
async function getAllProjects() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PROJECTS);
    return stored[STORAGE_KEYS.PROJECTS] || {};
  } catch (error) {
    console.error('[Project Manager] Failed to get all projects:', error);
    return {};
  }
}
```

---

## 実装チェックリスト

- [ ] `generateProjectId()` の実装
- [ ] `extractPresentationId()` の実装とテスト
- [ ] `getPresentationTitle()` の実装とテスト
- [ ] `isSimilarTitle()` の実装とテスト
- [ ] データ構造定数の定義
- [ ] `saveProject()` の実装
- [ ] `loadProject()` の実装
- [ ] `saveUrlProjectMapping()` の実装
- [ ] `getProjectIdByUrl()` の実装
- [ ] `getAllProjects()` の実装

---

## テストシナリオ

### シナリオ1: 新規プロジェクト作成
```javascript
// 1. プロジェクトID生成
const projectId = generateProjectId();

// 2. プロジェクトデータ作成
const projectData = {
  projectName: "2025年Q1営業資料",
  createdAt: new Date().toISOString(),
  staticContext: {
    purpose: "新規顧客向けの製品紹介",
    audience: "技術者ではない経営層"
  }
};

// 3. 保存
await saveProject(projectId, projectData);

// 4. URL マッピング保存
const presentationId = extractPresentationId(window.location.href);
await saveUrlProjectMapping(presentationId, projectId);

// 5. 読み込み確認
const loaded = await loadProject(projectId);
console.log(loaded); // projectData と同じ内容
```

### シナリオ2: 既存プロジェクトの特定
```javascript
// 1. 現在のURL からプレゼンテーションID取得
const presentationId = extractPresentationId(window.location.href);

// 2. プロジェクトID取得
const projectId = await getProjectIdByUrl(presentationId);

if (projectId) {
  // 3. プロジェクトデータ読み込み
  const project = await loadProject(projectId);
  console.log('既存プロジェクト:', project.projectName);
} else {
  console.log('新規プロジェクト');
}
```

### シナリオ3: タイトル類似度チェック
```javascript
// 1. 現在のタイトル取得
const currentTitle = getPresentationTitle();

// 2. すべてのプロジェクト取得
const allProjects = await getAllProjects();

// 3. 類似プロジェクトを探す
const similarProjects = Object.entries(allProjects).filter(([id, project]) => {
  return isSimilarTitle(currentTitle, project.projectName);
});

if (similarProjects.length > 0) {
  console.log('類似プロジェクトが見つかりました:', similarProjects);
  // ユーザーに確認ダイアログを表示（Phase 3で実装）
}
```

---

## 次のフェーズ

Phase 1完了後、Phase 2（UI基盤）の実装に進む。
