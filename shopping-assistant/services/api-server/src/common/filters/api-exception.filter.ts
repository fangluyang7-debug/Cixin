import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { fail } from '../dto/api-response.dto';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const error = this.normalizeException(exception);
    response.status(error.status).json(
      fail({
        code: error.code,
        message: error.message,
        details: error.details,
      }),
    );
  }

  private normalizeException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (!(exception instanceof HttpException)) {
      console.error(exception);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      };
    }

    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return {
        status,
        code: this.toErrorCode(body, status),
        message: body,
      };
    }

    if (this.isRecord(body)) {
      const rawMessage = body.message;
      const message = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : exception.message;

      return {
        status,
        code: this.toErrorCode(message, status),
        message,
        details: this.extractDetails(body),
      };
    }

    return {
      status,
      code: this.toErrorCode(exception.message, status),
      message: exception.message,
    };
  }

  private extractDetails(body: Record<string, unknown>) {
    const details = { ...body };
    delete details.message;
    delete details.error;
    delete details.statusCode;
    return Object.keys(details).length > 0 ? details : undefined;
  }

  private toErrorCode(message: string, status: number) {
    if (/^[A-Z0-9_]+$/.test(message)) return message;
    if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    return 'HTTP_ERROR';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
