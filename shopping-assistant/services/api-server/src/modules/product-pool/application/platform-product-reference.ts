export interface PlatformProductReference {
  productId: string | null;
  brandId: string | null;
}

export function parsePlatformProductReference(
  platform: string,
  productUrl: string | null | undefined,
): PlatformProductReference {
  const url = parseUrl(productUrl);
  if (!url) return { productId: null, brandId: null };
  if (!matchesPlatformHost(platform, url.hostname)) {
    return { productId: null, brandId: null };
  }

  const productId = firstNonEmpty([
    readQuery(url, ['id', 'itemId', 'item_id']),
    platform === 'jd' ? readQuery(url, ['sku', 'skuId', 'wareId']) : null,
    platform === 'vipshop'
      ? readQuery(url, ['goodsId', 'productId', 'product_id'])
      : null,
    parsePathProductId(platform, url.pathname),
  ]);
  const brandId =
    platform === 'vipshop'
      ? firstNonEmpty([
          readQuery(url, ['brandId', 'brand_id']),
          parseVipshopPathReference(url.pathname).brandId,
        ])
      : null;

  return { productId, brandId };
}

function matchesPlatformHost(platform: string, hostname: string) {
  const host = hostname.trim().toLowerCase();
  if (platform === 'taobao') return host === 'item.taobao.com';
  if (platform === 'tmall') return host === 'detail.tmall.com';
  if (platform === 'jd') return host === 'jd.com' || host.endsWith('.jd.com');
  if (platform === 'vipshop') return host === 'detail.vip.com';
  if (platform === 'suning') return host === 'product.suning.com';
  if (platform === 'xianyu') {
    return (
      host === 'www.goofish.com' ||
      host === 'item.goofish.com' ||
      host === '2.taobao.com'
    );
  }
  return true;
}

function parseUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function readQuery(url: URL, keys: string[]) {
  for (const key of keys) {
    const value = cleanIdentifier(url.searchParams.get(key));
    if (value) return value;
  }
  return null;
}

function parsePathProductId(platform: string, pathname: string) {
  const segments = pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/\.html?$/i, ''));

  if (platform === 'jd') {
    return cleanIdentifier(
      segments.find((segment) => /^\d{5,}$/.test(segment)) ?? null,
    );
  }
  if (platform === 'vipshop' || platform === 'suning') {
    if (platform === 'vipshop') {
      const reference = parseVipshopPathReference(pathname);
      if (reference.productId) return reference.productId;
    }
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const productId = cleanIdentifier(segments[index] ?? null);
      if (productId && /\d/.test(productId)) return productId;
    }
  }
  return null;
}

function parseVipshopPathReference(pathname: string): PlatformProductReference {
  const segments = pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = (segments[segments.length - 1] ?? '').replace(
    /\.html?$/i,
    '',
  );
  const numericParts = lastSegment.match(/\d+/g) ?? [];
  if (numericParts.length < 2) {
    return { productId: null, brandId: null };
  }
  return {
    productId: cleanIdentifier(numericParts[numericParts.length - 1] ?? null),
    brandId: cleanIdentifier(numericParts[numericParts.length - 2] ?? null),
  };
}

function cleanIdentifier(value: string | null) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) return null;
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function firstNonEmpty(values: Array<string | null>) {
  return values.find((value): value is string => Boolean(value)) ?? null;
}
