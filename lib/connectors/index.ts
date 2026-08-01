import {
  DiscordConnectorError,
  fetchDiscordChannel,
  formatDiscordTranscript,
} from "./discord";
import { decryptSecret, encryptSecret, maskToken } from "./credentials";
import { fetchSlackChannel, formatSlackTranscript, SlackConnectorError } from "./slack";
import type { ConnectorFetchResult, ConnectorKind } from "./types";

export type ConnectorInput =
  | { kind: "discord"; token: string; channelId: string; label?: string; limit?: number }
  | { kind: "slack"; token: string; channelId: string; label?: string; workspace?: string; limit?: number };

export async function fetchConnector(input: ConnectorInput): Promise<ConnectorFetchResult> {
  if (input.kind === "discord") {
    return fetchDiscordChannel({ token: input.token, channelId: input.channelId, limit: input.limit });
  }
  return fetchSlackChannel({
    token: input.token,
    channelId: input.channelId,
    limit: input.limit,
    workspace: input.workspace,
  });
}

export function formatConnectorTranscript(kind: ConnectorKind, result: ConnectorFetchResult): string {
  return kind === "discord" ? formatDiscordTranscript(result) : formatSlackTranscript(result);
}

export function defaultLabelFor(kind: ConnectorKind, result: ConnectorFetchResult): string {
  const prefix = kind === "discord" ? "Discord" : "Slack";
  const channel = result.channel.name;
  const ws = result.channel.workspace;
  return ws ? `${prefix} · ${ws} · #${channel}` : `${prefix} · #${channel}`;
}

export { DiscordConnectorError, SlackConnectorError };
export { encryptSecret, decryptSecret, maskToken };
export type { ConnectorFetchResult, ConnectorKind };
