export function activeOverrideWhere(userId: string) {
  return {
    userId,
    isActive: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

export const OVERRIDE_SELECT = {
  id: true,
  grantType: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  permission: {
    select: { id: true, resource: true, action: true, scope: true },
  },
} as const;
