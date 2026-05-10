export const Rooms = {
  user: (userId: string): string => `user:${userId}`,

  feature: (mod: string, scope: string, ...parts: string[]): string =>
    [mod, scope, ...parts].filter(Boolean).join(':'),
} as const;

export type RoomNameBuilder = typeof Rooms;
