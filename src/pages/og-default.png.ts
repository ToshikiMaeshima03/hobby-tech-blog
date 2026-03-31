import type { APIRoute } from 'astro';
import { site } from '@/data/site';
import { generateOgImage } from '@/lib/og-image';

export const GET: APIRoute = async () => {
  const png = await generateOgImage({
    title: site.description,
    siteName: site.name,
    siteUrl: site.url,
  });

  return new Response(png, {
    headers: { 'Content-Type': 'image/png' },
  });
};
