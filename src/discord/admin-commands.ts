import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { RuntimeState } from "../state.js";
import {
  allChannelSettings,
  apiUsageToday,
  deleteAllGenerated,
  deleteSelfMessages,
  deleteStyleProfile,
  deleteUserAlias,
  getChannelSettings,
  getUserAlias,
  messageStats,
  selfMessageCount,
  selfMessagesByGuild,
  setUserAlias,
  spontaneousChannelIds,
  upsertChannelSettings,
} from "../db/queries.js";
import { formatDateTime } from "../util/time.js";
import { purgeSecretMessages } from "../jobs/redact.js";
import { reactionCacheSize } from "./reactions.js";
import type { SpontaneousOutcome } from "../spontaneous/generator.js";
import { normalizeAlias } from "./alias.js";

export type AdminCommands = {
  register(client: Client): Promise<void>;
  handle(interaction: ChatInputCommandInteraction): Promise<void>;
};

const buildCommand = (styleLearningEnabled: boolean, commandName: string) => {
  const builder = new SlashCommandBuilder()
    .setName(commandName)
    .setDescription(`${commandName} 봇 관리`)
    .addSubcommand((s) => s.setName("status").setDescription("현재 상태를 확인합니다"))
    .addSubcommand((s) => s.setName("pause").setDescription("자동 발화를 중지합니다"))
    .addSubcommand((s) => s.setName("resume").setDescription("자동 발화를 재개합니다"))
    .addSubcommand((s) =>
      s
        .setName("enable-channel")
        .setDescription("채널의 수집과 자동 발화를 모두 켭니다 (개별 설정은 set-channel)")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("대상 채널 (포럼 포함, 선택)")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildMedia,
            )
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName("channel_id")
            .setDescription("채널 ID (목록에 포럼이 안 보일 때 사용)")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("disable-channel")
        .setDescription("채널의 수집과 자동 발화를 모두 끕니다 (개별 설정은 set-channel)")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("대상 채널 (포럼 포함, 선택)")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildMedia,
            )
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName("channel_id")
            .setDescription("채널 ID (목록에 포럼이 안 보일 때 사용)")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("set-interval")
        .setDescription("자동 발화 최소 간격(분)을 설정합니다")
        .addIntegerOption((o) =>
          o.setName("minutes").setDescription("최소 간격(분)").setMinValue(10).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("set-channel")
        .setDescription("채널의 수집/자동 발화를 개별로 켜거나 끕니다")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("대상 채널 (포럼 포함, 선택)")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildMedia,
            )
            .setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("channel_id").setDescription("채널 ID (선택)").setRequired(false),
        )
        .addBooleanOption((o) =>
          o.setName("collector").setDescription("메시지 수집 (미지정 시 유지)").setRequired(false),
        )
        .addBooleanOption((o) =>
          o.setName("spontaneous").setDescription("자동 발화 (미지정 시 유지)").setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName("channels").setDescription("채널별 수집/자동 발화 설정을 봅니다"),
    )
    .addSubcommand((s) =>
      s
        .setName("dryrun")
        .setDescription("드라이런 모드를 켜거나 끕니다")
        .addBooleanOption((o) => o.setName("enabled").setDescription("켬/끔").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("forget")
        .setDescription("저장된 내 메시지와 생성 기록을 삭제합니다")
        .addBooleanOption((o) =>
          o.setName("confirm").setDescription("정말 삭제하려면 true").setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName("tick").setDescription("자동 발화를 지금 즉시 한 번 실행합니다"))
    .addSubcommand((s) =>
      s.setName("purge-sensitive").setDescription("저장된 메시지 중 비밀정보가 포함된 것을 삭제합니다"),
    )
    .addSubcommand((s) =>
      s.setName("refresh-emojis").setDescription("서버 커스텀 이모지 목록을 새로고침합니다."),
    )
    .addSubcommand((s) =>
      s
        .setName("callme")
        .setDescription("봇이 나를 부르는 호칭을 설정합니다. (값을 비우면 초기화)")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("새 호칭 (최대 32자). 비우면 설정을 초기화합니다.")
            .setMaxLength(32)
            .setRequired(false),
        ),
    );

  // Style-learning commands are hidden entirely while learning is disabled.
  if (styleLearningEnabled) {
    builder
      .addSubcommand((s) => s.setName("rebuild-memory").setDescription("말투 프로필을 재생성합니다"))
      .addSubcommand((s) =>
        s.setName("reset-memory").setDescription("말투 프로필을 삭제한 뒤 다시 생성합니다"),
      )
      .addSubcommand((s) =>
        s.setName("style-guilds").setDescription("말투 참조 서버와 서버별 메시지 수를 보여줍니다"),
      );
  }

  return builder.toJSON();
};

const resolveTargetChannelId = (
  interaction: ChatInputCommandInteraction,
): string | undefined => {
  const channel = interaction.options.getChannel("channel");
  if (channel) return channel.id;
  const raw = interaction.options.getString("channel_id")?.trim();
  if (raw && /^\d{5,25}$/u.test(raw)) return raw;
  return undefined;
};

export const createAdminCommands = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly state: RuntimeState;
  readonly rebuildStyleProfile: (force?: boolean) => Promise<void>;
  readonly runSpontaneousOnce: (
    force?: boolean,
    channelIds?: readonly string[],
  ) => Promise<SpontaneousOutcome[]>;
  readonly refreshEmojis: () => Promise<{ guildId: string; count: number }[]>;
}): AdminCommands => {
  const {
    config,
    db,
    logger,
    state,
    rebuildStyleProfile,
    runSpontaneousOnce,
    refreshEmojis,
  } = deps;

  const command = buildCommand(config.runtime.styleLearningEnabled, config.commandName);

  const isAdmin = (interaction: ChatInputCommandInteraction): boolean =>
    config.discord.adminUserIds.includes(interaction.user.id);

  return {
    async register(client) {
      if (!client.application) return;
      const joined = [...client.guilds.cache.keys()];
      const targets =
        config.discord.allowedGuildIds.length > 0
          ? joined.filter((id) => config.discord.allowedGuildIds.includes(id))
          : joined;
      if (targets.length === 0) {
        await client.application.commands.set([command]);
        logger.info("registered slash commands (global)");
        return;
      }
      for (const guildId of targets) {
        await client.application.commands.set([command], guildId);
      }
      logger.info({ guilds: targets.length }, "registered slash commands");
    },

    async handle(interaction) {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== config.commandName) return;

      const sub = interaction.options.getSubcommand();

      // `callme` is available to everyone; every other subcommand is admin-only.
      if (sub !== "callme" && !isAdmin(interaction)) {
        await interaction.reply({
          content: "권한이 없습니다.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Acknowledge immediately: several subcommands touch the DB or OpenCode and can
      // exceed Discord's 3s interaction window (which surfaces as 10062 Unknown interaction).
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        switch (sub) {
          case "status": {
            const stats = messageStats(db);
            const usage = apiUsageToday(db);
            const lines = [
              `드라이런(전체 발신): ${state.dryRun ? "ON" : "OFF"}`,
              `자동 발화 일시중지: ${state.spontaneousPaused ? "ON" : "OFF"}`,
              `자동 발화 기능: ${config.spontaneous.enabled ? "ON" : "OFF"}`,
              `말투 학습: ${config.runtime.styleLearningEnabled ? "ON" : "OFF"}`,
              `웹 검색: ${config.discord.searchEnabled ? "ON (egress 필터 필요)" : "OFF"}`,
              `반응 캐시: ${reactionCacheSize()}개 메시지`,
              `모델: ${config.opencode.models.default}`,
              `수집 메시지: 총 ${stats.total} (본인 ${stats.self}, 채널 ${stats.channels})`,
              `오늘 API 호출: ${usage.calls}건, 실패 ${usage.failures}건, 비용 $${usage.cost.toFixed(4)}`,
              `평균 지연: ${usage.avgLatencyMs}ms`,
              `마지막 tick: ${state.lastTickAt ? formatDateTime(new Date(state.lastTickAt)) : "없음"}`,
            ];
            await interaction.editReply({ content: lines.join("\n") });
            return;
          }
          case "pause": {
            state.spontaneousPaused = true;
            await interaction.editReply({ content: "자동 발화를 중지했습니다." });
            return;
          }
          case "resume": {
            state.spontaneousPaused = false;
            await interaction.editReply({ content: "자동 발화를 재개했습니다." });
            return;
          }
          case "enable-channel": {
            const channelId = resolveTargetChannelId(interaction);
            if (!channelId) {
              await interaction.editReply({
                content: "채널을 선택하거나 channel_id를 입력하세요.",
              });
              return;
            }
            upsertChannelSettings(db, channelId, {
              collector_enabled: 1,
              spontaneous_enabled: 1,
            });
            await interaction.editReply({
              content: `<#${channelId}> 채널을 활성화했습니다.`,
            });
            return;
          }
          case "disable-channel": {
            const channelId = resolveTargetChannelId(interaction);
            if (!channelId) {
              await interaction.editReply({
                content: "채널을 선택하거나 channel_id를 입력하세요.",
              });
              return;
            }
            upsertChannelSettings(db, channelId, {
              collector_enabled: 0,
              spontaneous_enabled: 0,
            });
            await interaction.editReply({
              content: `<#${channelId}> 채널을 비활성화했습니다.`,
            });
            return;
          }
          case "set-interval": {
            const minutes = interaction.options.getInteger("minutes", true);
            const targets = new Set<string>(config.channels.spontaneousIds);
            for (const id of spontaneousChannelIds(db)) targets.add(id);
            for (const channelId of targets) {
              upsertChannelSettings(db, channelId, { min_interval_sec: minutes * 60 });
            }
            await interaction.editReply({
              content: `최소 간격을 ${minutes}분으로 설정했습니다. (대상 ${targets.size}개)`,
            });
            return;
          }
          case "dryrun": {
            const enabled = interaction.options.getBoolean("enabled", true);
            state.dryRun = enabled;
            await interaction.editReply({
              content: `드라이런 모드를 ${enabled ? "켰습니다" : "껐습니다"}.`,
            });
            return;
          }
          case "forget": {
            const confirm = interaction.options.getBoolean("confirm", true);
            if (!confirm) {
              await interaction.editReply({ content: "취소했습니다." });
              return;
            }
            const removedMessages = deleteSelfMessages(db);
            const removedGenerated = deleteAllGenerated(db);
            await interaction.editReply({
              content: `메시지 ${removedMessages}건, 생성 기록 ${removedGenerated}건을 삭제했습니다.`,
            });
            return;
          }
          case "rebuild-memory": {
            if (!config.runtime.styleLearningEnabled) {
              await interaction.editReply({
                content: "말투 학습 기능이 비활성화되어 있습니다. (STYLE_LEARNING_ENABLED=false)",
              });
              return;
            }
            await rebuildStyleProfile(true);
            const count = selfMessageCount(db);
            await interaction.editReply({
              content: `말투 프로필을 재생성했습니다. (샘플 ${count}건 기반)`,
            });
            return;
          }
          case "style-guilds": {
            if (!config.runtime.styleLearningEnabled) {
              await interaction.editReply({
                content: "말투 학습 기능이 비활성화되어 있습니다. (STYLE_LEARNING_ENABLED=false)",
              });
              return;
            }
            const guilds = selfMessagesByGuild(db).sort((a, b) => b.count - a.count);
            const format = (ids: readonly string[]): string =>
              ids.length > 0 ? ids.join(", ") : "(제한 없음 · 모든 서버)";
            const lines = [
              `말투 참조 서버 (STYLE_GUILD_IDS): ${format(config.discord.styleGuildIds)}`,
              `봇 동작 서버 (ALLOWED_GUILD_IDS): ${format(config.discord.allowedGuildIds)}`,
              "",
              "서버별 본인 메시지:",
              ...(guilds.length > 0
                ? guilds.map(
                    (g) => `  ${g.guildId ?? "(DM/미상)"}: 총 ${g.count}, 대화형 ${g.chatLike}`,
                  )
                : ["  (없음)"]),
              "",
              `다른 서버로 참조를 옮기려면 STYLE_GUILD_IDS를 바꾸고 재시작한 뒤 /${config.commandName} rebuild-memory 하세요.`,
            ];
            await interaction.editReply({ content: lines.join("\n") });
            return;
          }
          case "purge-sensitive": {
            const removed = purgeSecretMessages(db);
            await interaction.editReply({
              content: `비밀정보가 포함된 메시지 ${removed}건을 삭제했습니다.`,
            });
            return;
          }
          case "reset-memory": {
            if (!config.runtime.styleLearningEnabled) {
              await interaction.editReply({
                content: "말투 학습 기능이 비활성화되어 있습니다. (STYLE_LEARNING_ENABLED=false)",
              });
              return;
            }
            const removed = deleteStyleProfile(db);
            await rebuildStyleProfile(true);
            const emojiResults = await refreshEmojis();
            const count = selfMessageCount(db, {
              guildIds: config.discord.styleGuildIds,
              channelIds: config.discord.styleChannelIds,
            });
            const emojiLine = config.discord.emojiEnabled
              ? `이모지 새로고침: ${emojiResults.map((r) => `${r.guildId} ${r.count}개`).join(", ") || "없음"}`
              : "이모지: 비활성화";
            await interaction.editReply({
              content: [
                `말투 프로필을 초기화하고 재생성했습니다. (삭제 ${removed}건)`,
                `참조 범위: 길드 ${config.discord.styleGuildIds.length}개, 채널 ${config.discord.styleChannelIds.length}개`,
                `본인 메시지: ${count}건`,
                emojiLine,
              ].join("\n"),
            });
            return;
          }
          case "refresh-emojis": {
            const results = await refreshEmojis();
            await interaction.editReply({
              content:
                results.length > 0
                  ? results
                      .map((r) => `<${r.guildId}> 이모지 ${r.count}개로 새로고침`)
                      .join("\n")
                  : "새로고침할 서버가 없거나 이모지 기능이 비활성화되어 있습니다.",
            });
            return;
          }
          case "tick": {
            const outcomes = await runSpontaneousOnce(true, [interaction.channelId]);
            if (outcomes.length === 0) {
              await interaction.editReply({
                content: "실행할 채널이 없습니다. SPONTANEOUS_CHANNEL_IDS를 확인하세요.",
              });
              return;
            }
            const lines = outcomes.map((o) =>
              [
                `<#${o.channelId}> · ${o.status}`,
                o.message ? `문장: ${o.message}` : "",
                o.reason ? `이유: ${o.reason}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            );
            await interaction.editReply({
              content: [
                `자동 발화 1회 실행 (드라이런: ${state.dryRun ? "ON" : "OFF"})`,
                ...lines,
              ].join("\n\n"),
            });
            return;
          }
          case "callme": {
            const raw = interaction.options.getString("name");
            const previous = getUserAlias(db, interaction.user.id);

            if (raw === null || raw.trim().length === 0) {
              const removed = deleteUserAlias(db, interaction.user.id);
              await interaction.editReply({
                content:
                  removed > 0
                    ? "호칭을 초기화했습니다. 이제부터 Discord 사용자명으로 부를게."
                    : "설정된 호칭이 없습니다.",
              });
              logger.info({ userId: interaction.user.id, previous }, "cleared user alias");
              return;
            }

            const result = normalizeAlias(raw);
            if (!result.ok) {
              await interaction.editReply({ content: result.reason });
              return;
            }

            setUserAlias(db, interaction.user.id, result.alias);
            await interaction.editReply({
              content: `이제 이 서버에서 "${result.alias}"(이)라고 부를게.`,
            });
            logger.info({ userId: interaction.user.id, alias: result.alias }, "set user alias");
            return;
          }
          case "set-channel": {
            const channelId = resolveTargetChannelId(interaction);
            if (!channelId) {
              await interaction.editReply({
                content: "채널을 선택하거나 channel_id를 입력하세요.",
              });
              return;
            }
            const collector = interaction.options.getBoolean("collector");
            const spontaneous = interaction.options.getBoolean("spontaneous");
            if (collector === null && spontaneous === null) {
              await interaction.editReply({
                content: "collector 또는 spontaneous 중 하나는 지정해야 합니다.",
              });
              return;
            }
            const patch: { collector_enabled?: number; spontaneous_enabled?: number } = {};
            if (collector !== null) patch.collector_enabled = collector ? 1 : 0;
            if (spontaneous !== null) patch.spontaneous_enabled = spontaneous ? 1 : 0;
            upsertChannelSettings(db, channelId, patch);
            const settings = getChannelSettings(db, channelId);
            await interaction.editReply({
              content: [
                `<#${channelId}> 설정을 변경했습니다.`,
                `수집(collector): ${settings?.collector_enabled ? "ON" : "OFF"}`,
                `자동 발화(spontaneous): ${settings?.spontaneous_enabled ? "ON" : "OFF"}`,
              ].join("\n"),
            });
            return;
          }
          case "channels": {
            const rows = allChannelSettings(db);
            if (rows.length === 0) {
              await interaction.editReply({ content: "설정된 채널이 없습니다." });
              return;
            }
            const lines = rows.map(
              (row) =>
                `<#${row.channel_id}> 수집:${row.collector_enabled ? "ON" : "OFF"} 자동발화:${
                  row.spontaneous_enabled ? "ON" : "OFF"
                }`,
            );
            await interaction.editReply({ content: lines.join("\n") });
            return;
          }
          default: {
            const settings = getChannelSettings(db, interaction.channelId);
            await interaction.editReply({
              content: `알 수 없는 명령입니다. (channelSettings=${settings ? "있음" : "없음"})`,
            });
          }
        }
      } catch (error) {
        logger.error({ error: String(error), sub }, "admin command failed");
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: "명령 처리 중 오류가 발생했습니다." }).catch(() => undefined);
        } else {
          await interaction
            .reply({ content: "명령 처리 중 오류가 발생했습니다.", flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        }
      }
    },
  };
};

