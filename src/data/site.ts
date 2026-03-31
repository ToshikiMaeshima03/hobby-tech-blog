export const site = {
  name: 'Code & Craft',
  description: 'Web制作・フリーランス向けの技術Tips、ツール比較、効率化ノウハウを発信するテックブログ',
  url: 'https://clvr.lol',
  author: 'Clever',
  authorDescription: 'エックスサーバー株式会社の開発部門でエンジニアとして勤務。WordPress開発・Webパフォーマンス最適化が専門。ゲーム業界7年のフロントエンド開発経験を持つ。',
  locale: 'ja_JP',
  language: 'ja',
  ogImage: '/og-default.png',
  newsletterApiUrl: 'https://newsletter-api.clvr.lol/subscribe',
  social: {
    github: 'https://github.com/xs-tmaeshima',
    portfolio: 'https://cleverlab.lol/',
  },
  categories: [
    { slug: 'web-development', name: 'Web制作', description: 'HTML/CSS/JS、フレームワーク、コーディングテクニック', color: 'blue' },
    { slug: 'tools', name: 'ツール比較', description: '開発者向けツール・サービスの比較レビュー', color: 'purple' },
    { slug: 'freelance', name: 'フリーランス', description: 'フリーランスの仕事術・効率化・営業ノウハウ', color: 'green' },
    { slug: 'ai', name: 'AI活用', description: 'AI・ChatGPT・Claude を使った開発効率化', color: 'orange' },
    { slug: 'seo', name: 'SEO', description: 'SEO対策・検索順位改善のテクニック', color: 'red' },
  ],
} as const;
