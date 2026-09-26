import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RuntimeWorkScope } from '../../core/runtime/runtime-work-scope';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const guarded = this.$extends({ query: { $allModels: { $allOperations: ({ args, query }) => {
      RuntimeWorkScope.checkpoint();
      return RuntimeWorkScope.track((async () => {
        const result = await query(args);
        RuntimeWorkScope.checkpoint();
        return result;
      })());
    } } } });
    const delegates = new Set(Prisma.dmmf.datamodel.models.map(model => model.name[0].toLowerCase() + model.name.slice(1)));
    return new Proxy(this, { get(target, property, receiver) {
      if (typeof property === 'string' && (delegates.has(property) || property === '$transaction')) {
        const value = Reflect.get(guarded, property);
        return typeof value === 'function' ? value.bind(guarded) : value;
      }
      return Reflect.get(target, property, receiver);
    } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
