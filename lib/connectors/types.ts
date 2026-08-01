export type ConnectorKind = "discord" | "slack";

export type ConnectorMessage = {
  id: string;
  author: string;
  text: string;
  timestamp: string;
};

export type ConnectorChannelMeta = {
  id: string;
  name: string;
  workspace?: string;
  memberCount?: number;
  topic?: string;
};

export type ConnectorFetchResult = {
  channel: ConnectorChannelMeta;
  messages: ConnectorMessage[];
  fetchedAt: string;
  truncated: boolean;
};
