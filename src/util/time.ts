const pad = (value: number): string => value.toString().padStart(2, "0");

export const formatClock = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const formatDateTime = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(date)}`;

export const isWithinQuietHours = (
  now: Date,
  quietHours: { readonly start: string; readonly end: string } | null,
): boolean => {
  if (!quietHours) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = quietHours.start.split(":").map(Number);
  const [endH, endM] = quietHours.end.split(":").map(Number);
  if (startH === undefined || startM === undefined) return false;
  if (endH === undefined || endM === undefined) return false;
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
};
