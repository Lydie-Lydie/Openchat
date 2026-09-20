import "dotenv/config";
import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  process.stderr.write("DISCORD_TOKEN is not set\n");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  void (async () => {
    for (const guild of ready.guilds.cache.values()) {
      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (!channel || channel.type !== ChannelType.GuildText) continue;
        if (!("messages" in channel)) continue;

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!messages) continue;

        const authors = new Map<string, { name: string; count: number; sample: string }>();
        for (const message of messages.values()) {
          if (message.author.bot) continue;
          const current = authors.get(message.author.id);
          authors.set(message.author.id, {
            name: message.author.username,
            count: (current?.count ?? 0) + 1,
            sample: current?.sample || message.content.slice(0, 40),
          });
        }

        if (authors.size === 0) continue;
        process.stdout.write(`\n#${channel.name} (${channel.id})\n`);
        for (const [id, info] of authors) {
          process.stdout.write(
            `  ${info.name} (${id}) messages=${info.count} sample="${info.sample}"\n`,
          );
        }
      }
    }
    await client.destroy();
    process.exit(0);
  })().catch(async (error: unknown) => {
    process.stderr.write(`authors failed: ${String(error)}\n`);
    await client.destroy();
    process.exit(1);
  });
});

client.login(token).catch((error: unknown) => {
  process.stderr.write(`login failed: ${String(error)}\n`);
  process.exit(1);
});
