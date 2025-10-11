# Gemini Slides Reviewer

Chrome 拡張として Google スライドの編集画面に Gemini チェック用のサイドパネルを追加します。ユーザーはプリセットのプロンプトを選択または編集し、任意のタイミングで Gemini API を呼び出してスライドのテキスト構成やビジュアル記述をレビューできます。

## 機能概要

- Google スライド (`https://docs.google.com/presentation/*`) に自動挿入されるフローティングボタンとスライドインパネル。
- プロンプトのプリセットを複数登録し、名称と本文をその場で編集・保存。
- オプションページ（`chrome://extensions` → 対象拡張の「拡張機能のオプション」）で API キーとプリセットの一括管理が可能。
- 現在のスライドデッキの概要（フィルムストリップから抽出したタイトルやテキスト、簡易的なビジュアル説明、スピーカーノート）を Gemini へ送信。
- Gemini からのレスポンスをパネル内に表示。実行ログ代わりに軽いステータス表示も行います。

## ディレクトリ構成

```
gemini-slides-checker/
├── assets/                    # 拡張アイコン
├── src/
│   ├── background.js          # Service worker: Gemini API 呼び出し・初期化
│   ├── contentScript/         # サイドパネル UI と Google スライド DOM 解析
│   │   └── index.js
│   ├── options/               # オプションページ UI
│   │   ├── options.css
│   │   ├── options.html
│   │   └── options.js
│   ├── common/prompts.js      # プリセットと storage キーの定義
│   └── config/runtimeConfig.json  # `npm run inject:env` で書き換え
├── tools/inject-env.js        # 環境変数を runtimeConfig へ反映するスクリプト
├── .env.example
├── manifest.json
├── package.json
└── README.md
```

## セットアップ

1. 依存関係はありませんが、環境変数を生成する場合は Node.js を使用します。
2. `.env.example` をコピーして `.env.local` を作成し、開発用の Gemini API キーを入力します。
   ```bash
   cd gemini-slides-checker
   cp .env.example .env.local
   echo 'GEMINI_API_KEY=xxxxx' >> .env.local
   ```
3. `npm run inject:env` を実行すると `src/config/runtimeConfig.json` に `defaultApiKey` が書き込まれます。ビルドせずに拡張を読み込むだけなら、このステップは省略しても構いません（オプションページからキーを保存できます）。
4. Chrome の拡張機能ページで「デベロッパーモード」をオンにし、「パッケージ化されていない拡張機能を読み込む」から `gemini-slides-checker` ディレクトリを選択します。

## 使い方

1. Google スライドの編集画面を開くと、右下に **Gemini check** ボタンが表示されます。
2. ボタンを押すとサイドパネルが開き、プリセットからプロンプトを選択/編集できます。
3. `Run check` を押すと現在のスライドデッキ概要を収集し、Gemini API にリクエストを送信します。結果はパネル内に表示されます。
4. プロンプトはその場で保存・リセット・複製が可能です。複数 Chrome インスタンスで同期したい場合は、同じ Google アカウントでサインインしておけば `chrome.storage.sync` により同期されます。

### オプションページ

- `chrome://extensions` → 拡張の「詳細」→「拡張機能のオプション」からアクセス。
- API キーの保存・削除、プリセットの追加/編集/削除、デフォルトへのリセットを行えます。
- `runtimeConfig.json` に `defaultApiKey` が設定されている場合は、その値が初期表示されますが、保存し直さない限り storage に書き込まれません。

## Gemini API コールについて

- デフォルトで `gemini-pro` モデル（`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`）を利用します。必要があれば `src/background.js` の `GEMINI_MODEL` を変更してください。
- エラー時はレスポンステキストをそのままパネルのステータスとして表示します。API キー未設定の場合は明示的なメッセージを返します。

## スライド解析ロジックの補足

- 現状はフィルムストリップ (`role="option" aria-label^="Slide"`) からタイトルや本文テキストを抽出し、大まかなビジュアル情報は `aria-label` 内の "image/picture" という文言から推定しています。
- スピーカーノートはアクティブスライドの「スピーカーノート」領域からテキストを抽出します。
- Google スライドの DOM 構造は変更される可能性があるため、将来的に精度を高める場合は Slides API 連携（OAuth を伴う）や canvas オーバーレイ解析などの拡張が必要です。

## パッケージング

```
npm run package
```

`dist/gemini-slides-reviewer.zip` が生成され、Chrome ウェブストア提出等に利用できます。

## 今後の拡張アイデア

- Gemini のストリーミングレスポンス対応や複数モデルの切り替え。
- スライド内オブジェクト（図形、テキストボックス、画像など）の座標やサイズ情報の収集。
- Gemini からのフィードバックをスライド上にハイライト表示するオーバーレイ機能。
- プロンプトのバージョニングやチーム共有機能。
