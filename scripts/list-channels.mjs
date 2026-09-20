import "dotenv/config";
import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN missing");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  void (async () => {
    console.log(`bot: ${ready.user.tag}`);
    for (const guild of ready.guilds.cache.values()) {
      console.log(`\nguild: ${guild.name} (${guild.id})`);
      const channels = await guild.channels.fetch();
      const rows = [...channels.values()]
        .filter(Boolean)
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: ChannelType[c.type],
          parent: c.parent?.name ?? "",
        }))
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
      for (const r of rows) {
        console.log(`  [${r.type}] ${r.parent ? r.parent + " / " : ""}#${r.name} (${r.id})`);
      }
      const threads = await guild.channels.fetchActiveThreads().catch(() => null);
      if (threads && threads.threads.size > 0) {
        console.log("  -- active threads --");
        for (const t of threads.threads.values()) {
          console.log(`  [Thread] #${t.name} (${t.id}) parent=${t.parentId}`);
        }
      }
    }
    await client.destroy();
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
});

client.login(token).catch((e) => {
  console.error(e);
  process.exit(1);
});
