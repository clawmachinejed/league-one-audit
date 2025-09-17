export interface DiscordPort {
  postMessage(channelId: string, content: string): Promise<void>;
}
