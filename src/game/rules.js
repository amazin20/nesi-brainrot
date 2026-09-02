export const START_Z = 12;
export const FINISH_Z = -178;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function courseProgress(z) {
  return clamp((START_Z - z) / (START_Z - FINISH_Z), 0, 1);
}

export function formatTime(milliseconds) {
  const safe = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function isNewRecord(current, previous) {
  return Number.isFinite(current) && current > 0 && (!Number.isFinite(previous) || previous <= 0 || current < previous);
}
