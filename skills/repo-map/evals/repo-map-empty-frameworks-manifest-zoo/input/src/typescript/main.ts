#!/usr/bin/env bun
/** TypeScript hello world demonstration. */

export function greet(name: string): string {
  return `Hello from TypeScript, ${name}!`;
}

if (import.meta.main) {
  console.log(greet("world"));
}
