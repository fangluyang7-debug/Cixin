import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/modules/auth/application/auth.service';
import { JwtTokenService } from '../../src/modules/auth/application/jwt-token.service';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

describe('Guest identity', () => {
  it('issues distinct signed owners without password credentials', async () => {
    const users = new Map<string, any>();
    const create = jest.fn(async ({ data }) => {
      const user = { ...data, status: 'active' };
      users.set(data.id, user);
      return user;
    });
    const prisma = { user: { create, findUnique: async ({ where }: any) => users.get(where.id) } };
    const jwt = new JwtTokenService(new ConfigService({ auth: { jwtSecret: 'guest-unit-test' } }));
    const auth = new AuthService(prisma as unknown as PrismaService, jwt);
    const a = await auth.createGuest();
    const b = await auth.createGuest();
    expect(a.user.userId).not.toEqual(b.user.userId);
    expect(jwt.verify(a.accessToken).sub).toBe(a.user.userId);
    expect((await auth.requireUserFromAuthorization(`Bearer ${b.accessToken}`)).userId).toBe(b.user.userId);
    expect(create.mock.calls.every(([arg]) => arg.data.credential === undefined)).toBe(true);
    await expect(auth.requireUserFromAuthorization()).rejects.toThrow();
  });
});
