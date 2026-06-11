/** Convert arbitrary titles into URL slugs. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // BUG: replaces each separator one-for-one
    .replace(/^-+|-+$/g, "");
}
