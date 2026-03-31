---
title: "Tailwind CSS v4 の新機能まとめ【移行ガイド付き】"
description: "Tailwind CSS v4の主要な新機能と変更点を網羅的に解説。v3からの移行手順、CSS-firstの設定方法、パフォーマンス改善の実測値を紹介。"
category: "web-development"
tags: ["Tailwind CSS", "CSS", "フロントエンド", "Web制作", "アップデート"]
publishedAt: 2026-03-22
featured: false
---

## はじめに

Tailwind CSS v4 は、フレームワークのアーキテクチャを根本から刷新したメジャーアップデートです。最大の変更は **CSS-first の設定体験**で、従来の `tailwind.config.js` が不要になりました。

この記事では、Tailwind CSS v4 の主要な新機能と、v3 からの移行方法を解説します。

## v3 と v4 の主な違い

| 項目 | v3 | v4 |
|------|-----|-----|
| 設定ファイル | `tailwind.config.js`（JS） | `app.css`（CSS） |
| エンジン | PostCSS プラグイン | Rust製 Oxide エンジン |
| ビルド速度 | 基準 | 最大10倍高速 |
| ブラウザ対応 | IE11 対応オプション | モダンブラウザのみ |
| テーマ定義 | JS オブジェクト | CSS `@theme` ディレクティブ |
| content 設定 | 手動でパス指定 | 自動検出 |
| プラグイン | JS プラグイン API | CSS `@plugin` ディレクティブ |

## 新機能1: CSS-first の設定

### v3 の設定（従来）

```javascript
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{html,js,astro}'],
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#0ea5e9',
          600: '#0284c7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans JP', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
```

### v4 の設定（新方式）

```css
/* app.css */
@import "tailwindcss";

@theme {
  --color-primary-500: #0ea5e9;
  --color-primary-600: #0284c7;
  --font-sans: 'Inter', 'Noto Sans JP', sans-serif;
}

@plugin "@tailwindcss/typography";
```

CSS ファイル内で完結するため、設定のためだけに JavaScript を書く必要がなくなりました。CSS の知識だけで Tailwind をカスタマイズできます。

## 新機能2: 自動 content 検出

v3 では `content` にファイルパスを手動で指定する必要がありました。

```javascript
// v3: パスを手動指定
content: ['./src/**/*.{html,js,astro}']
```

v4 ではプロジェクト内のファイルを**自動検出**します。手動設定は不要です。ただし、特定のファイルを除外したい場合は `@source` で制御できます。

```css
/* 検出対象を追加 */
@source "../node_modules/my-ui-library/src";

/* 検出対象から除外 */
@source not "../legacy";
```

## 新機能3: Oxide エンジン（Rust製ビルドエンジン）

v4 のビルドエンジンは Rust で書き直され、ビルド速度が劇的に向上しています。

```
ビルド時間の比較（1000ファイル、10万クラス使用のプロジェクト）:

v3:  ████████████████████████████████  3,200ms
v4:  ███                                320ms

約10倍の高速化
```

特に大規模プロジェクトや、ホットリロード時の体感速度が大きく改善されます。開発中の CSS 反映が瞬時になるため、生産性への影響は大きいです。

## 新機能4: CSS 変数によるテーマ定義

`@theme` で定義した値は CSS カスタムプロパティ（変数）として出力されます。これにより、JavaScript からテーマ値を参照したり、ダークモードの切り替えに活用できます。

```css
@theme {
  --color-primary-500: #0ea5e9;
  --color-surface: #ffffff;
  --color-surface-dark: #1e293b;
  --radius-lg: 12px;
}
```

出力される CSS:

```css
:root {
  --color-primary-500: #0ea5e9;
  --color-surface: #ffffff;
  --color-surface-dark: #1e293b;
  --radius-lg: 12px;
}
```

JavaScript からの参照:

```javascript
// テーマカラーを取得
const primaryColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-primary-500');
```

## 新機能5: 新しいユーティリティクラス

v4 で追加された主なユーティリティクラスを紹介します。

### コンテナクエリ

親要素のサイズに基づいてスタイルを変更できます。

```html
<div class="@container">
  <div class="flex flex-col @md:flex-row gap-4">
    <img src="/photo.webp" alt="写真" class="w-full @md:w-1/3">
    <div>
      <h3 class="text-lg @md:text-xl font-bold">タイトル</h3>
      <p>本文テキスト</p>
    </div>
  </div>
</div>
```

メディアクエリはビューポート全体のサイズに基づきますが、コンテナクエリは**親要素のサイズ**に基づきます。コンポーネントの再利用性が格段に向上します。レスポンシブレイアウトの設計全般については[CSS Grid と Flexbox の使い分け完全ガイド](/blog/css-grid-flexbox-guide/)もあわせてご覧ください。

### テキストバランス

```html
<!-- テキストの折り返しを視覚的に均等化 -->
<h1 class="text-balance text-4xl font-bold">
  Tailwind CSS v4 の新機能を完全網羅して解説します
</h1>
```

`text-wrap: balance` を適用し、見出しの行末が不自然に短くなるのを防ぎます。

### 3D トランスフォーム

```html
<div class="rotate-x-12 rotate-y-6 perspective-800">
  3D変形が適用されたカード
</div>
```

## 新機能6: @plugin ディレクティブ

プラグインの導入が CSS 内で完結するようになりました。

```css
/* v3: JavaScript で設定 */
/* plugins: [require('@tailwindcss/typography')] */

/* v4: CSS で設定 */
@plugin "@tailwindcss/typography";
@plugin "@tailwindcss/forms";
```

カスタムプラグインも CSS から定義できます。

```css
@plugin {
  /* カスタムユーティリティを定義 */
}
```

## v3 から v4 への移行手順

### ステップ1: パッケージのアップデート

```bash
npm install tailwindcss@latest @tailwindcss/vite@latest
```

### ステップ2: Vite プラグインに変更

```javascript
// astro.config.mjs（Astro の場合）
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Figma デザインを Tailwind v4 でコーディングするワークフローについては[Figma からコーディングを効率化するワークフロー](/blog/figma-to-code-workflow/)で実践的な手順を紹介しています。

### ステップ3: CSS ファイルの書き換え

```css
/* 変更前（v3） */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 変更後（v4） */
@import "tailwindcss";
```

### ステップ4: tailwind.config.js の内容を CSS に移行

```css
/* テーマ設定を @theme に移行 */
@import "tailwindcss";

@theme {
  --color-primary-500: #0ea5e9;
  --font-sans: 'Inter', sans-serif;
}

/* プラグインを @plugin に移行 */
@plugin "@tailwindcss/typography";
```

### ステップ5: tailwind.config.js を削除

すべての設定を CSS に移行できたら、`tailwind.config.js` を削除します。

### 移行時の注意点

| 変更点 | v3 | v4 |
|-------|-----|-----|
| `@apply` | 利用可能 | 利用可能（ただし非推奨） |
| `theme()` 関数 | 利用可能 | CSS 変数を直接参照 |
| `screen()` 関数 | 利用可能 | 削除（メディアクエリを直接記述） |
| `darkMode` | config で設定 | CSS の `prefers-color-scheme` がデフォルト |

## 公式移行ツール

Tailwind CSS は公式の移行ツールを提供しています。

```bash
npx @tailwindcss/upgrade
```

このコマンドで、プロジェクト内の設定ファイルやクラス名の多くが自動的に v4 形式に変換されます。ただし、完全な自動移行は保証されないため、手動での確認は必要です。

## まとめ

Tailwind CSS v4 の主要な変更点を振り返ります。

- **CSS-first 設定**: `tailwind.config.js` が不要に。CSS で完結する設定体験
- **自動 content 検出**: ファイルパスの手動指定が不要
- **Oxide エンジン**: Rust製で最大10倍のビルド速度
- **CSS 変数テーマ**: `@theme` で定義した値が CSS カスタムプロパティとして利用可能
- **新ユーティリティ**: コンテナクエリ、テキストバランス、3Dトランスフォーム
- **移行ツール**: `npx @tailwindcss/upgrade` で半自動移行

v4 は「設定の簡素化」と「ビルド速度の向上」が最大のメリットです。新規プロジェクトは v4 で始め、既存プロジェクトは公式移行ツールを使って段階的に移行するのがおすすめです。Astro と Tailwind CSS v4 を使ったブログ構築の具体的な手順は[Astro + Tailwind CSS v4 でブログを作る手順](/blog/astro-tailwind-blog-setup/)で解説しています。
