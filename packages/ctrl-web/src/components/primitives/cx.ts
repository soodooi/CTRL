// cx — classname joiner. Filters falsy values so callers can express
// conditional classes inline (`cx(base, active && styles.active)`) without
// littering ternaries. Centralized here so every primitive + consumer
// uses the same implementation and any future change (e.g. dedupe,
// memoization) is one edit.

export const cx = (
  ...parts: Array<string | undefined | false | null>
): string => parts.filter(Boolean).join(' ');
