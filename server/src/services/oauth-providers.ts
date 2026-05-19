import type { ConnectionKind } from "@agora/shared";

/**
 * Per-provider OAuth 2.0 config. Each provider differs in:
 *   - authorize URL + token URL hostnames
 *   - scope strings (space- vs comma-separated, kind-specific values)
 *   - response payload shape (`access_token` is universal but Notion
 *     wraps it, Slack returns `authed_user.access_token`)
 *
 * The handler in routes/connections.ts reads `byKind[kind]` and
 * exchanges via the generic flow. Adding a fifth provider = one new
 * entry here, no handler changes.
 *
 * Each config maps to two env vars: AGORA_<KIND>_CLIENT_ID and
 * AGORA_<KIND>_CLIENT_SECRET. They MUST be set on Render for the
 * Connect button to do anything more than the stub modal.
 */
export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  /** Some providers expect `scope=` separator other than space. */
  scopeSeparator: " " | "," | "+";
  /** Lowercase env var prefix — `linear` ⇒ `AGORA_LINEAR_CLIENT_ID`. */
  envPrefix: string;
  /**
   * Pull the access token (and optional refresh / expiry / account label)
   * out of the provider's exchange response. Defaults handle the
   * standard RFC 6749 shape; override for providers that wrap the
   * payload differently.
   */
  parseTokenResponse?: (raw: Record<string, unknown>) => ParsedToken;
}

export interface ParsedToken {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until expiry, if the provider gives one. */
  expiresIn?: number;
  /** Human label like "@runfengsun on Linear". Surfaced in the UI. */
  accountLabel?: string;
  /** Granted scopes echoed back. */
  grantedScopes?: string;
  /** Provider-side account id. For Slack this is `authed_user.id` — the
   *  user we DM when delivering notifications. */
  accountId?: string;
}

const standardParse = (raw: Record<string, unknown>): ParsedToken => ({
  accessToken: String(raw.access_token ?? ""),
  refreshToken: raw.refresh_token ? String(raw.refresh_token) : undefined,
  expiresIn:
    typeof raw.expires_in === "number"
      ? raw.expires_in
      : typeof raw.expires_in === "string"
        ? Number(raw.expires_in)
        : undefined,
  grantedScopes: raw.scope ? String(raw.scope) : undefined,
});

export const oauthByKind: Record<ConnectionKind, OAuthConfig> = {
  linear: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: "read",
    scopeSeparator: ",",
    envPrefix: "linear",
    parseTokenResponse: standardParse,
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: "repo read:user",
    scopeSeparator: " ",
    envPrefix: "github",
    parseTokenResponse: standardParse,
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: "",
    scopeSeparator: " ",
    envPrefix: "notion",
    parseTokenResponse: (raw) => ({
      accessToken: String(raw.access_token ?? ""),
      // Notion returns a workspace label in the response.
      accountLabel: raw.workspace_name ? String(raw.workspace_name) : undefined,
    }),
  },
  slack: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    // Bot token, not a user token: Agora posts notification DMs *as the
    // Agora app*, so it needs `chat:write` on a bot token. The Slack user
    // to DM is captured separately as accountId (authed_user.id).
    scopes: "chat:write",
    scopeSeparator: ",",
    envPrefix: "slack",
    parseTokenResponse: (raw) => {
      // Slack v2: the bot token is the top-level access_token; authed_user
      // identifies the person who installed the app — that's who we DM.
      const authedUser = (raw.authed_user as Record<string, unknown>) ?? {};
      const team = (raw.team as Record<string, unknown>) ?? {};
      return {
        accessToken: String(raw.access_token ?? ""),
        accountId: authedUser.id ? String(authedUser.id) : undefined,
        accountLabel: team.name ? `Slack: ${team.name}` : undefined,
        grantedScopes: raw.scope ? String(raw.scope) : undefined,
      };
    },
  },
};

/** Returns the {client_id, client_secret} pair for a provider, or null
 *  when either is unset — that's the signal the OAuth flow is not
 *  configured for this provider yet (UI shows the stub modal). */
export function clientCredentials(
  kind: ConnectionKind,
): { clientId: string; clientSecret: string } | null {
  const cfg = oauthByKind[kind];
  const clientId = process.env[`AGORA_${cfg.envPrefix.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`AGORA_${cfg.envPrefix.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Build the provider authorize URL with state + redirect. */
export function buildAuthorizeUrl(
  kind: ConnectionKind,
  args: { clientId: string; redirectUri: string; state: string },
): string {
  const cfg = oauthByKind[kind];
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    state: args.state,
  });
  if (cfg.scopes) params.set("scope", cfg.scopes);
  // Notion requires owner=user for individual workspace install.
  if (kind === "notion") params.set("owner", "user");
  return `${cfg.authorizeUrl}?${params.toString()}`;
}
