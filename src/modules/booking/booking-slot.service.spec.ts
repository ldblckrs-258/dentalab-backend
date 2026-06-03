import { Test } from '@nestjs/testing';
import { BookingSlotService } from './booking-slot.service';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import { PrismaService } from '@modules/database';

const PROVIDER_A = 'provider-a-uuid';
const PROVIDER_B = 'provider-b-uuid';
const TYPE_30MIN = 'type-30min-uuid';
const TYPE_50MIN = 'type-50min-uuid';

function makeTomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().substring(0, 10);
}

function makeToday(): string {
  return new Date().toISOString().substring(0, 10);
}

function makePast(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
}

function makeDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

describe('BookingSlotService', () => {
  let service: BookingSlotService;
  let availability: jest.Mocked<ProviderAvailabilityService>;
  let prisma: any;

  beforeEach(async () => {
    availability = {
      getAvailability: jest.fn(),
    } as any;

    prisma = {
      baseClient: {
        appointmentType: {
          findUnique: jest.fn(),
        },
        providerAppointmentType: {
          findMany: jest.fn(),
        },
        appointment: {
          findMany: jest.fn(),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        BookingSlotService,
        { provide: ProviderAvailabilityService, useValue: availability },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BookingSlotService);
  });

  afterEach(() => jest.restoreAllMocks());

  function setupType(id: string, durationMinutes: number) {
    prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
      id,
      durationMinutes,
    });
  }

  function setupJunction(providerIds: string[]) {
    prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue(
      providerIds.map((pid) => ({ providerId: pid })),
    );
  }

  function setupNoBookings() {
    prisma.baseClient.appointment.findMany.mockResolvedValue([]);
  }

  function setupWindow(providerId: string, start: string, end: string) {
    availability.getAvailability.mockResolvedValue({
      providerId,
      date: '',
      dayOfWeek: 1,
      windows: [{ start, end, source: 'schedule' as const }],
      hasApprovedDayOff: false,
    });
  }

  function setupDayOff(providerId: string) {
    availability.getAvailability.mockResolvedValue({
      providerId,
      date: '',
      dayOfWeek: 1,
      windows: [],
      hasApprovedDayOff: true,
    });
  }

  describe('today / past date → empty (booking window enforcement)', () => {
    it('today yields no slots', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makeToday(),
      });
      expect(result.slots).toEqual([]);
    });

    it('past date yields no slots', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makePast(),
      });
      expect(result.slots).toEqual([]);
    });

    it('date beyond +14 days yields no slots', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makeDatePlus(15),
      });
      expect(result.slots).toEqual([]);
    });
  });

  describe('empty junction → empty slots', () => {
    it('no ProviderAppointmentType rows → no slots', async () => {
      setupType(TYPE_30MIN, 30);
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([]);
      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makeTomorrow(),
      });
      expect(result.slots).toEqual([]);
    });
  });

  describe('single provider, no bookings', () => {
    it('09:00-10:00 window, 30-min type → slots at 09:00 and 09:30', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      setupNoBookings();
      setupWindow(PROVIDER_A, '09:00', '10:00');

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makeTomorrow(),
      });

      expect(result.slots).toHaveLength(2);
      expect(result.slots[0].providerIds).toEqual([PROVIDER_A]);
      expect(result.slots[0].start).toMatch(/T02:00:00/);
      expect(result.slots[1].start).toMatch(/T02:30:00/);
    });

    it('VN 09:00 serializes to 02:00Z (UTC+7 offset)', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      setupNoBookings();
      setupWindow(PROVIDER_A, '09:00', '09:30');

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date,
      });

      expect(result.slots[0].start).toBe(`${date}T02:00:00.000Z`);
      expect(result.slots[0].end).toBe(`${date}T02:30:00.000Z`);
    });
  });

  describe('booking mid-window → split', () => {
    it('booked 09:30-10:00 in 09:00-11:00 window → slots before and after booking only', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);

      const bookedStart = new Date(`${date}T02:30:00.000Z`);
      const bookedEnd = new Date(`${date}T03:00:00.000Z`);
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        { startTime: bookedStart, endTime: bookedEnd },
      ]);

      availability.getAvailability.mockResolvedValue({
        providerId: PROVIDER_A,
        date,
        dayOfWeek: 1,
        windows: [
          { start: '09:00', end: '11:00', source: 'schedule' as const },
        ],
        hasApprovedDayOff: false,
      });

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date,
      });

      const startTimes = result.slots.map((s) => s.start);
      expect(startTimes).toContain(`${date}T02:00:00.000Z`);
      expect(startTimes).toContain(`${date}T03:00:00.000Z`);
      expect(startTimes).not.toContain(`${date}T02:30:00.000Z`);
    });
  });

  describe('day off → empty', () => {
    it('provider has approved day off → no slots', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      setupNoBookings();
      setupDayOff(PROVIDER_A);

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date: makeTomorrow(),
      });
      expect(result.slots).toEqual([]);
    });
  });

  describe('custom hours override respected', () => {
    it('availability with custom_hours window used correctly', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A]);
      setupNoBookings();

      availability.getAvailability.mockResolvedValue({
        providerId: PROVIDER_A,
        date,
        dayOfWeek: 1,
        windows: [
          { start: '14:00', end: '15:00', source: 'override' as const },
        ],
        hasApprovedDayOff: false,
      });

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date,
      });

      expect(result.slots).toHaveLength(2);
      expect(result.slots[0].start).toBe(`${date}T07:00:00.000Z`);
    });
  });

  describe('duration boundary', () => {
    it('50-min type in 09:00-10:00 window → one slot at 09:00; 09:50 remainder dropped', async () => {
      const date = makeTomorrow();
      setupType(TYPE_50MIN, 50);
      setupJunction([PROVIDER_A]);
      setupNoBookings();
      setupWindow(PROVIDER_A, '09:00', '10:00');

      const result = await service.getBookableSlots({
        typeId: TYPE_50MIN,
        date,
      });

      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].start).toBe(`${date}T02:00:00.000Z`);
      expect(result.slots[0].end).toBe(`${date}T02:50:00.000Z`);
    });
  });

  describe('any-provider merge (no providerId given)', () => {
    it('same time from 2 providers → one merged slot with providerIds.length === 2', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A, PROVIDER_B]);
      setupNoBookings();

      availability.getAvailability.mockImplementation((pid) =>
        Promise.resolve({
          providerId: pid,
          date,
          dayOfWeek: 1,
          windows: [
            { start: '09:00', end: '09:30', source: 'schedule' as const },
          ],
          hasApprovedDayOff: false,
        }),
      );

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date,
      });

      const slot = result.slots.find(
        (s) => s.start === `${date}T02:00:00.000Z`,
      );
      expect(slot).toBeDefined();
      expect(slot!.providerIds).toHaveLength(2);
      expect(slot!.providerIds).toContain(PROVIDER_A);
      expect(slot!.providerIds).toContain(PROVIDER_B);
    });

    it('different times from 2 providers → two separate slots each with 1 providerId', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A, PROVIDER_B]);
      setupNoBookings();

      availability.getAvailability.mockImplementation((pid) => {
        const start = pid === PROVIDER_A ? '09:00' : '10:00';
        const end = pid === PROVIDER_A ? '09:30' : '10:30';
        return Promise.resolve({
          providerId: pid,
          date,
          dayOfWeek: 1,
          windows: [{ start, end, source: 'schedule' as const }],
          hasApprovedDayOff: false,
        });
      });

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        date,
      });

      expect(result.slots).toHaveLength(2);
      const slotA = result.slots.find(
        (s) => s.start === `${date}T02:00:00.000Z`,
      );
      const slotB = result.slots.find(
        (s) => s.start === `${date}T03:00:00.000Z`,
      );
      expect(slotA!.providerIds).toEqual([PROVIDER_A]);
      expect(slotB!.providerIds).toEqual([PROVIDER_B]);
    });
  });

  describe('specific providerId filter', () => {
    it('providerId not in junction → no slots', async () => {
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_B]);

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        providerId: PROVIDER_A,
        date: makeTomorrow(),
      });

      expect(result.slots).toEqual([]);
    });

    it('providerId in junction → only that provider slots returned', async () => {
      const date = makeTomorrow();
      setupType(TYPE_30MIN, 30);
      setupJunction([PROVIDER_A, PROVIDER_B]);
      setupNoBookings();
      setupWindow(PROVIDER_A, '09:00', '09:30');

      const result = await service.getBookableSlots({
        typeId: TYPE_30MIN,
        providerId: PROVIDER_A,
        date,
      });

      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].providerIds).toEqual([PROVIDER_A]);
    });
  });
});
