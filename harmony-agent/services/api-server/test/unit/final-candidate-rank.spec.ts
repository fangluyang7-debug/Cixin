import { compareMoney, finalCandidateRank } from '../../src/modules/sessions/application/final-candidate-rank';
import { CandidateSeed } from '../../src/adapters/search-provider/search-provider.interface';
const item=(id:string,amount:string,stockStatus='in_stock')=>({productPoolKey:id,amount,stockStatus}) as CandidateSeed;
it('preserves decimal precision and applies refreshed price/stock limits',()=>{
  expect(compareMoney('99999999999999999.01','99999999999999999.02')).toBeLessThan(0);
  expect(compareMoney('12.3400','12.34')).toBe(0);
  expect(finalCandidateRank([item('a','15'),item('b','5'),item('c','11','out_of_stock')],{priceMin:'10',priceMax:'20',stockOnly:true})).toEqual([item('a','15')]);
});
it('honors all five sort modes without overwriting provider rating/delivery/relevance ranks',()=>{
  const items=[item('a','20'),item('b','10')];
  for(const sortRule of ['relevance_desc','rating_desc','delivery_asc','price_desc']) expect(finalCandidateRank(items,{sortRule})).toEqual(items);
  expect(finalCandidateRank(items,{sortRule:'price_asc'})).toEqual([...items].reverse());
});
