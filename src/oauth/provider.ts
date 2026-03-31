/**
 * Custom OAuthServerProvider that proxies authentication to Auth0.
 *
 * Flow:
 * 1. MCP client calls /authorize → provider redirects to Auth0
 * 2. Auth0 authenticates user → calls back to /oauth/callback
 * 3. Provider exchanges Auth0 code for JWT, extracts sub/email
 * 4. Provider resolves Auth0 identity → loc8n account → API key
 * 5. Provider generates MCP authorization code → redirects to MCP client
 * 6. MCP client exchanges code at /token → gets MCP access token
 */

import { randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Response, Request } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { InMemoryClientsStore, AuthorizationCodeStore, TokenStore } from "./stores.js";
import { ManageClient } from "./manage-client.js";

export interface Auth0Config {
  domain: string; // e.g. "auth.loc8n.com"
  clientId: string;
  clientSecret: string;
}

// Pending authorization requests — keyed by state parameter sent to Auth0
interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string; // MCP client's original state
  createdAt: number;
}

// Cache: Auth0 sub → resolved API key (avoids re-provisioning on every login)
const apiKeyCache = new Map<string, string>();

export class Loc8nOAuthProvider implements OAuthServerProvider {
  private pendingAuths = new Map<string, PendingAuth>();
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  private _clientsStore: InMemoryClientsStore;
  private codeStore: AuthorizationCodeStore;
  private tokenStore: TokenStore;
  private manageClient: ManageClient;
  private auth0: Auth0Config;
  private mcpServerUrl: string;

  constructor(options: {
    clientsStore: InMemoryClientsStore;
    codeStore: AuthorizationCodeStore;
    tokenStore: TokenStore;
    manageClient: ManageClient;
    auth0: Auth0Config;
    mcpServerUrl: string;
  }) {
    this._clientsStore = options.clientsStore;
    this.codeStore = options.codeStore;
    this.tokenStore = options.tokenStore;
    this.manageClient = options.manageClient;
    this.auth0 = options.auth0;
    this.mcpServerUrl = options.mcpServerUrl;

    this.jwks = createRemoteJWKSet(
      new URL(`https://${this.auth0.domain}/.well-known/jwks.json`),
    );

    // Clean up stale pending auths every 5 minutes
    const cleanup = setInterval(() => {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [key, pending] of this.pendingAuths) {
        if (pending.createdAt < cutoff) this.pendingAuths.delete(key);
      }
    }, 5 * 60 * 1000);
    cleanup.unref();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Begins the authorization flow by redirecting the user to Auth0.
   * The SDK's authorize handler calls this after validating client_id, redirect_uri, PKCE params.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Generate a unique state key for the Auth0 redirect
    const auth0State = randomBytes(16).toString("hex");

    // Store the MCP client's authorization params so we can resume after Auth0 callback
    this.pendingAuths.set(auth0State, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      state: params.state,
      createdAt: Date.now(),
    });

    // Build Auth0 authorization URL
    const auth0Url = new URL(`https://${this.auth0.domain}/authorize`);
    auth0Url.searchParams.set("client_id", this.auth0.clientId);
    auth0Url.searchParams.set("redirect_uri", `${this.mcpServerUrl}/oauth/callback`);
    auth0Url.searchParams.set("response_type", "code");
    auth0Url.searchParams.set("scope", "openid email profile");
    auth0Url.searchParams.set("state", auth0State);

    res.redirect(auth0Url.toString());
  }

  /**
   * Returns the PKCE code_challenge for the given authorization code.
   * Called by the SDK's token handler before exchangeAuthorizationCode.
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const stored = this.codeStore.peek(authorizationCode);
    if (!stored) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }
    return stored.codeChallenge;
  }

  /**
   * Exchanges an MCP authorization code for access + refresh tokens.
   * The SDK has already validated PKCE by this point.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const stored = this.codeStore.consume(authorizationCode);
    if (!stored) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }

    const { token: accessToken, expiresAt } = this.tokenStore.createAccessToken({
      clientId: client.client_id,
      apiKey: stored.apiKey,
      scopes: stored.scopes,
    });

    const refreshToken = this.tokenStore.createRefreshToken({
      clientId: client.client_id,
      apiKey: stored.apiKey,
      scopes: stored.scopes,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresAt - Math.floor(Date.now() / 1000),
      refresh_token: refreshToken,
    };
  }

  /**
   * Exchanges a refresh token for a new access token.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const stored = this.tokenStore.verifyRefreshToken(refreshToken);
    if (!stored || stored.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid or expired refresh token");
    }

    const { token: accessToken, expiresAt } = this.tokenStore.createAccessToken({
      clientId: client.client_id,
      apiKey: stored.apiKey,
      scopes: scopes ?? stored.scopes,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresAt - Math.floor(Date.now() / 1000),
      refresh_token: refreshToken, // reuse existing refresh token
    };
  }

  /**
   * Verifies an access token and returns auth info.
   * The API key is stored in extra.apiKey for the /mcp endpoint to extract.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this.tokenStore.verifyAccessToken(token);
    if (!stored) {
      throw new InvalidGrantError("Invalid or expired access token");
    }

    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: stored.expiresAt,
      extra: { apiKey: stored.apiKey },
    };
  }

  /**
   * Revokes a token.
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.tokenStore.revokeAccessToken(request.token);
    this.tokenStore.revokeRefreshToken(request.token);
  }

  // PKCE is validated locally by the SDK
  skipLocalPkceValidation = false;

  // --- Auth0 Callback Handler ---
  // This is mounted as a separate Express route, not part of mcpAuthRouter.

  /**
   * Handles the Auth0 callback after user authentication.
   * Exchanges Auth0 code for JWT, resolves identity → API key,
   * generates MCP authorization code, redirects to MCP client.
   */
  async handleCallback(req: Request, res: Response): Promise<void> {
    try {
      const auth0Code = req.query.code as string | undefined;
      const auth0State = req.query.state as string | undefined;
      const auth0Error = req.query.error as string | undefined;

      if (auth0Error) {
        const errorDesc = req.query.error_description as string || "Authorization denied";
        res.status(400).json({ error: auth0Error, message: errorDesc });
        return;
      }

      if (!auth0Code || !auth0State) {
        res.status(400).json({ error: "invalid_request", message: "Missing code or state" });
        return;
      }

      // Look up the pending MCP authorization request
      const pending = this.pendingAuths.get(auth0State);
      if (!pending) {
        res.status(400).json({ error: "invalid_state", message: "Unknown or expired authorization state" });
        return;
      }
      this.pendingAuths.delete(auth0State);

      // Exchange Auth0 code for tokens
      const auth0Tokens = await this.exchangeAuth0Code(auth0Code);

      // Validate the Auth0 ID token and extract claims
      const { sub, email } = await this.validateAuth0Token(auth0Tokens.id_token);

      // Resolve Auth0 identity → loc8n account → API key
      const apiKey = await this.resolveApiKey(sub, email);

      // Generate MCP authorization code
      const mcpCode = this.codeStore.create({
        clientId: pending.clientId,
        codeChallenge: pending.codeChallenge,
        redirectUri: pending.redirectUri,
        scopes: pending.scopes,
        apiKey,
      });

      // Redirect back to the MCP client's redirect_uri
      const redirectUrl = new URL(pending.redirectUri);
      redirectUrl.searchParams.set("code", mcpCode);
      if (pending.state) {
        redirectUrl.searchParams.set("state", pending.state);
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Internal server error",
      });
    }
  }

  // --- Private helpers ---

  /**
   * Exchange Auth0 authorization code for tokens.
   */
  private async exchangeAuth0Code(code: string): Promise<{ id_token: string; access_token: string }> {
    const tokenUrl = `https://${this.auth0.domain}/oauth/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.auth0.clientId,
        client_secret: this.auth0.clientSecret,
        code,
        redirect_uri: `${this.mcpServerUrl}/oauth/callback`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Auth0 token exchange failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<{ id_token: string; access_token: string }>;
  }

  /**
   * Validate an Auth0 ID token JWT and extract sub/email claims.
   */
  private async validateAuth0Token(idToken: string): Promise<{ sub: string; email: string }> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: `https://${this.auth0.domain}/`,
      audience: this.auth0.clientId,
    });

    const sub = payload.sub;
    const email = (payload.email as string) ?? "";

    if (!sub) {
      throw new Error("Auth0 token missing sub claim");
    }

    return { sub, email };
  }

  /**
   * Resolve Auth0 identity → loc8n account → API key.
   * Uses an in-memory cache to avoid re-provisioning on every login.
   */
  private async resolveApiKey(auth0Sub: string, email: string): Promise<string> {
    // Check cache first
    const cached = apiKeyCache.get(auth0Sub);
    if (cached) return cached;

    // Find or create account
    const account = await this.manageClient.findOrCreateAccount(auth0Sub, email);

    // Check for existing active keys
    const keys = await this.manageClient.listKeys(account.id);
    const activeKey = keys.find((k) => k.isActive);

    let apiKey: string;

    if (activeKey) {
      // User has an active key — we can't retrieve the plain key from the API
      // (it's hashed). Create a new key specifically for MCP OAuth sessions.
      const created = await this.manageClient.createKey(account.id, "mcp-oauth");
      apiKey = created.plainKey;
    } else {
      // No active key — create one
      const created = await this.manageClient.createKey(account.id, "mcp-oauth");
      apiKey = created.plainKey;
    }

    apiKeyCache.set(auth0Sub, apiKey);
    return apiKey;
  }
}
