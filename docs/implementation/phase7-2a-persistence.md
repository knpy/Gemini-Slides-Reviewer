# Phase 7-2A: 永続化機能

## 概要

ピンとフィードバックアイテムを `chrome.storage.local` に保存し、ページリロード後も復元できるようにする機能。

## 実装内容

### 1. ストレージ関数

#### `savePinsToStorage(presentationId, pinsBySlide)`
- ピンデータをストレージに保存
- キー: `pins:${presentationId}`
- データ構造:
  ```json
  {
    "version": "1.0",
    "presentationId": "abc123",
    "lastModified": "2025-10-18T10:00:00Z",
    "pins": {
      "1": [{ pinId, feedbackId, slidePage, position, rect, ... }],
      "2": [...]
    }
  }
  ```

#### `loadPinsFromStorage(presentationId)`
- ストレージからピンデータを読み込み
- データが存在しない場合は空のオブジェクト `{}` を返す

#### `saveFeedbackToStorage(presentationId, feedbackItems)`
- フィードバックアイテムをストレージに保存
- キー: `feedback:${presentationId}`
- データ構造:
  ```json
  {
    "version": "1.0",
    "items": [{ id, title, summary, anchors, ... }],
    "lastModified": "2025-10-18T10:00:00Z"
  }
  ```

#### `loadFeedbackFromStorage(presentationId)`
- ストレージからフィードバックアイテムを読み込み
- データが存在しない場合は空の配列 `[]` を返す

### 2. 自動保存

#### `regeneratePinsFromFeedback()`
- AI レビュー完了後、自動的にストレージに保存
- `savePinsToStorage()` と `saveFeedbackToStorage()` を呼び出し

### 3. 復元ロジック

#### `initializePinFeature()`
- 拡張機能初期化時にストレージから復元
- ストレージにデータがある場合:
  - `state.pinsBySlide` と `state.feedbackItems` を復元
  - `restoredFromStorage = true` を設定
  - UI を更新
- ストレージにデータがない場合:
  - 既存の初期化ロジック（モックデータまたは空の状態）

## テスト手順

### 1. 基本的な保存と復元

1. Google Slides を開く
2. AI レビューを実行してピンを生成
3. コンソールで以下を確認:
   ```
   [Pins] Saved to storage: pins:abc123 Total slides: 3
   [Feedback] Saved to storage: feedback:abc123 Total items: 4
   ```
4. ページをリロード
5. コンソールで以下を確認:
   ```
   [Pins] Loaded from storage: pins:abc123 Last modified: 2025-10-18T10:00:00Z
   [Pins] Restored from storage: 3 slides
   [Feedback] Loaded from storage: feedback:abc123 Last modified: 2025-10-18T10:00:00Z
   [Feedback] Restored from storage: 4 items
   ```
6. ピンとフィードバックリストが復元されていることを確認

### 2. ストレージの確認

コンソールで以下を実行:
```javascript
chrome.storage.local.get(null, (data) => {
  console.log('All stored data:', data);

  // 特定のプレゼンテーションのデータを確認
  const presentationId = 'abc123'; // 実際のIDに置き換え
  console.log('Pins:', data[`pins:${presentationId}`]);
  console.log('Feedback:', data[`feedback:${presentationId}`]);
});
```

### 3. データのクリア

コンソールで以下を実行:
```javascript
// 特定のプレゼンテーションのデータを削除
const presentationId = 'abc123'; // 実際のIDに置き換え
chrome.storage.local.remove([`pins:${presentationId}`, `feedback:${presentationId}`], () => {
  console.log('Data cleared');
});

// すべてのデータを削除
chrome.storage.local.clear(() => {
  console.log('All data cleared');
});
```

## 既知の制限

1. **ストレージ容量**
   - `chrome.storage.local` の容量制限: 5MB（拡張機能の `unlimited_storage` パーミッションがない場合）
   - 大量のピンを保存すると容量を超える可能性がある

2. **データの同期**
   - `chrome.storage.local` は同期されない（デバイス間で共有されない）
   - 同期が必要な場合は `chrome.storage.sync` を使用（容量制限: 100KB）

3. **バージョン管理**
   - データ構造が変更された場合のマイグレーション機能は未実装
   - 将来的に `version` フィールドを使用してマイグレーションを実装予定

## 次のステップ

- Phase 7-2B: 解決/未解決管理（ステータスフィールドの追加）
- Phase 7-2C: ドラッグ移動（位置変更後の自動保存）
