import { ContentSearchSource } from './content-search-provider.interface';

export function inferContentSearchSource(url: string | null): ContentSearchSource {
  if (!url) return 'unknown';
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('xiaohongshu.com')) return 'xiaohongshu';
    if (hostname.includes('douyin.com')) return 'douyin';
    if (hostname.includes('bilibili.com')) return 'bilibili';
    return 'web';
  } catch {
    return 'unknown';
  }
}

export function dedupeContentSearchResults<T extends { url: string }>(
  results: T[],
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const result of results) {
    const key = contentSearchResultKey(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function contentSearchResultKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
