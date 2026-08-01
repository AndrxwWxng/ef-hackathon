import type { ConnectorChannelMeta, ConnectorFetchResult, ConnectorMessage } from "./types";

const SLACK_API = "https://slack.com/api";
const MAX_MESSAGES = 100;

export class SlackConnectorError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SlackConnectorError";
    this.status = status;
  }
}

type SlackMessage = {
  type?: string;
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

type SlackHistoryResponse = {
  ok: boolean;
  error?: string;
  warning?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

type SlackChannelInfo = {
  ok: boolean;
  error?: string;
  channel?: {
    id: string;
    name?: string;
    topic?: { value?: string };
    purpose?: { value?: string };
    num_members?: number;
  };
};

type SlackUser = {
  ok: boolean;
  error?: string;
  user?: { id: string; name?: string; real_name?: string; profile?: { display_name?: string } };
};

async function slackFetch<T>(
  method: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const search = new URLSearchParams(params);
  const res = await fetch(`${SLACK_API}/${method}?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new SlackConnectorError(`Slack API ${method} failed: ${res.status} ${res.statusText}`, res.status);
  }
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (json && typeof json === "object" && "ok" in json && json.ok === false) {
    throw new SlackConnectorError(`Slack ${method} returned error: ${json.error ?? "unknown"}`);
  }
  return json;
}

const userCache = new Map<string, string>();

async function resolveUserName(userId: string, token: string): Promise<string> {
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const res = await slackFetch<SlackUser>("users.info", { user: userId }, token);
    const u = res.user;
    const name = u?.profile?.display_name || u?.real_name || u?.name || userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export async function fetchSlackChannel(args: {
  token: string;
  channelId: string;
  limit?: number;
  workspace?: string;
}): Promise<ConnectorFetchResult> {
  const token = args.token.trim();
  const channelId = args.channelId.trim();
  if (!token) throw new SlackConnectorError("Slack bot token is required");
  if (!channelId) throw new SlackConnectorError("Slack channel id is required");
  if (!/^[CGD][A-Z0-9]{8,}$/.test(channelId)) {
    throw new SlackConnectorError("Slack channel id should look like C0123ABCD (public), G0123ABCD (private), or D0123ABCD (DM)");
  }

  const limit = String(Math.min(MAX_MESSAGES, Math.max(1, args.limit ?? 50)));

  const history = await slackFetch<SlackHistoryResponse>(
    "conversations.history",
    { channel: channelId, limit },
    token,
  );

  const info = await slackFetch<SlackChannelInfo>("conversations.info", { channel: channelId }, token);

  const rawMessages = history.messages ?? [];
  const messages: ConnectorMessage[] = [];
  for (const raw of rawMessages) {
    const text = (raw.text ?? "").trim();
    if (!text) continue;
    const author = raw.user ? await resolveUserName(raw.user, token) : raw.bot_id ? "bot" : "unknown";
    messages.push({
      id: raw.ts ?? `${messages.length}`,
      author,
      text,
      timestamp: raw.ts ? new Date(Number.parseFloat(raw.ts) * 1000).toISOString() : new Date().toISOString(),
    });
  }
  messages.reverse();

  const channelInfo = info.channel;
  const meta: ConnectorChannelMeta = {
    id: channelInfo?.id ?? channelId,
    name: channelInfo?.name ?? channelId,
    workspace: args.workspace,
    memberCount: channelInfo?.num_members,
    topic: channelInfo?.topic?.value || channelInfo?.purpose?.value || undefined,
  };

  return {
    channel: meta,
    messages,
    fetchedAt: new Date().toISOString(),
    truncated: rawMessages.length >= Number(limit),
  };
}

export function formatSlackTranscript(result: ConnectorFetchResult): string {
  const header = [
    `Channel: #${result.channel.name}`,
    result.channel.workspace ? `Workspace: ${result.channel.workspace}` : null,
    result.channel.topic ? `Topic: ${result.channel.topic}` : null,
    `${result.messages.length} message${result.messages.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const body = result.messages
    .map((m) => {
      const when = new Date(m.timestamp).toISOString();
      return `[${when}] ${m.author}: ${m.text}`;
    })
    .join("\n");
  return `${header}\n\n${body}`;
}
