/**
 * Check if an email address has valid syntax.
 */
export function isValidEmail(email: string): boolean;

/**
 * Parse an email address into local and domain parts.
 */
export function parseEmail(email: string): { local: string; domain: string } | null;
