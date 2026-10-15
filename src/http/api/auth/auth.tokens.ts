import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../../config/env.js';
import { durationToMs } from '../../../lib/duration.js';
import { UnauthorizedError } from '../../../lib/errors.js';
import type { AuthRepository } from './auth.repository.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function issueRefreshToken(repo: AuthRepository, userId: string): Promise<string> {
  const raw = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + durationToMs(env.JWT_REFRESH_TTL));
  await repo.createRefreshToken(userId, sha256(raw), expiresAt);
  return raw;
}

export async function rotateRefreshToken(repo: AuthRepository, raw: string) {
  const record = await repo.findRefreshToken(sha256(raw));
  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Invalid refresh token');
  }
  await repo.revokeRefreshToken(record.id);
  const refreshToken = await issueRefreshToken(repo, record.userId);
  return { user: record.user, refreshToken };
}

export async function revokeRefreshToken(repo: AuthRepository, raw: string): Promise<void> {
  await repo.revokeByHash(sha256(raw));
}
