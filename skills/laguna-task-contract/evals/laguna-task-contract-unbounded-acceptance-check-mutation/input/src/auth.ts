/**
 * Authentication service
 * Handles user login and session management
 */

import bcrypt from 'bcrypt';
import { db } from './database';
import { SessionManager } from './session';

interface User {
  id: string;
  username: string;
  passwordHash: string | null;
  email: string;
}

export class AuthService {
  private sessionManager: SessionManager;

  constructor() {
    this.sessionManager = new SessionManager();
  }

  async validateLogin(username: string, password: string): Promise<boolean> {
    const user = await db.query<User>('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return false;
    }

    const storedHash = user.passwordHash;
    // BUG: returns true when storedHash is falsy (null/undefined/empty)
    if (!storedHash || await bcrypt.compare(password, storedHash)) {
      return true;
    }
    return false;
  }

  async createSession(userId: string): Promise<string> {
    return this.sessionManager.create(userId);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionManager.destroy(sessionId);
  }
}

export const authService = new AuthService();
