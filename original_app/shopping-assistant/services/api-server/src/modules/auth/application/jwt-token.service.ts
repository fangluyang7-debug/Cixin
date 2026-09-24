import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtUserPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtTokenService {
  constructor(private readonly config: ConfigService) {}

  sign(input: { userId: string; email: string }) {
    const now = Math.floor(Date.now() / 1000);
    const expiresSeconds = this.config.get<number>('auth.jwtExpiresSeconds') ?? 60 * 60 * 24 * 30;
    const payload: JwtUserPayload = {
      sub: input.userId,
      email: input.email,
      iat: now,
      exp: now + expiresSeconds,
    };
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64Url(JSON.stringify(header));
    const encodedPayload = this.base64Url(JSON.stringify(payload));
    const signature = this.signContent(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token: string): JwtUserPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    const [encodedHeader, encodedPayload, signature] = parts;
    const expected = this.signContent(`${encodedHeader}.${encodedPayload}`);
    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    }
    const typed = payload as Record<string, unknown>;
    if (typeof typed.sub !== 'string' || typeof typed.email !== 'string') {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    }
    if (typeof typed.exp !== 'number' || typed.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('AUTH_TOKEN_EXPIRED');
    }
    return typed as unknown as JwtUserPayload;
  }

  private signContent(content: string) {
    return createHmac('sha256', this.getSecret()).update(content).digest('base64url');
  }

  private getSecret() {
    return this.config.get<string>('auth.jwtSecret') ?? 'dev-secret-change-before-deploy';
  }

  private base64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}

