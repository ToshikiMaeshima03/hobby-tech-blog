import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { site } from '@/data/site';

export async function GET(context: { site: URL }) {
  const posts = await getCollection('posts', ({ data }) => !data.draft);

  return rss({
    title: site.name,
    description: site.description,
    site: context.site,
    items: posts
      .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
      .map(post => ({
        title: post.data.title,
        pubDate: post.data.publishedAt,
        description: post.data.description,
        link: `/blog/${post.id}/`,
        categories: [post.data.category, ...post.data.tags],
      })),
    customData: '<language>ja</language>',
  });
}
