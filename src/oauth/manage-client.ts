/**
 * HTTP client for the loc8n /manage/* API endpoints.
 * Uses X-Service-Secret authentication for trusted backend-to-backend calls.
 */

export interface Account {
  id: string;
  auth0Sub: string;
  email: string;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  tier: string;
  isActive: boolean;
  displayHint: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyInfo {
  plainKey: string;
}

export class ManageClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceSecret: string,
  ) {}

  /**
   * Find or create an account by Auth0 subject identifier.
   */
  async findOrCreateAccount(auth0Sub: string, email: string): Promise<Account> {
    const res = await fetch(new URL("/manage/accounts", this.baseUrl).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Secret": this.serviceSecret,
      },
      body: JSON.stringify({ auth0Sub, email }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to find/create account: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { data?: Account } & Account;
    return json.data ?? json;
  }

  /**
   * List API keys for an account.
   */
  async listKeys(accountId: string): Promise<ApiKeyInfo[]> {
    const res = await fetch(
      new URL(`/manage/accounts/${accountId}/keys`, this.baseUrl).href,
      {
        method: "GET",
        headers: {
          "X-Service-Secret": this.serviceSecret,
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list keys: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { data?: { keys: ApiKeyInfo[] }; keys?: ApiKeyInfo[] };
    return json.data?.keys ?? json.keys ?? [];
  }

  /**
   * Create a new API key for an account.
   */
  async createKey(accountId: string, name: string): Promise<CreatedApiKey> {
    const res = await fetch(
      new URL(`/manage/accounts/${accountId}/keys`, this.baseUrl).href,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Secret": this.serviceSecret,
        },
        body: JSON.stringify({ name }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create key: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { data?: CreatedApiKey } & CreatedApiKey;
    return json.data ?? json;
  }
}
