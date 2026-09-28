import { readFile, writeFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url),schemas=JSON.parse(await readFile(new URL('contracts/shopping/v1/schemas.json',root),'utf8'));
const name=id=>'Shopping'+id.replace('shopping.','').split(/[.-]/).map(x=>x[0].toUpperCase()+x.slice(1)).join('')+'V1';
const interfaces=[], validators=[];
function type(field,path){
  if(field.type==='object'){
    const properties=Object.entries(field.properties??{}).map(([key,value])=>`  ${key}${field.required?.includes(key)?'':'?'}: ${type(value,path+key[0].toUpperCase()+key.slice(1))} | null;`);
    validators.push(`export function valid${path}(value: ${path}): boolean { return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && ${Object.entries(field.properties??{}).map(([key,f])=>`(${field.required?.includes(key)?'':`value.${key} === undefined || `}value.${key} === null || ${check(f,`value.${key}`,path+key[0].toUpperCase()+key.slice(1))})`).join(' && ') || 'true'}; }`);
    interfaces.push(`export interface ${path} {\n${properties.join('\n')}\n  __extensionsV1?: Record<string, Object>;\n}`);return path;
  }
  if(field.type==='ref')return name(field.schemaId);
  if(field.type==='array')return `Array<${type(field.items,path+'Item')}>`;
  if(field.type==='union')return field.options.map((option,index)=>type(option,path+index)).join(' | ');
  return {string:'string',integer:'number',number:'number',boolean:'boolean',money:'string | number',json:'Object'}[field.type];
}
function check(field,value,path){
  if(field.type==='object')return `valid${path}(${value} as ${path})`;
  if(field.type==='ref')return `valid${name(field.schemaId)}(${value} as ${name(field.schemaId)})`;
  if(field.type==='array')return `(Array.isArray(${value}) && ${value}.every((item: ${typeFor(field.items,path+'Item')}) => item === null || ${check(field.items,'item',path+'Item')}))`;
  if(field.type==='union')return '('+field.options.map((o,i)=>check(o,value,path+i)).join(' || ')+')';
  if(field.type==='string')return `(typeof ${value} === 'string'${field.enum?' && '+JSON.stringify(field.enum)+`.indexOf(${value}) >= 0`:''}${field.pattern?' && new RegExp('+JSON.stringify(field.pattern)+`).test(${value})`:''})`;
  if(field.type==='number'||field.type==='integer')return `(typeof ${value} === 'number' && Number.${field.type==='integer'?'isSafeInteger':'isFinite'}(${value}))`;
  if(field.type==='boolean')return `(typeof ${value} === 'boolean')`;
  if(field.type==='money')return `((typeof ${value} === 'string' && /^[0-9]+(\\.[0-9]+)?$/.test(${value})) || (typeof ${value} === 'number' && Number.isFinite(${value}) && ${value} >= 0))`;
  return `${value} !== undefined`;
}
function typeFor(field,path){
  if(field.type==='object')return path;
  if(field.type==='ref')return name(field.schemaId);
  if(field.type==='array')return `Array<${typeFor(field.items,path+'Item')}>`;
  if(field.type==='union')return field.options.map((o,i)=>typeFor(o,path+i)).join(' | ');
  return {string:'string',integer:'number',number:'number',boolean:'boolean',money:'string | number',json:'Object'}[field.type];
}
for(const [id,schema]of Object.entries(schemas))type(schema,name(id));
const source='// Generated from contracts/shopping/v1/schemas.json; run npm run contracts:generate.\n'+interfaces.join('\n\n')+'\n'+validators.join('\n\n')+'\n';
await writeFile(new URL('apps/harmony/entry/src/main/ets/models/ShoppingPayloads.ets',root),source);
await writeFile(new URL('services/api-server/src/core/runtime/shopping-payload.types.ts',root),source);
await writeFile(new URL('services/api-server/src/core/runtime/shopping-payload-schema.ts',root),'// Generated from contracts/shopping/v1/schemas.json; run npm run contracts:generate.\nexport const SHOPPING_SCHEMAS = '+JSON.stringify(schemas)+';\n');
console.log('Generated matching ArkTS/TS shopping payload interfaces and server validation schema');
