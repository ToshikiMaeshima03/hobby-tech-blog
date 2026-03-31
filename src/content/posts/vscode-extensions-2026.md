---
title: "VS Code おすすめ拡張機能2026【Web開発者向け厳選20選】"
description: "2026年版のVS Codeおすすめ拡張機能を厳選して紹介。Web開発の生産性を劇的に向上させるエディタ設定とワークフローを解説。"
category: "tools"
tags: ["VS Code", "拡張機能", "開発環境", "Web開発", "効率化"]
publishedAt: 2026-03-29
featured: false
---

## はじめに

VS Code は Web開発者にとって最も人気のあるエディタです。しかし、拡張機能が膨大に存在するため、「どれを入れればいいかわからない」という声をよく聞きます。

この記事では、2026年の Web開発で実際に役立つ拡張機能を厳選して20個紹介します。「なんとなく入れている」拡張機能を整理し、本当に必要なものだけを導入しましょう。

## 必須級（全員入れるべき）

### 1. Prettier - Code Formatter

コードの自動フォーマッター。チーム開発でも個人開発でも、フォーマットの統一は必須です。

```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "prettier.singleQuote": true,
  "prettier.trailingComma": "all"
}
```

保存時に自動フォーマットされるので、スタイルの議論に時間を取られません。

### 2. ESLint

JavaScript/TypeScript の静的解析ツール。バグやアンチパターンを事前に検出します。

```json
{
  "eslint.validate": [
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact"
  ]
}
```

### 3. GitLens — Git supercharged

Git の履歴を行単位で確認できます。「誰がいつ変更したか」がエディタ上でわかるため、コードリーディングの効率が上がります。

### 4. Error Lens

エラーや警告をインラインで表示します。Problems パネルを開かなくても、コード上で直接問題箇所がわかります。

### 5. Auto Rename Tag

HTML/JSX のタグ名を変更すると、対応する閉じタグも自動で変更されます。地味ですが時短効果が大きい拡張です。

## CSS・スタイリング

### 6. Tailwind CSS IntelliSense

Tailwind CSS のクラス名補完、ホバーでのCSSプレビュー、エラー検出を提供します。Tailwind ユーザーには必須です。v4 で追加された新クラスにも対応しており、[Tailwind CSS v4 の新機能](/blog/tailwind-css-v4-new-features/)と合わせて確認しておくと効率的です。

```json
{
  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\")([^']*)(?:'|\")"],
    ["cn\\(([^)]*)\\)", "(?:'|\")([^']*)(?:'|\")"]
  ]
}
```

`clsx` や `cn` 関数内でも補完を効かせる設定です。

### 7. CSS Peek

HTML/JSX のクラス名から CSS の定義元にジャンプできます。Tailwind を使わないプロジェクトで特に有用です。

### 8. Color Highlight

CSS のカラーコードを実際の色で表示します。`#3b82f6` と書いてあるだけでは何色かわかりませんが、この拡張があれば一目瞭然です。

## HTML・マークアップ

### 9. Emmet（内蔵機能）

VS Code に標準搭載されている HTML/CSS の省略記法です。拡張ではありませんが、意外と使いこなしていない人が多い機能です。

```
入力: section>div.container>h2+p*3
出力:
<section>
  <div class="container">
    <h2></h2>
    <p></p>
    <p></p>
    <p></p>
  </div>
</section>
```

### 10. Highlight Matching Tag

カーソル位置のHTML タグに対応する開始/終了タグをハイライトします。深いネスト構造の把握に役立ちます。

## JavaScript・TypeScript

### 11. Pretty TypeScript Errors

TypeScript のエラーメッセージを読みやすくフォーマットします。複雑な型エラーの解読時間を大幅に短縮できます。

### 12. Import Cost

import 文の横にバンドルサイズを表示します。意図せず巨大なライブラリを読み込んでいないか、即座に確認できます。

### 13. Console Ninja

`console.log` の結果をエディタ上にインラインで表示します。ブラウザの DevTools を開かなくてもデバッグできます。

## AI・生産性

### 14. GitHub Copilot

AI によるコード補完。行単位から関数全体まで、文脈に応じた提案をリアルタイムで表示します。Copilot と Claude Code の詳しい比較は[GitHub Copilot vs Claude Code 比較レビュー](/blog/github-copilot-vs-claude-code-review/)で解説しています。

```json
{
  "github.copilot.enable": {
    "*": true,
    "markdown": true,
    "plaintext": false
  }
}
```

### 15. Claude Dev（Cline）

Claude をエディタ内から利用できる拡張機能。ファイルの編集・作成、コマンド実行をAIに依頼できます。

### 16. REST Client

VS Code 上で HTTP リクエストを送信・テストできます。Postman を開かなくても API のテストが完結します。

```http
### ユーザー一覧を取得
GET https://api.example.com/users
Authorization: Bearer {{token}}

### ユーザーを作成
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "田中太郎",
  "email": "tanaka@example.com"
}
```

## フレームワーク固有

### 17. Astro（astro-build.astro-vscode）

Astro ファイルのシンタックスハイライト、補完、診断を提供します。Astro を使うなら必須です。

### 18. Vue - Official

Vue 3 の公式拡張。TypeScript サポート、テンプレート内の型チェック、コンポーネントの自動インポートに対応しています。

## ユーティリティ

### 19. Live Server

ローカルの HTML ファイルをブラウザでライブプレビューします。ファイル保存時に自動リロードされるため、静的なHTML/CSSの開発に便利です。

### 20. Project Manager

複数のプロジェクトを切り替えるブックマーク機能。副業で複数案件を並行する場合に必須です。

## おすすめの設定まとめ

拡張機能と合わせて、以下の VS Code 設定も推奨します。

```json
// .vscode/settings.json
{
  // 保存時の自動処理
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  },

  // 表示
  "editor.minimap.enabled": false,
  "editor.renderWhitespace": "boundary",
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.bracketPairs": true,

  // フォント
  "editor.fontFamily": "'JetBrains Mono', 'Noto Sans JP', monospace",
  "editor.fontSize": 14,
  "editor.lineHeight": 1.8,

  // ファイル
  "files.autoSave": "onFocusChange",
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

## 入れすぎ注意：拡張機能の断捨離

拡張機能を入れすぎると VS Code の起動速度が低下します。以下のコマンドで使用状況を確認し、不要なものを無効化しましょう。

```
コマンドパレット（Ctrl+Shift+P）
→ "Extensions: Show Running Extensions"
→ 起動時間順にソート
→ 使っていないものを無効化
```

目安として、有効な拡張機能は**20〜30個以内**に抑えるのが快適です。

## まとめ

2026年の Web開発で推奨する VS Code 拡張機能のカテゴリ別まとめです。

| カテゴリ | 必須 | あると便利 |
|---------|------|----------|
| フォーマッター | Prettier, ESLint | - |
| Git | GitLens | - |
| CSS | Tailwind IntelliSense | CSS Peek, Color Highlight |
| HTML | Auto Rename Tag | Highlight Matching Tag |
| JS/TS | Pretty TypeScript Errors | Import Cost, Console Ninja |
| AI | GitHub Copilot | Claude Dev |
| フレームワーク | 使用FWの公式拡張 | - |

まずは必須級の5つを入れ、その後にプロジェクトに応じて追加していくのが効率的です。副業Web制作をこれから始める方は[副業Web制作で月10万円を達成するロードマップ](/blog/freelance-web-sidejob-roadmap/)で、開発環境の構築からの全体像を把握できます。
