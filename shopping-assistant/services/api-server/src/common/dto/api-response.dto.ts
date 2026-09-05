import { createId } from '../utils/id';

export interface ApiResponse<T> {
  success: boolean;
  requestId: string;
  data: T | null;
  error: null | {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function ok<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    requestId: createId('req'),
    data,
    error: null,
  };
}

export function fail(input: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}): ApiResponse<null> {
  return {
    success: false,
    requestId: input.requestId ?? createId('req'),
    data: null,
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: input.details } : {}),
    },
  };
}
