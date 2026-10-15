import { verifyPassword } from '../../../../lib/password.js';
import { UnauthorizedError } from '../../../../lib/errors.js';
import type { AuthRepository } from '../auth.repository.js';
import type { LoginBody } from './login.schema.js';

export type LoginDeps = { repo: AuthRepository };

export function loginService(deps: LoginDeps) {
  return async (input: LoginBody) => {
    const user = await deps.repo.userByEmail(input.email);
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedError('Invalid credentials');
    return user;
  };
}
