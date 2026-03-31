import satori from 'satori';
import sharp from 'sharp';

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&display=swap';

let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;

  // Google Fonts の CSS から実際のフォントファイル URL を取得
  const cssRes = await fetch(FONT_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OG Image Generator)' },
  });
  const css = await cssRes.text();
  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match) throw new Error('Font URL not found in CSS');

  const fontRes = await fetch(match[1]);
  fontData = await fontRes.arrayBuffer();
  return fontData;
}

interface OgImageOptions {
  title: string;
  category?: string;
  siteName: string;
  siteUrl: string;
}

export async function generateOgImage(options: OgImageOptions): Promise<Buffer> {
  const { title, category, siteName, siteUrl } = options;
  const font = await loadFont();

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px',
          background: 'linear-gradient(135deg, #0c4a6e 0%, #0369a1 50%, #0ea5e9 100%)',
          color: '#ffffff',
          fontFamily: 'Noto Sans JP',
        },
        children: [
          // 上部: サイト名
          {
            type: 'div',
            props: {
              style: { fontSize: '24px', opacity: 0.9 },
              children: siteName,
            },
          },
          // 中央: タイトル
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              },
              children: [
                ...(category
                  ? [
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                          },
                          children: [
                            {
                              type: 'span',
                              props: {
                                style: {
                                  fontSize: '18px',
                                  backgroundColor: 'rgba(255,255,255,0.2)',
                                  padding: '6px 16px',
                                  borderRadius: '20px',
                                },
                                children: category,
                              },
                            },
                          ],
                        },
                      },
                    ]
                  : []),
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: title.length > 30 ? '36px' : '44px',
                      fontWeight: 700,
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                    },
                    children: title,
                  },
                },
              ],
            },
          },
          // 下部: URL
          {
            type: 'div',
            props: {
              style: {
                fontSize: '20px',
                opacity: 0.7,
                textAlign: 'right',
              },
              children: siteUrl.replace('https://', ''),
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Noto Sans JP',
          data: font,
          weight: 700,
          style: 'normal',
        },
      ],
    },
  );

  return sharp(Buffer.from(svg)).png().toBuffer();
}
