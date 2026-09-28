import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const cancelled = new Int32Array(workerData.cancelFlag);
function checkpoint() { if (Atomics.load(cancelled,0)) throw new Error('STOP_REQUESTED'); }
try {
  const bytes = await readFile(workerData.path);
  if (createHash('sha256').update(bytes).digest('hex')!==workerData.inputHash) throw new Error('INPUT_HASH_MISMATCH');
  checkpoint();
  if(workerData.capability==='vector.normalize.v1') {
    const data=JSON.parse(bytes.toString('utf8'));
    if(!Number.isSafeInteger(data.dimension)||data.dimension<1||data.dimension>65536||typeof data.indexSnapshotId!=='string'||typeof data.modelVersion!=='string'||
      !Array.isArray(data.rows)||data.rows.length>100000) throw new Error('INDEX_INVALID');
    const start=workerData.resume?.cursor??0;
    if(!Number.isSafeInteger(start)||start<0||start>data.rows.length) throw new Error('CHECKPOINT_INVALID');
    for(let cursor=start;cursor<data.rows.length;cursor+=256) {
      checkpoint(); const norms=[];
      for(const row of data.rows.slice(cursor,cursor+256)) {
        if(!Array.isArray(row)||row.length!==data.dimension||!row.every(Number.isFinite)) throw new Error('INDEX_INVALID');
        // Math.hypot avoids overflow in sum-of-squares for finite large coordinates.
        const norm=Math.hypot(...row); if(!Number.isFinite(norm)) throw new Error('NORM_INVALID'); norms.push(norm);
      }
      await new Promise((resolve,reject)=> {
        parentPort.once('message',message=>message.ack?resolve():reject(new Error('CHECKPOINT_COMMIT_FAILED')));
        parentPort.postMessage({chunk:{start:cursor,cursor:cursor+norms.length,norms,indexSnapshotId:data.indexSnapshotId,modelVersion:data.modelVersion,dimension:data.dimension}});
      });
    }
    checkpoint(); parentPort.postMessage({result:{format:'shopping.normalization.v1',cursor:data.rows.length,indexSnapshotId:data.indexSnapshotId,dimension:data.dimension,modelVersion:data.modelVersion}});
  } else if(workerData.capability==='image.crop.v1') {
    const {default:sharp}=await import('sharp'); const parameters=workerData.parameters;
    const metadata=await sharp(bytes,{limitInputPixels:16777216}).metadata();
    const width=metadata.width,height=metadata.height,b=parameters.box,padding=parameters.paddingRatio;
    if(!width||!height||!b||![b.x,b.y,b.width,b.height,padding].every(Number.isFinite)||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1||b.y+b.height>1||padding<0||padding>0.5||
      !Number.isSafeInteger(parameters.targetSize)||parameters.targetSize<32||parameters.targetSize>1024||!Number.isSafeInteger(parameters.jpegQuality)||parameters.jpegQuality<40||parameters.jpegQuality>95) throw new Error('CROP_INVALID');
    const cx=(b.x+b.width/2)*width,cy=(b.y+b.height/2)*height,side=Math.min(Math.max(b.width*width,b.height*height)*(1+padding*2),Math.max(width,height));
    const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
    const left=clamp(Math.round(cx-side/2),0,width-1),top=clamp(Math.round(cy-side/2),0,height-1);
    const region={left,top,width:clamp(Math.round(cx+side/2),left+1,width)-left,height:clamp(Math.round(cy+side/2),top+1,height)-top};
    const output=await sharp(bytes,{limitInputPixels:16777216}).extract(region).resize({width:parameters.targetSize,height:parameters.targetSize,fit:'contain',background:{r:245,g:245,b:245,alpha:1}}).jpeg({quality:parameters.jpegQuality,mozjpeg:true}).toBuffer();
    checkpoint();parentPort.postMessage({result:{bytes:output,mediaType:'image/jpeg',metadata:{width,height,format:metadata.format??null},cropRegionPx:region,strategy:`bbox_square_pad_${parameters.targetSize}`}});
  } else throw new Error('CAPABILITY_UNSUPPORTED');
} catch(error) { parentPort.postMessage({error:/^[A-Z0-9_]{1,100}$/.test(error?.message)?error.message:'COMPUTE_FAILED'}); }
finally { parentPort.close(); }
