// Репозиторий пользователей (D1). Зеркало backend/internal/store/user_repo.go.

import { ConflictError, NotFoundError } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import type { AuthUser, Role } from "../types";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  position: string;
  role: Role;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// StoredUser — пользователь вместе с хешем (нужен только для verifyPassword).
export type StoredUser = AuthUser & { passwordHash: string };

function mapUser(r: UserRow): StoredUser {
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    fullName: r.full_name,
    position: r.position,
    role: r.role,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  position: string;
  role: Role;
}

export class UserRepo {
  constructor(private readonly db: D1Database) {}

  async getByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.db
      .prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`)
      .bind(email)
      .first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async getByID(id: string): Promise<StoredUser | null> {
    const row = await this.db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async count(): Promise<number> {
    const row = await this.db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async create(u: NewUser): Promise<StoredUser> {
    const existing = await this.getByEmail(u.email);
    if (existing) throw ConflictError();
    const now = nowIso();
    const user: StoredUser = {
      id: newId(),
      email: u.email.toLowerCase(),
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      position: u.position,
      role: u.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, position, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(user.id, user.email, user.passwordHash, user.fullName, user.position, user.role, user.createdAt, user.updatedAt)
      .run();
    return user;
  }

  async mustExist(id: string): Promise<void> {
    const found = await this.getByID(id);
    if (!found) throw NotFoundError();
  }
}
