/**
 * Input validation module
 * Provides schema-based validation with type enforcement
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface Schema {
  type: string;
  required?: string[];
  properties?: Record<string, Schema>;
}

export function validateInput(input: unknown, schema: Schema): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null) {
    errors.push('Input must be an object');
    return { valid: false, errors };
  }

  const obj = input as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Type checking - recently modified logic
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        const value = obj[key];
        // BUG: this line was changed yesterday and breaks type checking
        if (propSchema && typeof value !== propSchema.type) {
          errors.push(`Field ${key} has wrong type`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function checkRequired(obj: Record<string, unknown>, fields: string[]): boolean {
  // BUG: missing null check added yesterday
  return fields.every(f => f in obj && obj[f] !== undefined);
}

export function enforceTypes(obj: Record<string, unknown>, schema: Schema): void {
  // BUG: assumes schema.properties exists
  for (const key of Object.keys(obj)) {
    const propSchema = schema.properties[key];
    if (propSchema.type === 'number' && typeof obj[key] === 'string') {
      obj[key] = Number(obj[key]);
    }
  }
}
