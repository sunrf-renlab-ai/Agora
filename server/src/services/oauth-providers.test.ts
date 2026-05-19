import { afterEach, describe, expect, it } from "bun:test";
import {
  buildAuthorizeUrl,
  clientCredentials,
  oauthByKind,
} from "./oauth-providers";

describe("oauth-providers", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("AGORA_") && k.endsWith("_CLIENT_ID")) delete process.env[k];
      if (k.startsWith("AGORA_") && k.endsWith("_CLIENT_SECRET")) delete process.env[k];
    }
    Object.assign(process.env, ORIG);
  });

  it("clientCredentials returns null when env vars missing", () => {
    delete process.env.AGORA_LINEAR_CLIENT_ID;
    delete process.env.AGORA_LINEAR_CLIENT_SECRET;
    expect(clientCredentials("linear")).toBeNull();
  });

  it("clientCredentials returns the pair when both env vars set", () => {
    process.env.AGORA_GITHUB_CLIENT_ID = "abc";
    process.env.AGORA_GITHUB_CLIENT_SECRET = "xyz";
    expect(clientCredentials("github")).toEqual({ clientId: "abc", clientSecret: "xyz" });
  });

  it("buildAuthorizeUrl encodes client_id, redirect_uri, state, response_type", () => {
    const url = new URL(
      buildAuthorizeUrl("github", {
        clientId: "ID",
        redirectUri: "https://app.example.com/cb",
        state: "STATE",
      }),
    );
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("client_id")).toBe("ID");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("scope")).toBe("repo read:user");
  });

  it("buildAuthorizeUrl notion sets owner=user", () => {
    const url = new URL(
      buildAuthorizeUrl("notion", {
        clientId: "ID",
        redirectUri: "https://x/cb",
        state: "S",
      }),
    );
    expect(url.searchParams.get("owner")).toBe("user");
  });

  it("buildAuthorizeUrl omits scope when provider has no scopes (notion)", () => {
    const url = new URL(
      buildAuthorizeUrl("notion", {
        clientId: "ID",
        redirectUri: "https://x/cb",
        state: "S",
      }),
    );
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("Slack parseTokenResponse takes the bot token + authed_user.id", () => {
    const slack = oauthByKind.slack;
    const parsed = slack.parseTokenResponse?.({
      ok: true,
      access_token: "xoxb-bot",
      scope: "chat:write",
      authed_user: { id: "U123" },
      team: { name: "Agora" },
    });
    expect(parsed?.accessToken).toBe("xoxb-bot");
    expect(parsed?.accountId).toBe("U123");
    expect(parsed?.accountLabel).toBe("Slack: Agora");
    expect(parsed?.grantedScopes).toBe("chat:write");
  });

  it("Notion parseTokenResponse picks up workspace_name as account label", () => {
    const notion = oauthByKind.notion;
    const parsed = notion.parseTokenResponse?.({
      access_token: "secret_xxx",
      workspace_name: "My Notion",
    });
    expect(parsed?.accessToken).toBe("secret_xxx");
    expect(parsed?.accountLabel).toBe("My Notion");
  });

  it("standard parse handles refresh + expires_in (numeric or string)", () => {
    const linear = oauthByKind.linear;
    expect(linear.parseTokenResponse?.({ access_token: "a", refresh_token: "r", expires_in: 3600 }))
      .toEqual({
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 3600,
        grantedScopes: undefined,
      });
    expect(linear.parseTokenResponse?.({ access_token: "a", expires_in: "7200" }).expiresIn).toBe(
      7200,
    );
  });
});
