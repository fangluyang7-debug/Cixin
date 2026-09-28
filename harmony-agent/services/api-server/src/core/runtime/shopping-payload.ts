import { BadRequestException } from '@nestjs/common';
import { SHOPPING_SCHEMAS } from './shopping-payload-schema';

interface Field { type:string;properties?:Record<string,Field>;required?:string[];items?:Field;enum?:string[];pattern?:string;options?:Field[];schemaId?:string; }
const schemas=SHOPPING_SCHEMAS as unknown as Record<string,Field>;
function safeKey(key:string):string { if (['__proto__','prototype','constructor','__extensionsV1'].includes(key)) invalid('reserved-key'); return key; }
function invalid(path:string):never { throw new BadRequestException('SHOPPING_PAYLOAD_INVALID:'+path); }
function json(value:unknown,depth:number):unknown {
  if(depth>48)invalid('depth');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(v=>json(v,depth+1));
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[safeKey(key),json(v,depth+1)]));
  }return invalid('json');
}
function encode(field:Field,value:unknown,path:string,depth=0):unknown {
  if(depth>48)return invalid(path);
  if(value===null)return null; // Source unknown/null is never fabricated into a value.
  if(field.type==='json')return json(value,depth);
  if(field.type==='ref')return encode(schemas[field.schemaId!],value,path,depth+1);
  if(field.type==='union'){for(const option of field.options??[]){try{return encode(option,value,path,depth+1);}catch{}}return invalid(path);}
  if(field.type==='string'){if(typeof value!=='string'||(field.enum&&!field.enum.includes(value))||(typeof value==='string'&&field.pattern&&!new RegExp(field.pattern).test(value)))return invalid(path);return value;}
  if(field.type==='boolean'){if(typeof value!=='boolean')return invalid(path);return value;}
  if(field.type==='number'||field.type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||(field.type==='integer'&&!Number.isSafeInteger(value)))return invalid(path);return value;}
  if(field.type==='money'){if((typeof value==='string'&&/^\d+(\.\d+)?$/.test(value))||(typeof value==='number'&&Number.isFinite(value)&&value>=0))return value;return invalid(path);}
  if(field.type==='array'){if(!Array.isArray(value)||value.length>100000)return invalid(path);return value.map((v,i)=>encode(field.items!,v,path+'.'+i,depth+1));}
  if(field.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))return invalid(path);
    const source=value as Record<string,unknown>,output:Record<string,unknown>={},extensions:Record<string,unknown>={};
    for(const required of field.required??[])if(!(required in source))invalid(path+'.'+required);
    for(const [key,v] of Object.entries(source)){
      safeKey(key);
      if(field.properties?.[key])output[key]=encode(field.properties[key],v,path+'.'+key,depth+1);
      else extensions[key]=json(v,depth+1);
    }
    // Explicit forward-compatible envelope; known business fields remain typed and checked.
    if(Object.keys(extensions).length)output.__extensionsV1=extensions;
    return output;
  }return invalid(path);
}
function decode(field:Field,value:unknown):unknown {
  if(value===null)return value;
  if(field.type==='ref')return decode(schemas[field.schemaId!],value);
  if(field.type==='object'){
    const object=value as Record<string,unknown>,result:Record<string,unknown>={...(object.__extensionsV1 as Record<string,unknown>??{})};
    for(const [key,v] of Object.entries(object))if(key!=='__extensionsV1')result[key]=field.properties?.[key]?decode(field.properties[key],v):v;
    return result;
  }
  if(field.type==='array')return (value as unknown[]).map(v=>decode(field.items!,v));
  return value;
}
export function encodeShoppingPayload(schemaId:string,value:unknown):unknown {
  const schema=schemas[schemaId];return schema?encode(schema,value,schemaId):value;
}
export function decodeShoppingPayload(schemaId:string,value:unknown):unknown {
  const schema=schemas[schemaId];return schema?decode(schema,value):value;
}
export function shoppingSchemaIds():string[]{return Object.keys(schemas);}
