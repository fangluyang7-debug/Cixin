import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

// Only short publication transactions enter this scope. Model/network work stays outside.
export const transactionScope = new AsyncLocalStorage<Prisma.TransactionClient>();
