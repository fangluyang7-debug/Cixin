import * as validators from '../../src/core/runtime/shopping-payload.types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeShoppingPayload, decodeShoppingPayload, shoppingSchemaIds } from '../../src/core/runtime/shopping-payload';
import { SHOPPING_SCHEMAS } from '../../src/core/runtime/shopping-payload-schema';
import { CONVERSATION_FILTER_FIELDS, CONVERSATION_SORT_RULES } from '../../src/common/shopping/conversation-filter-definition';
const root=resolve(__dirname,'../../../../contracts/shopping/v1');
const fixtures=JSON.parse(readFileSync(resolve(root,'fixtures.json'),'utf8')) as Record<string,unknown>;
describe('versioned shopping payload field coverage',()=>{
  it('keeps the generated runtime schema identical to the published contract',()=>{
    expect(SHOPPING_SCHEMAS).toEqual(JSON.parse(readFileSync(resolve(root,'schemas.json'),'utf8')));
    expect(shoppingSchemaIds()).toHaveLength(16);
  });
  it('keeps generated ArkTS validators byte-identical and validates the same fixtures',()=>{
    const project=resolve(root,'../../..');
    expect(readFileSync(resolve(project,'apps/harmony/entry/src/main/ets/models/ShoppingPayloads.ets'),'utf8')).toBe(readFileSync(resolve(project,'services/api-server/src/core/runtime/shopping-payload.types.ts'),'utf8'));
    for(const [id,value] of Object.entries(fixtures)) {
      const name='validShopping'+id.replace('shopping.','').split(/[.-]/).map(x=>x[0].toUpperCase()+x.slice(1)).join('')+'V1';
      expect((validators as unknown as Record<string,(v:unknown)=>boolean>)[name](value)).toBe(true);
    }
  });
  it.each(Object.keys(fixtures))('roundtrips every declared field in %s without losing money/null/raw data',schema=>{
    expect(decodeShoppingPayload(schema,encodeShoppingPayload(schema,fixtures[schema]))).toEqual(fixtures[schema]);
  });
  it('covers every existing filter and all five sorts without replacing patches',()=>{
    for(const field of CONVERSATION_FILTER_FIELDS)expect(SHOPPING_SCHEMAS['shopping.filters'].properties).toHaveProperty(field);
    for(const sort of CONVERSATION_SORT_RULES)expect(()=>encodeShoppingPayload('shopping.filters',{sortRule:sort,filterPatch:{priceMax:'100.50'},filterRemove:['brand'],shouldResetPreviousFilters:false})).not.toThrow();
  });
  it('rejects malformed known fields and keeps extensions in an explicit envelope',()=>{
    expect(()=>encodeShoppingPayload('shopping.candidate',{candidateItemId:'c',price:{amount:'NaN'}})).toThrow();
    expect(()=>encodeShoppingPayload('shopping.filters',{priceMax:Infinity})).toThrow();
    expect(()=>encodeShoppingPayload('shopping.filters',{stockOnly:'yes'})).toThrow();
    const source={status:'succeeded',futureField:{money:'12.3400'}};
    const encoded=encodeShoppingPayload('shopping.result',source);
    expect(encoded).toHaveProperty('__extensionsV1');expect(decodeShoppingPayload('shopping.result',encoded)).toEqual(source);
  });
});
