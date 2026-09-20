import "dotenv/config";

const PERMISSIONS: Record<string, bigint> = {
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  ReadMessageHistory: 1n << 16n,
  CreatePublicThreads: 1n << 34n,
  SendMessagesInThreads: 1n << 38n,
};

const appId = process.argv[2] ?? process.env.DISCORD_APP_ID;
if (!appId) {
  process.stderr.write(
    "usage: npm run invite -- <application-id>  (or set DISCORD_APP_ID)\n",
  );
  process.exit(1);
}

let permissions = 0n;
for (const bit of Object.values(PERMISSIONS)) permissions |= bit;

const scope = encodeURIComponent("bot applications.commands");
const url =
  `https://discord.com/api/oauth2/authorize` +
  `?client_id=${appId}` +
  `&permissions=${permissions.toString()}` +
  `&scope=${scope}`;

process.stdout.write(
  [
    `application: ${appId}`,
    `permissions: ${permissions.toString()}`,
    `scopes:      bot, applications.commands`,
    `grants:      ${Object.keys(PERMISSIONS).join(", ")}`,
    "",
    url,
    "",
  ].join("\n"),
);
