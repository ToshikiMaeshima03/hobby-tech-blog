import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '@/data/site';
import { generateOgImage } from '@/lib/og-image';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.map((post) => {
    const categoryData = site.categories.find((c) => c.slug === post.data.category);
    return {
      params: { slug: post.id },
      props: {
        title: post.data.title,
        category: categoryData?.name || post.data.category,
      },
    };
  });
};

export const GET: APIRoute = async ({ props }) => {
  const { title, category } = props;

  const png = await generateOgImage({
    title,
    category,
    siteName: site.name,
    siteUrl: site.url,
  });

  return new Response(png, {
    headers: { 'Content-Type': 'image/png' },
  });
};
