---
title: "Core Web Vitals 改善の実践ガイド【2026年最新】"
description: "LCP・INP・CLSの3指標を改善する具体的な手法をコード例付きで解説。PageSpeed Insightsのスコアを劇的に向上させる実践テクニック。"
category: "seo"
tags: ["Core Web Vitals", "SEO", "パフォーマンス", "LCP", "PageSpeed"]
publishedAt: 2026-03-15
featured: true
---

## はじめに

Core Web Vitals は、Googleが検索ランキングの要因として公式に採用しているユーザー体験指標です。2024年3月に FID が INP（Interaction to Next Paint）に置き換わり、2026年現在は以下の3指標で構成されています。

- **LCP（Largest Contentful Paint）**: 最大コンテンツの表示速度
- **INP（Interaction to Next Paint）**: インタラクションの応答速度
- **CLS（Cumulative Layout Shift）**: レイアウトのずれ

この記事では、各指標の改善方法を具体的なコード例とともに解説します。

## Core Web Vitals の合格基準

| 指標 | 良好 | 改善が必要 | 不良 |
|------|------|----------|------|
| LCP | 2.5秒以下 | 2.5〜4.0秒 | 4.0秒超 |
| INP | 200ms以下 | 200〜500ms | 500ms超 |
| CLS | 0.1以下 | 0.1〜0.25 | 0.25超 |

PageSpeed Insights でこれらの指標を確認し、「不良」や「改善が必要」の項目から優先的に対応していきます。

## LCP の改善方法

LCP は「ファーストビューで最も大きなコンテンツ要素」が表示されるまでの時間です。多くの場合、ヒーロー画像やメインの見出しが対象になります。

### 1. 画像の最適化

LCP の原因として最も多いのが、未最適化の画像です。

```html
<!-- 悪い例: 元画像をそのまま読み込み -->
<img src="/images/hero.jpg" alt="ヒーロー画像">

<!-- 良い例: 最適化された画像 -->
<img
  src="/images/hero.webp"
  alt="ヒーロー画像"
  width="1200"
  height="630"
  fetchpriority="high"
  decoding="async"
  srcset="
    /images/hero-480.webp 480w,
    /images/hero-768.webp 768w,
    /images/hero-1200.webp 1200w
  "
  sizes="(max-width: 768px) 100vw, 1200px"
>
```

ポイントは以下の4つです。

- **WebP/AVIF形式に変換**: JPEG比で30〜50%のファイルサイズ削減
- **`fetchpriority="high"`**: ファーストビューの画像を優先読み込み
- **`width`/`height`属性**: レイアウトシフト防止とブラウザの事前レイアウト計算
- **`srcset`/`sizes`**: デバイスに適したサイズの画像を配信

### 2. サーバーレスポンスの高速化

```
TTFB（サーバー応答時間）が遅い場合の対処法:

1. CDN を導入する（Cloudflare, Vercel Edge など）
2. 静的サイト生成（SSG）に切り替える
3. サーバーサイドのキャッシュを有効化する
4. データベースクエリを最適化する
```

SSG フレームワーク（Astro, Hugo など）を使えば、TTFB を劇的に短縮できます。HTML がビルド時に生成されるため、リクエスト時のサーバー処理が不要です。各フレームワークの特徴やパフォーマンスの違いについては[静的サイトジェネレーター比較2026：Astro vs Next.js vs Hugo](/blog/ssg-framework-comparison-2026/)で詳しく比較しています。

### 3. レンダリングブロックリソースの排除

```html
<!-- 悪い例: レンダリングをブロックする CSS/JS -->
<link rel="stylesheet" href="/css/all.css">
<script src="/js/analytics.js"></script>

<!-- 良い例: クリティカルCSS のインライン化 + 遅延読み込み -->
<style>
  /* ファーストビューに必要な最小限のCSS */
  .hero { display: flex; align-items: center; min-height: 60vh; }
  .hero h1 { font-size: 2.5rem; font-weight: 700; }
</style>
<link rel="stylesheet" href="/css/all.css" media="print" onload="this.media='all'">
<script src="/js/analytics.js" defer></script>
```

## INP の改善方法

INP は、ユーザーのクリックやタップに対する応答速度を測定します。旧指標 FID がファーストインプットのみを計測していたのに対し、INP はページ全体のインタラクションを対象とする点が異なります。

### 1. 重い JavaScript の分割

```javascript
// 悪い例: 初期読み込みで全モジュールを読み込む
import { heavyFunction } from './heavy-module.js';

// 良い例: 動的インポートで必要時に読み込む
button.addEventListener('click', async () => {
  const { heavyFunction } = await import('./heavy-module.js');
  heavyFunction();
});
```

### 2. メインスレッドのブロック回避

```javascript
// 悪い例: 大量データの同期処理
function processItems(items) {
  return items.map(item => expensiveCalculation(item));
}

// 良い例: requestIdleCallback で分割処理
function processItemsAsync(items) {
  return new Promise(resolve => {
    const results = [];
    let index = 0;

    function processChunk(deadline) {
      while (index < items.length && deadline.timeRemaining() > 0) {
        results.push(expensiveCalculation(items[index]));
        index++;
      }
      if (index < items.length) {
        requestIdleCallback(processChunk);
      } else {
        resolve(results);
      }
    }

    requestIdleCallback(processChunk);
  });
}
```

### 3. イベントハンドラの最適化

```javascript
// 悪い例: スクロールイベントで毎回重い処理
window.addEventListener('scroll', () => {
  calculateLayout(); // 毎フレーム実行される
});

// 良い例: requestAnimationFrame で間引く
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(() => {
      calculateLayout();
      ticking = false;
    });
    ticking = true;
  }
});
```

## CLS の改善方法

CLS は、ページ読み込み中にレイアウトが予期せずずれる量を測定します。広告やWebフォント、遅延読み込みの画像が主な原因です。CSSレイアウトを適切に組むことも CLS 改善に有効で、[CSS Grid と Flexbox の使い分けガイド](/blog/css-grid-flexbox-guide/)で解説している手法が役立ちます。

### 1. 画像・動画にサイズを指定する

```html
<!-- 悪い例: サイズ指定なし -->
<img src="/images/photo.webp" alt="写真">

<!-- 良い例: width/height を明示 -->
<img src="/images/photo.webp" alt="写真" width="800" height="450">

<!-- または CSS の aspect-ratio を使用 -->
<img src="/images/photo.webp" alt="写真" class="aspect-video w-full">
```

### 2. Webフォントの FOUT 対策

```css
/* font-display: swap でテキストの表示を優先 */
@font-face {
  font-family: 'NotoSansJP';
  src: url('/fonts/NotoSansJP-Regular.woff2') format('woff2');
  font-display: swap;
  /* サイズ調整でフォント切り替え時のずれを軽減 */
  size-adjust: 100%;
  ascent-override: 98%;
  descent-override: 25%;
}
```

### 3. 動的コンテンツのスペース確保

```css
/* 広告やバナーの表示領域を事前に確保 */
.ad-slot {
  min-height: 250px;
  background-color: #f5f5f5;
}

/* スケルトンスクリーンで読み込み中の領域を確保 */
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## 改善の優先順位

すべてを一度に改善するのは現実的ではありません。以下の優先順位で取り組むのが効率的です。

1. **LCP**: 検索順位への影響が最も大きい。画像最適化だけでも大幅に改善する
2. **CLS**: width/height の追加だけで解決するケースが多い。作業コストが低い
3. **INP**: JavaScript の最適化が必要で作業コストが高い。静的サイトなら問題になりにくい

## 計測ツール

| ツール | 用途 | データ種別 |
|-------|------|----------|
| PageSpeed Insights | 総合的な診断 | フィールド + ラボ |
| Chrome DevTools (Lighthouse) | 開発中の計測 | ラボ |
| Google Search Console | 実ユーザーの状況確認 | フィールド |
| web-vitals ライブラリ | 自前の計測実装 | フィールド |

フィールドデータ（実ユーザーのデータ）が検索ランキングに使われるため、ラボデータだけでなくフィールドデータも確認することが重要です。

## まとめ

Core Web Vitals の改善ポイントを整理します。

- **LCP**: 画像最適化 + CDN + クリティカルCSS が最優先
- **INP**: JavaScript の分割読み込みとメインスレッドの負荷軽減
- **CLS**: 画像サイズの明示 + Webフォント対策 + 動的コンテンツのスペース確保
- **優先順位**: LCP → CLS → INP の順に取り組むのが効率的

Core Web Vitals は単なるSEO対策ではなく、ユーザー体験の改善そのものです。スコアの向上は、直帰率の低下やコンバージョン率の改善にも直結します。サイト全体のSEO評価を底上げするには、パフォーマンスだけでなく[内部リンク戦略](/blog/seo-internal-links-guide/)の最適化もあわせて取り組みましょう。
