---
title: "CSS Grid と Flexbox の使い分け完全ガイド【図解付き】"
description: "CSS GridとFlexboxの違いを図解で解説。レイアウトの種類別に最適な選択肢を示し、実践的なコード例で使い分けをマスター。"
category: "web-development"
tags: ["CSS Grid", "Flexbox", "CSS", "レイアウト", "レスポンシブ"]
publishedAt: 2026-03-18
featured: false
---

## はじめに

CSS のレイアウト手法として定着した **CSS Grid** と **Flexbox**。しかし、「どちらを使えばいいかわからない」「なんとなく Flexbox ばかり使っている」という方は多いのではないでしょうか。

結論から言うと、**2次元レイアウトは Grid、1次元レイアウトは Flexbox** が基本の使い分けです。

この記事では、両者の違いを図解で説明し、実際のレイアウトパターンごとに最適な選択肢を示します。

## 根本的な違い

### Flexbox = 1次元レイアウト

Flexbox は**一方向（横または縦）**にアイテムを並べるのが得意です。

```css
/* 横一列にアイテムを並べる */
.flex-row {
  display: flex;
  gap: 16px;
  align-items: center;
}
```

```
[アイテム1] [アイテム2] [アイテム3] → 横方向の制御
```

### CSS Grid = 2次元レイアウト

CSS Grid は**行と列の両方**を同時に制御できます。

```css
/* 3列×2行のグリッド */
.grid-layout {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: auto auto;
  gap: 16px;
}
```

```
[アイテム1] [アイテム2] [アイテム3]
[アイテム4] [アイテム5] [アイテム6]
↕ 縦横両方向の制御
```

## 判断フローチャート

レイアウトを組む際は、以下のフローで判断すると迷いません。

```
レイアウトの方向は？
├── 横一列 or 縦一列 → Flexbox
├── 格子状（行 + 列） → CSS Grid
└── 複雑な領域配置 → CSS Grid（grid-template-areas）

追加の判断基準:
├── アイテムのサイズが不均一 → Flexbox が柔軟
├── アイテムのサイズを統一したい → CSS Grid が正確
└── レスポンシブで列数を変えたい → CSS Grid（auto-fill）
```

## パターン別の実装例

### パターン1: ナビゲーションバー → Flexbox

ロゴとメニュー項目を横一列に並べる典型的なパターンです。

```css
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
}

.nav-links {
  display: flex;
  gap: 24px;
  list-style: none;
}
```

```html
<nav class="navbar">
  <a href="/" class="logo">Code & Craft</a>
  <ul class="nav-links">
    <li><a href="/blog">ブログ</a></li>
    <li><a href="/about">概要</a></li>
    <li><a href="/contact">お問い合わせ</a></li>
  </ul>
</nav>
```

**Flexbox を選ぶ理由**: 横一列の配置で、アイテム間の余白と左右の配置だけを制御すればよいため。

### パターン2: カードグリッド → CSS Grid

ブログの記事一覧やポートフォリオなど、カードを格子状に並べるパターンです。

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.card-body {
  padding: 20px;
}
```

```html
<div class="card-grid">
  <article class="card">
    <img src="/images/post1.webp" alt="記事1" width="600" height="340">
    <div class="card-body">
      <h3>記事タイトル</h3>
      <p>記事の説明文が入ります。</p>
    </div>
  </article>
  <!-- 繰り返し -->
</div>
```

**CSS Grid を選ぶ理由**: `auto-fill` + `minmax` で、画面幅に応じて列数が自動で変わるレスポンシブレイアウトが CSS だけで実現できます。メディアクエリが不要です。

### パターン3: ヒーローセクション → CSS Grid

テキストと画像を横並びで配置し、モバイルでは縦積みにするパターンです。

```css
.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
  padding: 80px 24px;
}

@media (max-width: 768px) {
  .hero {
    grid-template-columns: 1fr;
    text-align: center;
  }
}
```

**CSS Grid を選ぶ理由**: 2つの領域を正確に1:1で分割し、レスポンシブで1列に切り替える操作が `grid-template-columns` の変更だけで完結します。Figma のデザインからこうしたレイアウトを効率的にコーディングする方法は[Figma からコーディングを効率化するワークフロー](/blog/figma-to-code-workflow/)で解説しています。

### パターン4: フッター → CSS Grid + Flexbox 併用

フッターのような複雑なレイアウトでは、Grid と Flexbox を組み合わせます。

```css
/* 全体の列配置は Grid */
.footer {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 40px;
  padding: 60px 24px;
}

/* 各列内のリンクリストは Flexbox */
.footer-links {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 768px) {
  .footer {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 480px) {
  .footer {
    grid-template-columns: 1fr;
  }
}
```

**併用する理由**: 4列の配置は Grid が適しており、各列内のリンクの縦並びは Flexbox が自然です。

### パターン5: ページ全体のレイアウト → CSS Grid

ヘッダー、サイドバー、メインコンテンツ、フッターの領域配置です。

```css
.page-layout {
  display: grid;
  grid-template-areas:
    "header  header"
    "sidebar main"
    "footer  footer";
  grid-template-columns: 250px 1fr;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}

.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main    { grid-area: main; }
.footer  { grid-area: footer; }

@media (max-width: 768px) {
  .page-layout {
    grid-template-areas:
      "header"
      "main"
      "footer";
    grid-template-columns: 1fr;
  }
  .sidebar { display: none; }
}
```

**CSS Grid を選ぶ理由**: `grid-template-areas` で領域を名前付きで定義でき、レスポンシブ時の再配置が直感的です。

## Tailwind CSS での書き方

Tailwind CSS を使う場合の対応するクラスも紹介します。Tailwind CSS v4 で追加された新しいユーティリティについては[Tailwind CSS v4 の新機能まとめ](/blog/tailwind-css-v4-new-features/)を参照してください。

### Flexbox

```html
<!-- 横並び・中央揃え -->
<div class="flex items-center justify-between gap-4">
  <span>左</span>
  <span>右</span>
</div>

<!-- 縦並び -->
<div class="flex flex-col gap-2">
  <p>項目1</p>
  <p>項目2</p>
</div>

<!-- 折り返し -->
<div class="flex flex-wrap gap-2">
  <span class="px-3 py-1 bg-gray-100 rounded">タグ1</span>
  <span class="px-3 py-1 bg-gray-100 rounded">タグ2</span>
  <span class="px-3 py-1 bg-gray-100 rounded">タグ3</span>
</div>
```

### CSS Grid

```html
<!-- 3列グリッド -->
<div class="grid grid-cols-3 gap-6">
  <div>1</div><div>2</div><div>3</div>
</div>

<!-- レスポンシブカード（auto-fill相当） -->
<div class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
  <div>カード1</div>
  <div>カード2</div>
  <div>カード3</div>
</div>

<!-- レスポンシブ（ブレークポイント指定） -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <div>カード1</div>
  <div>カード2</div>
  <div>カード3</div>
</div>
```

## 使い分け早見表

| レイアウト | 推奨 | 理由 |
|-----------|------|------|
| ナビバー | Flexbox | 横一列 + space-between |
| カードグリッド | Grid | auto-fill で自動列数 |
| ヒーローセクション | Grid | 均等分割 + レスポンシブ |
| フォーム | Flexbox | ラベル + 入力の横並び |
| ページレイアウト | Grid | 領域の名前付き配置 |
| タグ一覧 | Flexbox | 折り返し + 可変幅 |
| 料金表 | Grid | 列の幅を揃えたい |
| ボタングループ | Flexbox | 横一列 + gap |

## よくある間違い

### 間違い1: Grid で1次元レイアウトを組む

```css
/* やりすぎ: 横一列なら Flexbox で十分 */
.buttons {
  display: grid;
  grid-template-columns: auto auto auto;
}

/* 適切: */
.buttons {
  display: flex;
  gap: 8px;
}
```

### 間違い2: Flexbox で格子状レイアウトを組む

```css
/* 無理がある: カードの幅が揃わない */
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.card {
  flex: 1 1 300px; /* 最終行で幅が不揃いに */
}

/* 適切: */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
```

## まとめ

CSS Grid と Flexbox の使い分けを整理します。

- **Flexbox**: 横一列 or 縦一列の1次元レイアウト。ナビバー、ボタングループ、フォームに最適
- **CSS Grid**: 行と列を同時に制御する2次元レイアウト。カードグリッド、ページレイアウトに最適
- **併用が正解**: フッターのように、外側は Grid、内側は Flexbox と組み合わせる
- **迷ったら**: 「列の幅を揃えたいか？」で判断。揃えたいなら Grid、揃えなくていいなら Flexbox

どちらも CSS の標準仕様として完全に成熟しており、ブラウザ互換性の心配もありません。適材適所で使い分けて、効率的なレイアウト実装を目指しましょう。レイアウトを組む際のパフォーマンスへの影響が気になる方は[Core Web Vitals 改善の実践ガイド](/blog/core-web-vitals-improvement-guide/)も参考になります。
