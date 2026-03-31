---
title: "Figma からコーディングを効率化するワークフロー【実践編】"
description: "FigmaデザインからHTML/CSSへの変換を効率化するワークフローを解説。デザイントークンの抽出、コンポーネント設計、AIツール活用まで。"
category: "tools"
tags: ["Figma", "コーディング", "デザイン", "ワークフロー", "効率化"]
publishedAt: 2026-03-12
featured: false
---

## はじめに

Figma のデザインカンプからコーディングする作業は、Web制作の中でも最も時間がかかる工程の一つです。デザイナーが作ったデザインを「正確に」「効率よく」コードに変換するには、体系的なワークフローが不可欠です。

この記事では、Figma からコーディングまでのワークフローを、具体的なツールと手順で解説します。

## 全体ワークフロー

```
1. デザインの確認・整理（30分）
   ↓
2. デザイントークンの抽出（15分）
   ↓
3. コンポーネント構造の設計（30分）
   ↓
4. ベースレイアウトの実装（1〜2時間）
   ↓
5. コンポーネントの実装（2〜4時間）
   ↓
6. レスポンシブ対応（1〜2時間）
   ↓
7. ピクセルパーフェクトの確認（30分〜1時間）
```

## ステップ1: デザインの確認・整理

コーディングに入る前に、デザイン全体を確認して疑問点を洗い出します。

### 確認チェックリスト

| 確認項目 | 確認内容 |
|---------|---------|
| ページ数 | 全ページのデザインが揃っているか |
| レスポンシブ | SP/タブレット版のデザインがあるか |
| ホバー状態 | ボタン・リンクのホバーデザインがあるか |
| 画像素材 | 書き出し可能な形式で用意されているか |
| フォント | 使用フォントのライセンスは問題ないか |
| 動的要素 | テキスト量が変わった場合のレイアウトは想定されているか |

デザインに不備がある場合は、この段階でデザイナーに質問します。コーディング開始後に発覚すると手戻りが大きくなります。

## ステップ2: デザイントークンの抽出

Figma のデザインから、コーディングに必要な**デザイントークン**（色・フォント・余白などの値）を抽出します。

### Figma の Inspect パネルを活用する

Figma の右パネル「Inspect」タブで、選択した要素の CSS プロパティを確認できます。

```
確認すべき主要なトークン:

■ カラー
- プライマリカラー: #0ea5e9
- セカンダリカラー: #64748b
- テキスト色: #1e293b
- 背景色: #f8fafc
- ボーダー色: #e2e8f0

■ フォント
- 見出し: Noto Sans JP / Bold / 32px / line-height 1.4
- 本文: Noto Sans JP / Regular / 16px / line-height 1.8
- 小文字: Noto Sans JP / Regular / 14px / line-height 1.6

■ 余白（Spacing）
- セクション間: 80px（SP: 48px）
- 要素間: 24px（SP: 16px）
- コンテンツ幅: 1200px

■ 角丸（Border Radius）
- ボタン: 8px
- カード: 12px
- 入力フォーム: 6px
```

### Tailwind CSS のテーマに変換する

抽出したトークンを Tailwind CSS v4 のテーマ設定に変換します。v4 の `@theme` ディレクティブの詳細は[Tailwind CSS v4 の新機能まとめ](/blog/tailwind-css-v4-new-features/)を参照してください。

```css
/* app.css */
@import "tailwindcss";

@theme {
  /* カラー */
  --color-primary: #0ea5e9;
  --color-secondary: #64748b;
  --color-text: #1e293b;
  --color-background: #f8fafc;
  --color-border: #e2e8f0;

  /* フォント */
  --font-sans: 'Noto Sans JP', sans-serif;

  /* セクション余白 */
  --spacing-section: 80px;
  --spacing-section-sp: 48px;

  /* コンテンツ幅 */
  --container-max: 1200px;
}
```

## ステップ3: コンポーネント構造の設計

デザインをコンポーネント単位に分解します。Figma のレイヤー構造を参考に、再利用可能な単位で分割します。

### LP の典型的なコンポーネント分解

```
index.html / page.astro
├── Header（ロゴ + ナビゲーション）
├── Hero（キャッチコピー + CTA + ヒーロー画像）
├── Features（特徴セクション × 3カラム）
├── About（自己紹介・会社概要）
├── Works（実績・事例）
├── Pricing（料金表）
├── FAQ（よくある質問 / アコーディオン）
├── CTA（コンバージョンセクション）
├── Contact（お問い合わせフォーム）
└── Footer（フッター）
```

### Astro でのファイル構成

```
src/
├── components/
│   ├── Header.astro
│   ├── Hero.astro
│   ├── Features.astro
│   ├── About.astro
│   ├── Works.astro
│   ├── Pricing.astro
│   ├── FAQ.astro
│   ├── CTA.astro
│   ├── Contact.astro
│   └── Footer.astro
├── layouts/
│   └── Layout.astro
└── pages/
    └── index.astro
```

## ステップ4: ベースレイアウトの実装

コンポーネントの中身を作る前に、ページ全体の骨格を先に組みます。

```astro
---
// src/pages/index.astro
import Layout from '../layouts/Layout.astro';
import Header from '../components/Header.astro';
import Hero from '../components/Hero.astro';
import Features from '../components/Features.astro';
import CTA from '../components/CTA.astro';
import Footer from '../components/Footer.astro';
---

<Layout title="サイトタイトル">
  <Header />
  <main>
    <Hero />
    <Features />
    <CTA />
  </main>
  <Footer />
</Layout>
```

各コンポーネントは最初は空でもOKです。まずページの構造を確定させてから、各セクションを作り込みます。

## ステップ5: Figma のデザイン値を正確に反映する

### spacing の読み取り

Figma で要素を選択し、隣接する要素との距離を測定します。

```
Figma の値 → Tailwind のクラス変換例:

4px  → p-1
8px  → p-2 / gap-2
12px → p-3 / gap-3
16px → p-4 / gap-4
24px → p-6 / gap-6
32px → p-8 / gap-8
48px → p-12 / gap-12
64px → p-16 / gap-16
80px → p-20 / gap-20
```

### フォントサイズの変換

```
Figma の値 → Tailwind のクラス:

12px → text-xs
14px → text-sm
16px → text-base
18px → text-lg
20px → text-xl
24px → text-2xl
30px → text-3xl
36px → text-4xl
48px → text-5xl
```

## ステップ6: AI ツールでコーディングを加速する

Figma のスクリーンショットを AI に渡すことで、初期コードの生成を高速化できます。

### Claude Code での活用例

```
以下のスクリーンショットを元に、Tailwind CSS v4 で
セクションを実装してください。

条件:
- レスポンシブ対応（モバイルファースト）
- 画像はプレースホルダーを使用
- セマンティックな HTML 構造
- Astro コンポーネントとして作成
```

AI が出力したコードを**80%の骨格**として使い、残り20%（余白の微調整、フォントサイズの正確な反映、ホバーエフェクト）を手作業で仕上げる流れが効率的です。Claude Code の具体的な活用方法は[Claude Code で Web制作を効率化する実践テクニック5選](/blog/claude-code-web-development/)で詳しく紹介しています。

## ステップ7: ピクセルパーフェクトの確認

デザインとコーディング結果のずれを確認するツールを紹介します。

### PerfectPixel（Chrome拡張）

デザインカンプの画像をブラウザ上に重ねて、ピクセル単位のずれを確認できます。

```
使い方:
1. Figma からセクションごとにスクリーンショットを書き出し
2. PerfectPixel で画像をオーバーレイ
3. 透明度を調整してずれを確認
4. 修正
```

### 許容範囲の目安

| 項目 | 許容範囲 |
|------|---------|
| 余白・マージン | ±2px |
| フォントサイズ | 完全一致 |
| 色 | 完全一致 |
| 画像サイズ | ±1px |
| ボーダー | 完全一致 |
| レスポンシブ | デザインカンプの幅で一致 |

クライアントの要求レベルによって許容範囲は変わりますが、プロの仕事としては±2px以内を目指しましょう。

## 効率化のための Figma プラグイン

| プラグイン | 用途 |
|-----------|------|
| Figma to Code（HTML） | HTML/CSS コードの書き出し |
| Tokens Studio | デザイントークンの管理・書き出し |
| Batch Export | 画像素材の一括書き出し |
| Iconify | アイコンの検索・挿入 |
| Unsplash | フリー画像の挿入 |

## まとめ

Figma からコーディングを効率化するポイントを整理します。

1. **デザインの確認**を最初に行い、疑問点を先に解消する
2. **デザイントークン**を抽出し、Tailwind のテーマに変換する
3. **コンポーネント分解**でページを再利用可能な単位に分割する
4. **ベースレイアウト→詳細**の順で実装する
5. **AI ツール**で初期コードを生成し、手作業で仕上げる
6. **ピクセルパーフェクト**をツールで確認する

このワークフローを定着させることで、LP1ページのコーディング時間を**8〜12時間から5〜8時間**に短縮できます。副業でLP制作を受注する際の見積もりの考え方は[副業Web制作の見積もり・価格設定ガイド](/blog/freelance-pricing-guide/)で解説しています。
