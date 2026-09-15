import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ToolRegistryService } from "../../core/runtime/tool-registry.service";
import { createShoppingPlugin } from "../../core/runtime/shopping-plugin";
import { RuntimeController } from "./controllers/runtime.controller";
import { RuntimeCoreModule } from "./runtime-core.module";
import { shoppingTaskTemplates } from "../../core/runtime/shopping-task-templates";

@Injectable()
class ShoppingPluginRegistration implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: ToolRegistryService,
  ) {}

  onModuleInit() {
    this.registry.registerPlugin(createShoppingPlugin(this.config));
  }
}

@Module({
  imports: [RuntimeCoreModule.register({ operations: shoppingTaskTemplates })],
  controllers: [RuntimeController],
  providers: [ShoppingPluginRegistration],
  exports: [RuntimeCoreModule],
})
export class RuntimeModule {}
