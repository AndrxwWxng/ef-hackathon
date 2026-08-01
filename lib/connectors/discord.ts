import type { ConnectorChannelMeta, ConnectorFetchResult, ConnectorMessage } from "./types";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_MESSAGES = 100;

export class DiscordConnectorError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "DiscordConnectorError";
    this.status = status;
  }
}

type DiscordMessage = {
  id: string;
  content?: string;
  timestamp?: string;
  author?: { username?: string; global_name?: string };
  type?: number;
};

type DiscordChannel = {
  id: string;
  name?: string;
  topic?: string;
  guild_id?: string;
  recipient_ids?: string[];
  type?: number;
};

type DiscordGuild = {
  id: string;
  name?: string;
  member_count?: number;
};

function normalizeMessage(raw: DiscordMessage): ConnectorMessage | null {
  const text = (raw.content ?? "").trim();
  if (!text) return null;
  const author = raw.author?.global_name || raw.author?.username || "unknown";
  return {
    id: raw.id,
    author,
    text,
    timestamp: raw.timestamp ?? new Date().toISOString(),
  };
}

async function discordFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "MultimailBot (https://multimail.local, v1)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string; code?: number };
      if (body?.message) detail = `${detail} — ${body.message}`;
    } catch {
      // ignore
    }
    throw new DiscordConnectorError(`Discord API ${path} failed: ${detail}`, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchDiscordChannel(args: {
  token: string;
  channelId: string;
  limit?: number;
}): Promise<ConnectorFetchResult> {
  const token = args.token.trim();
  const channelId = args.channelId.trim();
  if (!token) throw new DiscordConnectorError("Discord bot token is required");
  if (!channelId) throw new DiscordConnectorError("Discord channel id is required");
  if (!/^\d{16,21}$/.test(channelId)) {
    throw new DiscordConnectorError("Discord channel id should be 17-21 digits");
  }

  const limit = Math.min(MAX_MESSAGES, Math.max(1, args.limit ?? 50));

  const channel = await discordFetch<DiscordChannel>(`/channels/${channelId}`, token);
  const rawMessages = await discordFetch<DiscordMessage[]>(
    `/channels/${channelId}/messages?limit=${limit}`,
    token,
  );

  const messages = rawMessages
    .map(normalizeMessage)
    .filter((m): m is ConnectorMessage => Boolean(m))
    .reverse();

  let workspace: string | undefined;
  let memberCount: number | undefined;
  if (channel.guild_id) {
    try {
      const guild = await discordFetch<DiscordGuild>(`/guilds/${channel.guild_id}`, token);
      workspace = guild.name;
      memberCount = guild.member_count;
    } catch {
      workspace = undefined;
    }
  }

  const meta: ConnectorChannelMeta = {
    id: channel.id,
    name: channel.name ?? channelId,
    workspace,
    memberCount,
    topic: channel.topic || undefined,
  };

  return {
    channel: meta,
    messages,
    fetchedAt: new Date().toISOString(),
    truncated: rawMessages.length >= limit,
  };
}

export function formatDiscordTranscript(result: ConnectorFetchResult): string {
  const header = [
    `Channel: #${result.channel.name}`,
    result.channel.workspace ? `Server: ${result.channel.workspace}` : null,
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
