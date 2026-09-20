import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserMemoryExtractionService } from './application/user-memory-extraction.service';
import { UserMemoryContextService } from './application/user-memory-context.service';
import { USER_MEMORY_CONTEXT_ADAPTER } from './application/user-memory-context-adapter.interface';
import { USER_MEMORY_PAYLOAD_ADAPTER } from './application/user-memory-payload-adapter.interface';
import { UserMemoryService } from './application/user-memory.service';
import { USER_MEMORY_VIEW_ADAPTER } from './application/user-memory-view-adapter.interface';
import { StandardUserMemoryContextAdapterService } from './application/standard-user-memory-context-adapter.service';
import { StandardUserMemoryPayloadAdapterService } from './application/standard-user-memory-payload-adapter.service';
import { StandardUserMemoryViewAdapterService } from './application/standard-user-memory-view-adapter.service';
import { UserProfileSchemaRegistryService } from './application/user-profile-schema-registry.service';
import { LocalPreferencesController, UserMemoryController } from './controllers/user-memory.controller';

@Module({
  imports: [AuthModule],
  controllers: [UserMemoryController, LocalPreferencesController],
  providers: [
    UserMemoryService,
    UserMemoryContextService,
    UserMemoryExtractionService,
    StandardUserMemoryContextAdapterService,
    StandardUserMemoryPayloadAdapterService,
    StandardUserMemoryViewAdapterService,
    UserProfileSchemaRegistryService,
    {
      provide: USER_MEMORY_CONTEXT_ADAPTER,
      useExisting: StandardUserMemoryContextAdapterService,
    },
    {
      provide: USER_MEMORY_PAYLOAD_ADAPTER,
      useExisting: StandardUserMemoryPayloadAdapterService,
    },
    {
      provide: USER_MEMORY_VIEW_ADAPTER,
      useExisting: StandardUserMemoryViewAdapterService,
    },
  ],
  exports: [
    UserMemoryService,
    UserMemoryContextService,
    UserMemoryExtractionService,
    USER_MEMORY_CONTEXT_ADAPTER,
    USER_MEMORY_PAYLOAD_ADAPTER,
    USER_MEMORY_VIEW_ADAPTER,
  ],
})
export class UserMemoryModule {}
