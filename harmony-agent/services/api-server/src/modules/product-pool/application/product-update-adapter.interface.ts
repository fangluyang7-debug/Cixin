import { Prisma } from '@prisma/client';

export const PRODUCT_UPDATE_ADAPTER = Symbol('PRODUCT_UPDATE_ADAPTER');

export interface ProductUpdateAdapter {
  toProductUpdateData(body: Record<string, unknown>): Prisma.ProductUpdateInput;
}
