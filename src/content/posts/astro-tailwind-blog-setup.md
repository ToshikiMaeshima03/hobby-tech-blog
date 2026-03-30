---
title: "Astro + Tailwind CSS v4 でブログを作る手順【2026年最新】"
description: "Astro v5 と Tailwind CSS v4 を使って高速なブログサイトを構築する方法を解説。SEO対応、RSS、サイトマップ設定まで網羅。"
category: "web-development"
tags: ["astro", "tailwind-css", "ブログ構築", "静的サイト"]
publishedAt: 2026-03-30
featured: true
---

## はじめに

Astro は静的サイト生成（SSG）に特化した Web フレームワークで、デフォルトで JavaScript をゼロ出力します。Tailwind CSS v4 と組み合わせることで、高速で美しいブログを最小限のコードで構築できます。

この記事では、Astro v5 + Tailwind CSS v4 を使ったブログの構築手順を、実際のコードとともに解説します。

## Astro を選ぶ理由

Astro がブログに最適な理由は以下の通りです。

- **ゼロ JavaScript**: デフォルトでクライアントに JS を送信しない
- **Content Collections**: Markdown/MDX を型安全に管理できる
- **Islands Architecture**: 必要な部分だけインタラクティブにできる
- **ビルトイン最適化**: 画像最適化、コード分割が標準装備

### パフォーマンス比較

| フレームワーク | 初期バンドルサイズ | Lighthouse スコア |
|------------|-------------|---------------|
| Astro | 0 KB (JS なし) | 98-100 |
| Next.js | 80-120 KB | 85-95 |
| Gatsby | 70-100 KB | 85-95 |

## セットアップ手順

### 1. プロジェクト作成

```bash
npm create astro@latest my-blog
cd my-blog
npm install tailwindcss @tailwindcss/vite
```

### 2. Tailwind CSS v4 の設定

Astro の設定ファイルで Vite プラグインとして Tailwind を追加します。

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Tailwind CSS v4 では `tailwind.config.js` が不要になり、CSS ファイル内で直接テーマを定義します。

```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  --color-primary-500: #0ea5e9;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

### 3. Content Collections の設定

記事を型安全に管理するため、Content Collections を設定します。

```typescript
// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    publishedAt: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { posts };
```

## SEO 対策

### サイトマップの追加

```bash
npm install @astrojs/sitemap
```

```javascript
// astro.config.mjs
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://your-domain.com',
  integrations: [sitemap()],
});
```

### 構造化データ

検索結果でリッチスニペットを表示するため、JSON-LD で構造化データを追加します。

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "記事タイトル",
  "datePublished": "2026-03-30",
  "author": {
    "@type": "Organization",
    "name": "サイト名"
  }
}
</script>
```

### RSS フィードの追加

```bash
npm install @astrojs/rss
```

RSS フィードを追加することで、読者がフィードリーダーで記事を購読できるようになります。

## まとめ

Astro + Tailwind CSS v4 の組み合わせは、ブログ構築において最も効率的な選択肢の一つです。

- ゼロ JavaScript でパフォーマンスが圧倒的
- Content Collections で型安全な記事管理
- Tailwind CSS v4 でスタイリングが高速
- SEO 関連の機能が充実

ブログの構築を考えている方は、ぜひ Astro を試してみてください。
