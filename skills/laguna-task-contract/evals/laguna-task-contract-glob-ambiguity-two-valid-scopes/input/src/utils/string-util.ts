/**
 * String manipulation utilities for the API layer.
 */

export function sanitize(input: string): string {
  if (!input) {
    return '';
  }
  // Remove leading/trailing whitespace and collapse internal runs
  const trimmed = input.trim();
  return trimmed.replace(/\s+/g, ' ');
}

export function truncate(input: string, maxLen: number): string {
  if (input.length <= maxLen) {
    return input;
  }
  return input.slice(0, maxLen - 3) + '...';
}
