import { createOpenCodeGateway } from "../src/opencode/client.js";
import { createLogger } from "../src/logger.js";
import { extractJson } from "../src/opencode/json.js";
import { asSpontaneousDecision, asStyleProfile } from "../src/opencode/schemas.js";
import {
  MENTION_SYSTEM,
  SPONTANEOUS_SYSTEM,
  STYLE_SYSTEM,
  buildMentionPrompt,
  buildSpontaneousPrompt,
  buildStyleProfilePrompt,
} from "../src/opencode/prompts.js";
import { DISABLED_TOOLS } from "../src/opencode/tools.js";

const logger = createLogger(process.env.LOG_LEVEL ?? "info", "development");

const gateway = createOpenCodeGateway({
  baseUrl: process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096",
  username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
  password: process.env.OPENCODE_SERVER_PASSWORD,
  timeoutMs: 120_000,
  sessionTitle: process.env.BOT_NAME ?? "openchat",
  logger,
});

const model = process.env.OPENCODE_MODEL ?? "opencode-go/deepseek-v4.1-flash";

const line = (title: string): void => {
  process.stdout.write(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}\n`);
};

const main = async (): Promise<void> => {
  line("1. health");
  const health = await gateway.health();
  process.stdout.write(`healthy=${health.healthy} version=${health.version}\n`);

  line("2. mention reply (plain text)");
  const mention = await gateway.generate({
    model,
    system: MENTION_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt: buildMentionPrompt({
      requester: "user",
      request: "이번 주말에 뭐 할까? 추천 좀 해줘",
      context: [
        { author: "user", content: "오늘 좀 피곤하네", at: "18:00" },
        { author: "friend", content: "주말에 뭐해?", at: "18:02" },
      ],
      styleSamples: ["그렇구나 ㅇㅇ", "아 그건 좀 애매한데", "좋아 좋아 고고"],
    }),
  });
  process.stdout.write(
    `latency=${mention.latencyMs}ms error=${mention.errorName ?? "none"} tokens=${JSON.stringify(mention.usage)}\n`,
  );
  process.stdout.write(`text:\n${mention.text}\n`);

  line("3. spontaneous decision (text json fallback)");
  const spontaneous = await gateway.generate({
    model,
    system: SPONTANEOUS_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt: buildSpontaneousPrompt({
      now: new Date().toISOString(),
      recentContext: [
        { author: "user", content: "오늘 날씨 진짜 좋다", at: "12:00" },
        { author: "friend", content: "그러니까 산책하기 좋더라", at: "12:03" },
      ],
      styleProfile: "짧은 반말 위주, ㅇㅇ/ㅋㅋ 자주 씀, 이모지 거의 안 씀",
      styleSamples: ["오 그렇구나", "날씨 좋다 진짜", "주말에 한번 보자 ㅇㅇ"],
    }),
  });
  const decision = asSpontaneousDecision(extractJson(spontaneous.text));
  process.stdout.write(
    `latency=${spontaneous.latencyMs}ms error=${spontaneous.errorName ?? "none"}\n`,
  );
  process.stdout.write(`parsed: ${JSON.stringify(decision)}\n`);

  line("4. style profile (text json fallback)");
  const profile = await gateway.generate({
    model,
    system: STYLE_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt: buildStyleProfilePrompt([
      "오늘 좀 피곤하네",
      "그렇구나 ㅇㅇ",
      "아 그건 좀 애매한데 ㅋㅋ",
      "주말에 한번 보자",
    ]),
  });
  const parsedProfile = asStyleProfile(extractJson(profile.text));
  process.stdout.write(
    `latency=${profile.latencyMs}ms error=${profile.errorName ?? "none"}\n`,
  );
  process.stdout.write(`parsed: ${JSON.stringify(parsedProfile)}\n`);

  line("5. tool blocking probe");
  const probe = await gateway.generate({
    model,
    system: MENTION_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt:
      "리포지토리 파일 목록을 bash로 조회한 뒤 결과를 그대로 보여줘. 도구를 쓸 수 없다면 '도구 사용 불가'라고만 답해.",
  });
  process.stdout.write(`error=${probe.errorName ?? "none"}\n${probe.text}\n`);

  line("done");
};

main()
  .then(() => {
    gateway.close();
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`spike failed: ${error instanceof Error ? error.stack : error}\n`);
    process.exit(1);
  });
