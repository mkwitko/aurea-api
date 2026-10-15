import { describe, expect, it, vi } from 'vitest';
import { createAuthRepository } from './auth.repository.js';

describe('userById', () => {
  // src/plugins/tenant.ts resolves the acting tenant with
  // `orderBy: { createdAt: 'asc' }`. /auth/me must read memberships in the same
  // order: the web app derives the acting role from the first membership it
  // sees, and without a matching ORDER BY here Postgres is free to return them
  // in any order, so the two could disagree — an OWNER seeing everything
  // disabled, or a VIEWER getting a button that 403s.
  it('orders memberships by createdAt ascending, matching tenant resolution', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1', memberships: [] });
    const prisma = { user: { findUnique } };

    await createAuthRepository(prisma as never).userById('u1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });
  });
});
