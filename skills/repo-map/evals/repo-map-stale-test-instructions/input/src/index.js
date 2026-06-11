/**
 * Email validator — syntax checking only, no DNS verification.
 */

const EMAIL_REGEX = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const CONSECUTIVE_DOTS = /\.\./;

/**
 * Check if an email address has valid syntax.
 * @param {string} email - The email address to validate
 * @returns {boolean} True if the email passes syntax checks
 */
export function isValidEmail(email) {
  if (typeof email !== 'string' || email.length === 0) {
    return false;
  }
  
  const trimmed = email.trim();
  if (trimmed !== email || trimmed.length === 0) {
    return false;
  }
  
  if (CONSECUTIVE_DOTS.test(trimmed)) {
    return false;
  }
  
  if (!EMAIL_REGEX.test(trimmed)) {
    return false;
  }
  
  const [local, domain] = trimmed.split('@');
  if (local.startsWith('.') || local.endsWith('.')) {
    return false;
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-') || domain.endsWith('-')) {
    return false;
  }
  
  return true;
}

/**
 * Parse an email address into local and domain parts.
 * @param {string} email - The email address to parse
 * @returns {{local: string, domain: string} | null} The parsed parts, or null if invalid
 */
export function parseEmail(email) {
  if (!isValidEmail(email)) {
    return null;
  }
  
  const [local, domain] = email.trim().split('@');
  return { local, domain };
}
