import { DEFAULT_TIMEZONE } from '@common/constants';

export function toVietnamTime(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';

  return new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`,
  );
}

export function nowInVietnam(): Date {
  return toVietnamTime(new Date());
}

export function formatDate(
  date: Date,
  format: 'date' | 'datetime' | 'time' = 'datetime',
): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: DEFAULT_TIMEZONE,
  };

  switch (format) {
    case 'date':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      break;
    case 'time':
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      options.hour12 = false;
      break;
    case 'datetime':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      options.hour12 = false;
      break;
  }

  return new Intl.DateTimeFormat('vi-VN', options).format(date);
}
