import type { DiscordPort } from "@l1/ports";
export function createNoopDiscord(): DiscordPort {
  return {
    async postMessage(_channelId: string, _content: string) {
      /* no-op */
    },
  };
}
