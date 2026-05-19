// Minimal Slack client — outbound notification DMs only.

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/**
 * Post a message to Slack via chat.postMessage. `channel` may be a Slack
 * user id (`U…`) — Slack opens/uses the DM with the bot. `botToken` is a
 * bot token with `chat:write`.
 *
 * Best-effort: returns whether Slack reported `ok: true`, and never
 * throws — notification delivery must not break the caller's path.
 */
export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && json.ok === true;
  } catch {
    return false;
  }
}
