import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';

function decimal(value: unknown): { whole: string; fraction: string } | null {
  const text=String(value);
  if (!/^\d{1,100}(\.\d{1,100})?$/.test(text)) return null;
  const [whole,fraction='']=text.split('.');
  return {whole:whole.replace(/^0+(?=\d)/,''),fraction};
}
export function compareMoney(a:unknown,b:unknown):number {
  const x=decimal(a),y=decimal(b);if(!x||!y)throw new Error('INVALID_PRICE');
  if(x.whole.length!==y.whole.length)return x.whole.length-y.whole.length;
  const whole=x.whole.localeCompare(y.whole);if(whole)return whole;
  const size=Math.max(x.fraction.length,y.fraction.length);
  return x.fraction.padEnd(size,'0').localeCompare(y.fraction.padEnd(size,'0'));
}
export function finalCandidateRank(items:CandidateSeed[],filters:Record<string,unknown>):CandidateSeed[] {
  const seen=new Set<string>();
  const result=items.filter(item=>{
    if(!decimal(item.amount)||filters.stockOnly===true&&item.stockStatus!=='in_stock')return false;
    if(filters.priceMin!==undefined&&filters.priceMin!==null&&compareMoney(item.amount,filters.priceMin)<0)return false;
    if(filters.priceMax!==undefined&&filters.priceMax!==null&&compareMoney(item.amount,filters.priceMax)>0)return false;
    const key=item.productPoolKey??`${item.platformName}:${item.productUrl}`;
    if(seen.has(key))return false;seen.add(key);return true;
  });
  // Rating/delivery/relevance order was already computed by the search provider. Only prices/stock changed here.
  if(filters.sortRule==='price_asc'||filters.sortRule==='price_desc')result.sort((a,b)=>compareMoney(a.amount,b.amount)*(filters.sortRule==='price_desc'?-1:1));
  return result.slice(0,30);
}
