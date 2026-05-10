import { Rooms } from '@modules/realtime';

export const ScheduleRooms = {
  readers: () => Rooms.feature('schedule', 'readers'),
  byProvider: (providerId: string) =>
    Rooms.feature('schedule', 'provider', providerId),
};
