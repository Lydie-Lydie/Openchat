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
    process.stdout.write(`bot: ${ready.user.tag} (${ready.user.id})\n`);

    if (ready.guilds.cache.size === 0) {
      process.stdout.write(
        "\n아직 초대된 서버가 없습니다. 초대 URL로 봇을 서버에 추가하세요.\n",
      );
      await client.destroy();
      process.exit(0);
    }

    for (const guild of ready.guilds.cache.values()) {
      process.stdout.write(`\nguild: ${guild.name} (${guild.id})\n`);
      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (!channel) continue;
        if (
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement
        ) {
          process.stdout.write(`  #${channel.name} (${channel.id})\n`);
        }
      }
    }

    process.stdout.write(
      "\n본인 SELF_USER_ID는 Discord에서 본인 프로필 우클릭 → 사용자 ID 복사로 얻습니다.\n",
    );
    await client.destroy();
    process.exit(0);
  })().catch(async (error: unknown) => {
    process.stderr.write(`discover failed: ${String(error)}\n`);
    await client.destroy();
    process.exit(1);
  });
});

client.login(token).catch((error: unknown) => {
  process.stderr.write(`login failed: ${String(error)}\n`);
  process.exit(1);
});
