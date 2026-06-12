import { describe, it, expect } from 'bun:test';
import { validateInput, checkRequired, enforceTypes } from '../src/validator';

describe('validator', () => {
  it('validator accepts valid input', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    };
    const result = validateInput({ name: 'test' }, schema);
    expect(result.valid).toBe(true);
  });

  it('validator rejects invalid schema', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number' },
      },
    };
    const result = validateInput({ id: 'not-a-number' }, schema);
    expect(result.valid).toBe(false);
  });

  it('validator handles missing fields', () => {
    const result = checkRequired({}, ['required_field']);
    expect(result).toBe(false);
  });

  it('validator preserves valid nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: { type: 'object' },
      },
    };
    const input = { nested: { key: 'value' } };
    const result = validateInput(input, schema);
    expect(result.valid).toBe(true);
  });

  it('validator enforces type constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
    };
    const obj = { count: '42' };
    enforceTypes(obj, schema);
    expect(obj.count).toBe(42);
  });
});
