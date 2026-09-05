import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createId } from '../../../common/utils/id';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import { JwtTokenService } from './jwt-token.service';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string | null;
  status: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtTokenService,
  ) {}

  async register(dto: RegisterDto) {
    this.validateRegisterDto(dto);
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('AUTH_EMAIL_ALREADY_REGISTERED');

    const password = this.hashPassword(dto.password);
    const userId = createId('user');
    const user = await this.prisma.user.create({
      data: {
        id: userId,
        email,
        displayName: this.toOptionalString(dto.displayName),
        credential: {
          create: {
            id: createId('cred'),
            passwordHash: password.hash,
            passwordSalt: password.salt,
            algorithm: 'scrypt',
          },
        },
      },
    });

    return this.buildAuthResponse({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    });
  }

  async login(dto: LoginDto) {
    this.validateLoginDto(dto);
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credential: true },
    });
    if (!user || !user.credential || user.status !== 'active') {
      throw new UnauthorizedException('AUTH_INVALID_CREDENTIALS');
    }
    if (!this.verifyPassword(dto.password, user.credential.passwordSalt, user.credential.passwordHash)) {
      throw new UnauthorizedException('AUTH_INVALID_CREDENTIALS');
    }

    return this.buildAuthResponse({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('AUTH_USER_NOT_FOUND');
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getUserFromAuthorization(authorization?: string | null): Promise<AuthenticatedUser | null> {
    if (!authorization) return null;
    const token = this.extractBearerToken(authorization);
    const payload = this.jwt.verify(token);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('AUTH_USER_NOT_FOUND');
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    };
  }

  async requireUserFromAuthorization(authorization?: string | null) {
    const user = await this.getUserFromAuthorization(authorization);
    if (!user) throw new UnauthorizedException('AUTH_TOKEN_REQUIRED');
    return user;
  }

  private buildAuthResponse(user: AuthenticatedUser) {
    return {
      tokenType: 'Bearer',
      accessToken: this.jwt.sign({ userId: user.userId, email: user.email }),
      user,
    };
  }

  private validateRegisterDto(dto: RegisterDto) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('AUTH_BODY_REQUIRED');
    if (!this.isEmail(dto.email)) throw new BadRequestException('AUTH_EMAIL_INVALID');
    if (typeof dto.password !== 'string' || dto.password.length < 8) {
      throw new BadRequestException('AUTH_PASSWORD_TOO_SHORT');
    }
  }

  private validateLoginDto(dto: LoginDto) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('AUTH_BODY_REQUIRED');
    if (!this.isEmail(dto.email)) throw new BadRequestException('AUTH_EMAIL_INVALID');
    if (typeof dto.password !== 'string' || dto.password.length === 0) {
      throw new BadRequestException('AUTH_PASSWORD_REQUIRED');
    }
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  }

  private verifyPassword(password: string, salt: string, expectedHash: string) {
    const hash = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (hash.length !== expected.length) return false;
    return timingSafeEqual(hash, expected);
  }

  private extractBearerToken(authorization: string) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    return match[1].trim();
  }

  private isEmail(value: unknown) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }
}

