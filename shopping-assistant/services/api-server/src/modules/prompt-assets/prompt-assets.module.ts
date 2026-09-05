import { Module } from '@nestjs/common';
import { ProfileSchemaRegistryService } from './application/profile-schema-registry.service';
import { PromptRegistryService } from './application/prompt-registry.service';

@Module({
  providers: [PromptRegistryService, ProfileSchemaRegistryService],
  exports: [PromptRegistryService, ProfileSchemaRegistryService],
})
export class PromptAssetsModule {}
