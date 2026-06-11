// User account management

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const users: Map<string, User> = new Map();

export function createUser(email: string, password: string): User {
  // TODO: Add validation here
  const id = Math.random().toString(36).substring(7);
  const passwordHash = hashPassword(password);
  const user: User = {
    id,
    email,
    passwordHash,
    createdAt: new Date(),
  };
  users.set(id, user);
  return user;
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}

function hashPassword(password: string): string {
  // Placeholder; real implementation would use bcrypt
  return Buffer.from(password).toString('base64');
}
