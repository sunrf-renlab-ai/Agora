import type { ServerWebSocket } from "bun";
import { createBunWebSocket } from "hono/bun";

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

export { upgradeWebSocket, websocket };
