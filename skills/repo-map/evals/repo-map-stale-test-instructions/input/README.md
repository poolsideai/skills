# email-validator

Lightweight, zero-dependency email address syntax validator for Node.js and browser environments.

## Installation

```sh
npm install email-validator
```

## Usage

```javascript
import { isValidEmail } from 'email-validator';

console.log(isValidEmail('user@example.com'));  // true
console.log(isValidEmail('invalid'));           // false
```

The validator checks for:
- Basic structure: local-part @ domain
- Allowed characters in local part (alphanumeric, dot, hyphen, underscore)
- Domain must contain at least one dot
- No consecutive dots in either part

## API

### `isValidEmail(email: string): boolean`

Returns `true` if the email passes syntax checks, `false` otherwise.

### `parseEmail(email: string): { local: string, domain: string } | null`

Splits a valid email into its local and domain parts. Returns `null` for invalid input.

## Testing

This project uses Jest for testing. The test suite covers:

- Valid email formats (basic, with dots, with hyphens)
- Invalid formats (missing @, consecutive dots, invalid characters)
- Edge cases (empty string, whitespace, extremely long addresses)
- Both `isValidEmail` and `parseEmail` functions

Run the full test suite:

```sh
npm test
```

For watch mode during development:

```sh
npm test -- --watch
```

For coverage reports:

```sh
npm test -- --coverage
```

Jest is configured via `jest.config.js` in the root directory. The test files are located in `src/__tests__/` and follow the naming convention `*.test.js`.

## Development

TypeScript type definitions are provided in `src/index.d.ts`. Run type checking with:

```sh
npm run check-types
```

Lint the source with:

```sh
npm run lint
```

## License

MIT
