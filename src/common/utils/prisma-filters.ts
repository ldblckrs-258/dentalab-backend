export function activeOverrideWhere(userId: string) {
  return {
    user_id: userId,
    is_active: true,
    OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
  };
}

export const OVERRIDE_SELECT = {
  id: true,
  grant_type: true,
  reason: true,
  expires_at: true,
  created_at: true,
  permission: {
    select: { id: true, resource: true, action: true, scope: true },
  },
} as const;
