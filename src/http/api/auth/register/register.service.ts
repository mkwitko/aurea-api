import { hashPassword } from '../../../../lib/password.js';
import { ConflictError } from '../../../../lib/errors.js';
import type { AuthRepository } from '../auth.repository.js';
import type { RegisterBody } from './register.schema.js';

export type RegisterDeps = { repo: AuthRepository };

export function registerService(deps: RegisterDeps) {
  return async (input: RegisterBody) => {
    const existing = await deps.repo.userByEmail(input.email);
    if (existing) throw new ConflictError('Email already registered');
    const passwordHash = await hashPassword(input.password);
    return deps.repo.createAccount({
      name: input.name,
      email: input.email,
      organizationName: input.organizationName,
      passwordHash,
    });
  };
}
