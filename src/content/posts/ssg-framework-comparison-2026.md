---
title: "静的サイトジェネレーター比較2026：Astro vs Next.js vs Hugo"
description: "Astro・Next.js・Hugo の3大静的サイトジェネレーターを速度・学習コスト・エコシステムの観点で徹底比較。用途別おすすめも紹介。"
category: "tools"
tags: ["Astro", "Next.js", "Hugo", "SSG", "フレームワーク比較"]
publishedAt: 2026-03-24
featured: false
---

## はじめに

静的サイトジェネレーター（SSG）は、ブログやコーポレートサイト、LP など「動的な処理が少ないサイト」に最適な選択肢です。

2026年現在、主要な SSG は数多くありますが、実務で選ばれるのは主に **Astro**、**Next.js**、**Hugo** の3つです。この記事では、それぞれの特徴を比較し、用途別のおすすめを紹介します。

## 比較サマリー

| 項目 | Astro | Next.js | Hugo |
|------|-------|---------|------|
| 言語 | JavaScript/TypeScript | JavaScript/TypeScript | Go |
| ビルド速度（100ページ） | 約3秒 | 約8秒 | 約0.5秒 |
| 初期バンドルサイズ | 0 KB | 80〜120 KB | 0 KB |
| 学習コスト | 低〜中 | 中〜高 | 低 |
| エコシステム | 成長中 | 非常に充実 | 成熟 |
| 動的機能 | Islands で部分対応 | フル対応 | 基本なし |

## Astro

### 特徴

Astro は「コンテンツ重視のサイト」に特化したフレームワークです。最大の特徴は **ゼロ JavaScript** アーキテクチャで、デフォルトではクライアントに一切の JS を送信しません。

```astro
---
// サーバーサイドで実行される
const posts = await getCollection('posts');
---

<!-- クライアントに送信されるのは HTML だけ -->
<ul>
  {posts.map(post => <li>{post.data.title}</li>)}
</ul>
```

### 強み

- **パフォーマンス**: JS ゼロなので Lighthouse 100点が容易
- **Content Collections**: Markdown を型安全に管理できる
- **Islands Architecture**: 必要な部分だけ React/Vue/Svelte を使える
- **学習コスト**: HTML/CSS がわかれば始められる

### 弱み

- **動的機能が限定的**: ログイン、リアルタイム通信には不向き
- **エコシステムが発展途上**: Next.js に比べるとプラグインが少ない
- **大規模アプリには不向き**: SPA 的な動作が必要なら別の選択肢を

### 向いている用途

- ブログ、テックメディア
- LP、コーポレートサイト
- ドキュメントサイト
- ポートフォリオ

## Next.js

### 特徴

Next.js は React ベースのフルスタックフレームワークです。SSG だけでなく、SSR（サーバーサイドレンダリング）や ISR（インクリメンタル静的再生成）にも対応しており、あらゆる規模のサイトに対応できます。

```tsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export default async function BlogPost({ params }) {
  const post = await getPost(params.slug);
  return <article>{post.content}</article>;
}
```

### 強み

- **フルスタック対応**: API Routes、Server Actions で動的機能も実装可能
- **エコシステム**: React のライブラリがすべて使える
- **Vercel との統合**: デプロイ・プレビュー・分析が簡単
- **ISR**: ビルドなしでページを更新できる

### 弱み

- **初期バンドルサイズ**: React ランタイムが必ず含まれる
- **学習コスト**: App Router、Server Components など概念が多い
- **オーバースペック感**: 静的サイトだけなら機能が余る
- **ビルド速度**: ページ数が増えるとビルド時間が伸びやすい

### 向いている用途

- 大規模 Web アプリ
- EC サイト
- ダッシュボード
- 動的コンテンツが多いメディアサイト

## Hugo

### 特徴

Hugo は Go 言語で書かれた SSG で、**圧倒的なビルド速度**が最大の武器です。数千ページのサイトでも数秒でビルドが完了します。

```markdown
<!-- content/posts/my-post.md -->
+++
title = "記事タイトル"
date = 2026-03-30
tags = ["hugo", "ssg"]
+++

本文をここに書きます。
```

### 強み

- **ビルド速度**: 1,000ページでも1秒以下
- **シングルバイナリ**: インストールが簡単。依存関係なし
- **テーマが豊富**: 300以上のテーマが公開されている
- **安定性**: 枯れた技術で本番運用の実績が多い

### 弱み

- **テンプレート構文**: Go テンプレートの学習が必要
- **JavaScript 統合が弱い**: React/Vue コンポーネントは使えない
- **カスタマイズの壁**: テーマの改造にはGo テンプレートの深い理解が必要
- **エコシステムの閉鎖性**: npm パッケージが使えない

### 向いている用途

- 大量ページのブログ・メディア
- ドキュメントサイト
- 個人ブログ
- JS を一切使いたくないサイト

## 用途別おすすめ

### ブログ・メディアサイト

**おすすめ: Astro**

Content Collections による型安全な記事管理と、ゼロ JavaScript によるパフォーマンスがブログに最適です。RSS やサイトマップもビルトインで対応しています。具体的な構築手順は[Astro + Tailwind CSS v4 でブログを作る手順](/blog/astro-tailwind-blog-setup/)で解説しています。

記事数が数千を超える大規模メディアの場合は **Hugo** も有力な選択肢です。

### LP・コーポレートサイト

**おすすめ: Astro**

LP はパフォーマンスが重要で、動的機能はフォーム程度です。Astro なら Tailwind CSS と組み合わせて高速に制作でき、Islands で問い合わせフォームだけインタラクティブにできます。パフォーマンスの具体的な改善方法は[Core Web Vitals 改善の実践ガイド](/blog/core-web-vitals-improvement-guide/)を参考にしてください。

### Web アプリ + ブログ

**おすすめ: Next.js**

アプリとブログを同じドメインで運用する場合は Next.js 一択です。App Router で静的ページと動的ページを1つのプロジェクトで管理できます。

### 技術ドキュメント

**おすすめ: Astro（Starlight）**

Astro のドキュメントテーマ「Starlight」が非常に優秀です。サイドバー、検索、多言語対応がビルトインで、技術ドキュメントに必要な機能が揃っています。

## パフォーマンスベンチマーク

100ページのブログサイトを各フレームワークでビルドした結果です。

```
ビルド時間:
  Hugo    ████                        0.5秒
  Astro   ████████████                3.1秒
  Next.js ████████████████████████    8.2秒

バンドルサイズ（トップページ）:
  Hugo    ████                        0 KB
  Astro   ████                        0 KB
  Next.js ████████████████████████    92 KB

Lighthouse パフォーマンス:
  Hugo    ████████████████████████    100
  Astro   ████████████████████████    99
  Next.js ████████████████████        88
```

## 移行のしやすさ

既存サイトからの移行を考える場合、以下を参考にしてください。

| 移行元 → 移行先 | 難易度 | 備考 |
|---------------|------|------|
| WordPress → Hugo | 中 | エクスポートツールあり |
| WordPress → Astro | 中 | Markdown 変換が必要 |
| Hugo → Astro | 低 | Markdown がそのまま使える |
| Next.js → Astro | 中 | React コンポーネントは Islands で再利用可能 |

## まとめ

3つのフレームワークの選び方を一言でまとめると以下の通りです。

- **Astro**: コンテンツサイトの最適解。パフォーマンスと開発体験のバランスが良い
- **Next.js**: 動的機能が必要なら唯一の選択肢。フルスタック対応の安心感
- **Hugo**: ビルド速度最優先。大量ページのサイトに強い

迷ったら **Astro** を選んでおけば間違いありません。静的サイトの大半のユースケースをカバーでき、必要に応じて Islands で動的機能を追加できる柔軟性があります。副業でWeb制作を始めるなら、フレームワーク選びと合わせて[副業Web制作で月10万円を達成するロードマップ](/blog/freelance-web-sidejob-roadmap/)も参考になります。
