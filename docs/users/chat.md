# Chat

Chat is for one-off agent tasks that don't deserve an issue. Open a thread, send a message, the agent replies. No board, no status, no project — just you and the agent.

## When to use chat (vs an issue)

| Use chat when... | Use an issue when... |
|---|---|
| The task is throwaway. | The task is real work that needs tracking. |
| You want a quick answer. | The result needs review or follow-up. |
| The agent's output won't be referenced later. | Other people need to comment, label, or hand off. |

Rule of thumb: if you'd want to find this task in search next month, file an issue.

## Start a chat

1. Click **Chat** in the top nav (or `g c`).
2. Click **New chat**.
3. Pick the agent. Only agents in the current workspace are listed.
4. Optionally name the chat (auto-generated from the first message if you leave it blank).
5. Type your message and hit `Cmd/Ctrl+Enter`.

The message dispatches as a task on the agent's runtime. Response streams in if the underlying CLI supports streaming (Claude Code does); otherwise the reply appears once the task completes.

## Multi-turn

Each message in a chat is a new task that includes the prior turns as context. The agent's instructions and skills come along automatically.

> Long chats accumulate context. If a chat starts feeling slow or expensive, start a new one — the agent will be cheaper and faster.

## Sharing a chat

Click the **Share** menu on a chat → **Copy link**. Anyone with workspace access can read; only the chat creator can post.

## Deleting

Chat → **...** menu → **Delete**. This is permanent and removes all messages plus their underlying task records.

## Limits

- One in-flight task per chat at a time. Send a second message before the first reply lands and it queues.
- Chats don't fire autopilot triggers — they're a separate dispatch path.
