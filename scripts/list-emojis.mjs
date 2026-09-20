import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN missing");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  void (async () => {
    for (const guild of ready.guilds.cache.values()) {
      const emojis = await guild.emojis.fetch().catch(() => null);
      console.log(`\nguild: ${guild.name} (${guild.id})`);
      if (!emojis || emojis.size === 0) {
        console.log("  (커스텀 이모지 없음)");
        continue;
      }
      console.log(`  count: ${emojis.size}`);
      for (const e of emojis.values()) {
        const token = e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
        console.log(`  ${token}  name=${e.name} id=${e.id} animated=${e.animated}`);
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
