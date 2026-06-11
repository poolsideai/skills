/**
 * Array manipulation utilities shared across backend services.
 */

export function sanitize<T>(items: T[]): T[] {
  if (!items) {
    return [];
  }
  // Remove null/undefined entries
  return items.filter((x) => x !== null && x !== undefined);
}

export function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
