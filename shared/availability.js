import { DateTime } from 'luxon';
export function availableSlots({ date, zone, duration, hours, busy, now = Date.now() }) {
  const day = DateTime.fromISO(date, { zone });
  if (!day.isValid) return [];
  const schedule = hours.find((item) => item.weekday === day.weekday);
  if (!schedule) return [];
  const start = Number(schedule.start.slice(0, 2)) * 60 + Number(schedule.start.slice(3));
  const end = Number(schedule.end.slice(0, 2)) * 60 + Number(schedule.end.slice(3));
  const result = [];
  for (let minute = start; minute + duration <= end; minute += 15) {
    const time =
      String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    const local = DateTime.fromISO(date + 'T' + time, { zone });
    if (
      !local.isValid ||
      local.toFormat('HH:mm') !== time ||
      local.getPossibleOffsets().length !== 1
    )
      continue;
    const instant = local.toMillis();
    const finish = instant + duration * 60000;
    if (
      instant < now + 30 * 60000 ||
      busy.some(
        (item) =>
          new Date(item.startsAt).getTime() < finish && new Date(item.endsAt).getTime() > instant,
      )
    )
      continue;
    result.push({
      startsAt: new Date(instant).toISOString(),
      endsAt: new Date(finish).toISOString(),
      label: time,
    });
  }
  return result;
}
