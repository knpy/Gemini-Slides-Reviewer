# コンテキスト管理機能 実装ガイド

## 概要

このディレクトリには、「Gemini Slides Reviewer」にコンテキスト管理機能を追加するための実装計画ドキュメントが含まれています。

## 実装フェーズ

実装は5つのフェーズに分かれています。**必ず順番に実装してください。**

### Phase 1: コアデータ構造 ⭐ **優先度: 高**
**ファイル**: `phase1-core-data-structure.md`

**内容**:
- プロジェクトID生成機能
- プレゼンテーションID抽出機能
- タイトル取得・類似度判定機能
- Chrome Storage 保存/読み込み機能
- URL→プロジェクトID マッピング管理

**所要時間**: 約2-3時間

**依存関係**: なし（最初に実装）

---

### Phase 2: UI基盤 ⭐ **優先度: 高**
**ファイル**: `phase2-ui-foundation.md`

**内容**:
- タブ切り替えUI（レビュー/コンテキスト）
- プロジェクト名表示
- 静的コンテキスト入力欄
- 外部コンテキスト入力欄（週次）
- コンテキスト保存・読み込み機能

**所要時間**: 約3-4時間

**依存関係**: Phase 1完了後

---

### Phase 3: インテリジェント機能 ⭐ **優先度: 中**
**ファイル**: `phase3-intelligent-features.md`

**内容**:
- プロジェクト自動検出
- タイトル類似度判定
- プロジェクト紐付け確認ダイアログ
- 週次入力欄の自動生成
- 古い空欄の自動削除
- 定期メンテナンス処理

**所要時間**: 約3-4時間

**依存関係**: Phase 1, 2完了後

---

### Phase 4: レビュー統合 ⭐ **優先度: 高**
**ファイル**: `phase4-review-integration.md`

**内容**:
- コンテキスト統合機能
- 単一スライドレビュー時のコンテキスト送信
- 全スライドレビュー時のコンテキスト送信
- コンテキスト表示インジケーター
- コンテキストプレビュー機能

**所要時間**: 約2-3時間

**依存関係**: Phase 1, 2完了後（Phase 3と並行可能）

---

### Phase 5: 快適性向上 ⭐ **優先度: 低**
**ファイル**: `phase5-polish.md`

**内容**:
- 入力リマインダー機能
- エラーハンドリングの改善
- ローディング状態の改善
- データサイズ最適化
- キーボードショートカット
- ストレージ使用状況表示
- デバッグモード
- エクスポート機能（オプション）

**所要時間**: 約2-3時間

**依存関係**: Phase 1-4完了後

---

## 推奨実装順序

### 最小実装（MVP）
Phase 1 → Phase 2 → Phase 4 の順で実装すれば、基本的なコンテキスト管理機能が動作します。

```
1. Phase 1: データ構造とストレージ（2-3時間）
2. Phase 2: UI実装（3-4時間）
3. Phase 4: レビュー統合（2-3時間）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   合計: 7-10時間でMVP完成
```

### 完全実装
すべてのPhaseを実装すれば、フル機能のコンテキスト管理システムが完成します。

```
1. Phase 1: データ構造（2-3時間）
2. Phase 2: UI実装（3-4時間）
3. Phase 3: インテリジェント機能（3-4時間）
4. Phase 4: レビュー統合（2-3時間）
5. Phase 5: 快適性向上（2-3時間）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   合計: 12-17時間で完全実装
```

---

## 実装時の注意事項

### 1. コミット戦略
各Phaseごとにコミットすることを推奨します。

```bash
# Phase 1完了後
git add .
git commit -m "feat: Phase 1 - コアデータ構造の実装"

# Phase 2完了後
git add .
git commit -m "feat: Phase 2 - UI基盤の実装"

# 以下同様
```

### 2. テスト
各Phaseのドキュメントに「テストシナリオ」セクションがあります。
実装後、必ずテストシナリオを実行してください。

### 3. エラーハンドリング
Phase 1-4では基本的なエラーハンドリングのみ。
Phase 5でエラーハンドリングを改善します。

### 4. パフォーマンス
Phase 1-4ではパフォーマンスを気にせず実装。
Phase 5で最適化を行います。

---

## ファイル構成

実装により追加・修正されるファイル：

```
/Users/kenshiro.takasaki/Desktop/development/
├── src/
│   ├── contentScript/
│   │   └── index.js          # メイン実装ファイル（大幅修正）
│   └── background.js          # 修正なし（Phase 4で確認のみ）
├── docs/
│   ├── context-management-design.md  # 設計書（既存）
│   └── implementation/
│       ├── README.md          # このファイル
│       ├── phase1-core-data-structure.md
│       ├── phase2-ui-foundation.md
│       ├── phase3-intelligent-features.md
│       ├── phase4-review-integration.md
│       └── phase5-polish.md
└── manifest.json              # 修正なし
```

---

## データ構造のおさらい

### Chrome Storage (`chrome.storage.local`)

```json
{
  "gemini_projects": {
    "proj_1a2b3c": {
      "projectName": "2025年度 Q1営業報告",
      "createdAt": "2025-10-16T12:00:00Z",
      "updatedAt": "2025-10-16T12:30:00Z",
      "weeklyInputDay": 1,
      "staticContext": {
        "purpose": "新規顧客向けの製品紹介",
        "audience": "技術者ではない経営層"
      },
      "externalContexts": [
        {
          "id": "ctx_001",
          "date": "2025-10-16",
          "content": "キックオフ議事録：...",
          "status": "filled",
          "createdAt": "2025-10-16T09:00:00Z"
        }
      ]
    }
  },
  "gemini_url_project_map": {
    "1ABC123XYZ": "proj_1a2b3c",
    "1DEF456UVW": "proj_1a2b3c"
  }
}
```

---

## トラブルシューティング

### Q1: Chrome Storageにデータが保存されない
**A**: `chrome.storage.local.get()` と `set()` は非同期です。必ず `await` を使用してください。

### Q2: タイトルが取得できない
**A**: Google Slidesのページが完全に読み込まれる前に実行されている可能性があります。`document.readyState === "complete"` を確認してください。

### Q3: プロジェクトIDが重複する
**A**: `generateProjectId()` はタイムスタンプとランダム文字列を組み合わせているため、重複の可能性は極めて低いです。もし発生した場合は、ランダム部分の長さを増やしてください。

### Q4: コンテキストがGeminiに送信されない
**A**: `buildContextPrompt()` の戻り値を確認してください。空文字列の場合、プロジェクトIDが正しく取得できていない可能性があります。

---

## 参考資料

- [Chrome Storage API ドキュメント](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Google Slides URL形式](https://developers.google.com/slides/api/guides/concepts)
- [Gemini API ドキュメント](https://ai.google.dev/docs)

---

## サポート

実装中に問題が発生した場合は、以下を確認してください：

1. 各Phaseのドキュメントの「実装チェックリスト」
2. 各Phaseのドキュメントの「テストシナリオ」
3. ブラウザのコンソールログ（`[Gemini Slides]` で検索）
4. Chrome拡張機能のバックグラウンドページのログ

---

## 次のステップ

1. このREADMEを読む ✅
2. `phase1-core-data-structure.md` を開く
3. Phase 1の実装を開始
4. 実装完了後、テストシナリオを実行
5. コミット
6. Phase 2に進む

**Good luck! 🚀**
