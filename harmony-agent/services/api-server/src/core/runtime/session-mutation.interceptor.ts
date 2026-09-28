import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { SessionMutationService } from './session-mutation.service';
import { createId } from '../../common/utils/id';

@Injectable()
export class SessionMutationInterceptor implements NestInterceptor {
  constructor(private readonly mutations:SessionMutationService) {}
  intercept(context:ExecutionContext,next:CallHandler):ReturnType<CallHandler['handle']> {
    const request=context.switchToHttp().getRequest();
    const sessionId=request.params?.sessionId;
    if (!sessionId||process.env.SESSION_REVISION_ENABLED!=='true') return next.handle();
    return defer(async()=>{
      if (['GET','HEAD'].includes(request.method)) {
        await this.mutations.readable(sessionId);
        return lastValueFrom(next.handle() as unknown as Observable<unknown>);
      }
      const read=(name:string)=>request.headers[name]===undefined?undefined:Number(request.headers[name]);
      const response=await this.mutations.execute({sessionId,ownerId:request.user?.userId,key:request.headers['idempotency-key']??createId('request'),
        operation:request.method+':'+request.route.path,input:{body:request.body??null,candidateItemId:request.params.candidateItemId??null},
        baseVersion:read('x-session-version'),revision:read('x-request-revision')},()=>lastValueFrom(next.handle() as unknown as Observable<unknown>));
      // Public API revision belongs to data, rather than changing the envelope contract.
      if(response&&typeof response==='object'&&'data' in response){const value=response as Record<string,unknown>;
        return {...value,data:{...(value.data as object),stateVersion:value.stateVersion,requestRevision:value.requestRevision}};}
      return response;
    }) as unknown as ReturnType<CallHandler['handle']>;
  }
}
