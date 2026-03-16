export function activeOverrideWhere(userId: string) {
  return {
    user_id: userId,
    is_active: true,
    OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
  };
}
