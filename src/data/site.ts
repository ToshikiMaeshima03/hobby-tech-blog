export const site = {
  name: 'Tech Playground',
  description: 'ゲーム開発・低レイヤ技術・AI駆動開発・ゲーム攻略まで、技術で遊ぶエンジニアの実験場',
  url: 'https://lab.clvr.lol',
  author: 'Clever',
  authorDescription: 'ゲーム業界7年のフロントエンド開発経験を持つエンジニア。趣味でUnreal Engine・C++・Rustを触り、Claude CodeやAI駆動開発を実践中。LoL・PoE2・EfTをプレイ。',
  locale: 'ja_JP',
  language: 'ja',
  ogImage: '/og-default.png',
  newsletterApiUrl: '',
  social: {
    github: 'https://github.com/xs-tmaeshima',
    portfolio: 'https://cleverlab.lol/',
  },
  categories: [
    { slug: 'game-dev', name: 'ゲーム開発', description: 'Unreal Engine / Unity / DirectX / C++ を使ったゲーム開発技術', color: 'violet' },
    { slug: 'low-level', name: '低レイヤ・言語', description: 'Rust / C++ / システムプログラミング / メモリ管理', color: 'slate' },
    { slug: 'ai-development', name: 'AI開発', description: 'Claude Code / Codex / AI駆動開発 / LLM活用', color: 'cyan' },
    { slug: 'game-info', name: 'ゲーム情報', description: 'LoL / PoE2 / EfT のパッチノート・攻略・メタ分析', color: 'amber' },
  ],
} as const;
