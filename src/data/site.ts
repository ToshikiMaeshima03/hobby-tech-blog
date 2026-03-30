export const site = {
  name: 'Code & Craft',
  description: 'Web制作・フリーランス向けの技術Tips、ツール比較、効率化ノウハウを発信するテックブログ',
  url: 'https://clvr.lol',
  author: 'Clever',
  locale: 'ja_JP',
  language: 'ja',
  ogImage: '/images/og-default.png',
  categories: [
    { slug: 'web-development', name: 'Web制作', description: 'HTML/CSS/JS、フレームワーク、コーディングテクニック' },
    { slug: 'tools', name: 'ツール比較', description: '開発者向けツール・サービスの比較レビュー' },
    { slug: 'freelance', name: 'フリーランス', description: 'フリーランスの仕事術・効率化・営業ノウハウ' },
    { slug: 'ai', name: 'AI活用', description: 'AI・ChatGPT・Claude を使った開発効率化' },
    { slug: 'seo', name: 'SEO', description: 'SEO対策・検索順位改善のテクニック' },
  ],
} as const;
