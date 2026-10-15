import type { Icp } from '@prisma/client';

// Maps a Prisma row to the ICP response shape (Json painPoints → string[]).
export function presentIcp(row: Icp) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    painPoints: (row.painPoints as string[] | null) ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
