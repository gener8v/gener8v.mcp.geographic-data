/**
 * In-memory stores for OAuth clients, authorization codes, and tokens.
 * Acceptable for single-instance deployment; state is lost on restart.
 */

import { randomUUID, randomBytes } from "crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// --- Client Registration Store ---

export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);

    const full: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: now,
      // Secret doesn't expire for now
      client_secret_expires_at: 0,
    };

    this.clients.set(clientId, full);
    return full;
  }
}

// --- Authorization Code Store ---

export interface StoredAuthorizationCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  apiKey: string;
  expiresAt: number; // epoch seconds
}

export class AuthorizationCodeStore {
  private codes = new Map<string, StoredAuthorizationCode>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up expired codes every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  create(params: Omit<StoredAuthorizationCode, "expiresAt">): string {
    const code = randomBytes(32).toString("hex");
    this.codes.set(code, {
      ...params,
      expiresAt: Math.floor(Date.now() / 1000) + 300, // 5 minute TTL
    });
    return code;
  }

  /**
   * Consume a code (one-time use). Returns the stored data or undefined.
   */
  consume(code: string): StoredAuthorizationCode | undefined {
    const stored = this.codes.get(code);
    if (!stored) return undefined;
    this.codes.delete(code);
    if (stored.expiresAt < Date.now() / 1000) return undefined;
    return stored;
  }

  /**
   * Peek at a code without consuming it (for PKCE challenge lookup).
   */
  peek(code: string): StoredAuthorizationCode | undefined {
    const stored = this.codes.get(code);
    if (!stored || stored.expiresAt < Date.now() / 1000) return undefined;
    return stored;
  }

  private cleanup() {
    const now = Date.now() / 1000;
    for (const [code, stored] of this.codes) {
      if (stored.expiresAt < now) this.codes.delete(code);
    }
  }

  dispose() {
    clearInterval(this.cleanupInterval);
  }
}

// --- Token Store ---

interface StoredToken {
  clientId: string;
  apiKey: string;
  scopes: string[];
  expiresAt: number; // epoch seconds
}

interface StoredRefreshToken {
  clientId: string;
  apiKey: string;
  scopes: string[];
  expiresAt: number;
}

export class TokenStore {
  private accessTokens = new Map<string, StoredToken>();
  private refreshTokens = new Map<string, StoredRefreshToken>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  createAccessToken(params: {
    clientId: string;
    apiKey: string;
    scopes: string[];
  }): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL
    this.accessTokens.set(token, {
      clientId: params.clientId,
      apiKey: params.apiKey,
      scopes: params.scopes,
      expiresAt,
    });
    return { token, expiresAt };
  }

  createRefreshToken(params: {
    clientId: string;
    apiKey: string;
    scopes: string[];
  }): string {
    const token = randomBytes(32).toString("hex");
    this.refreshTokens.set(token, {
      clientId: params.clientId,
      apiKey: params.apiKey,
      scopes: params.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 day TTL
    });
    return token;
  }

  verifyAccessToken(token: string): StoredToken | undefined {
    const stored = this.accessTokens.get(token);
    if (!stored) return undefined;
    if (stored.expiresAt < Date.now() / 1000) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return stored;
  }

  verifyRefreshToken(token: string): StoredRefreshToken | undefined {
    const stored = this.refreshTokens.get(token);
    if (!stored) return undefined;
    if (stored.expiresAt < Date.now() / 1000) {
      this.refreshTokens.delete(token);
      return undefined;
    }
    return stored;
  }

  revokeAccessToken(token: string) {
    this.accessTokens.delete(token);
  }

  revokeRefreshToken(token: string) {
    this.refreshTokens.delete(token);
  }

  private cleanup() {
    const now = Date.now() / 1000;
    for (const [token, stored] of this.accessTokens) {
      if (stored.expiresAt < now) this.accessTokens.delete(token);
    }
    for (const [token, stored] of this.refreshTokens) {
      if (stored.expiresAt < now) this.refreshTokens.delete(token);
    }
  }

  dispose() {
    clearInterval(this.cleanupInterval);
  }
}
