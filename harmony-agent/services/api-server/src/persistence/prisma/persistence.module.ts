import { SessionMutationService } from '../../core/runtime/session-mutation.service';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, SessionMutationService],
  exports: [PrismaService, SessionMutationService],
})
export class PersistenceModule {}
