import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/* Date ranges are inclusive pairs of `yyyy-MM-dd` strings, the same shape the
   backend's /consumption endpoint takes. */

export const toDay = (date: Date) => format(date, 'yyyy-MM-dd');

/** Number of calendar days in the range, counting both ends. */
export const rangeDays = (start: string, stop: string) =>
  differenceInCalendarDays(parseISO(stop), parseISO(start)) + 1;

/** Step the range by its own length. A step forward that would run past
 *  `today` stops there instead, keeping the length. */
export function shiftRange(
  start: string,
  stop: string,
  direction: -1 | 1,
  today: string,
): [string, string] {
  const days = rangeDays(start, stop);
  let newStop = addDays(parseISO(stop), days * direction);
  const last = parseISO(today);
  if (newStop > last) newStop = last;
  return [toDay(addDays(newStop, 1 - days)), toDay(newStop)];
}
