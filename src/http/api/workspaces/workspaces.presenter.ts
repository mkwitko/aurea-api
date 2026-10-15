export type WorkspaceRow = { id: string; name: string; slug: string; createdAt: Date };

export function presentWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
  };
}
