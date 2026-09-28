import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ArtifactStoreService } from './artifact-store.service';

@Injectable()
export class ArtifactRetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running=false;
  constructor(private readonly artifacts:ArtifactStoreService) {}
  onModuleInit():void {
    if(process.env.ARTIFACT_GC_ENABLED!=='true')return;
    this.timer=setInterval(()=>{void this.collect().catch(()=>{/* Keep evidence; retry on the next tick. */});},60000);
    this.timer.unref();
  }
  onModuleDestroy():void {if(this.timer)clearInterval(this.timer);}
  async collect():Promise<void> {
    if(this.running)return;
    this.running=true;
    try {await this.artifacts.retireTerminalWorkflows();await this.artifacts.expireUnpinned(new Date());}
    finally {this.running=false;}
  }
}
