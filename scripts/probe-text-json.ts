import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const client = createOpencodeClient({
  baseUrl: process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096",
  throwOnError: false,
  responseStyle: "fields",
});

const model = process.env.OPENCODE_MODEL ?? "opencode-go/deepseek-v4.1-flash";
const [providerID, modelID] = model.split("/") as [string, string];

const SYSTEM = [
  "You decide whether the user would naturally send a short message in a Discord channel.",
  "Always write in Korean.",
  "It is fine to decide NOT to send anything.",
  "Respond with ONLY a single JSON object, no markdown, no explanation.",
  'Shape: {"should_send": boolean, "message": string, "reason": string}',
  "message is required only when should_send is true.",
].join(" ");

const PROMPT = [
  "현재 시각: 2026-09-18T09:00:00Z",
  "사용자 말투 요약: 짧은 반말, ㅇㅇ/ㅋㅋ 자주 씀, 이모지 거의 안 씀",
  "최근 채널 대화:",
  "[12:00] user: 오늘 날씨 진짜 좋다",
  "[12:03] friend: 그러니까 산책하기 좋더라",
  "판단하라.",
].join("\n");

const tryVariant = async (variant: string | undefined): Promise<void> => {
  const created = await client.session.create({
    title: "probe-text-json",
    model: { id: modelID, providerID, ...(variant ? { variant } : {}) },
  });
  const sessionId = created.data?.id;
  if (!sessionId) {
    process.stdout.write(`variant=${variant ?? "default"} create failed\n`);
    return;
  }

  const started = Date.now();
  const result = await client.session.prompt({
    sessionID: sessionId,
    model: { providerID, modelID },
    system: SYSTEM,
    ...(variant ? { variant } : {}),
    parts: [{ type: "text", text: PROMPT }],
  });

  const latency = Date.now() - started;
  const info = result.data?.info;
  const parts = result.data?.parts ?? [];
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as unknown as { text: string }).text)
    .join("")
    .trim();

  process.stdout.write(`\n--- variant=${variant ?? "default"} latency=${latency}ms ---\n`);
  process.stdout.write(`error=${JSON.stringify(info?.error)}\n`);
  process.stdout.write(`structured=${JSON.stringify(info?.structured)}\n`);
  process.stdout.write(`text=${JSON.stringify(text)}\n`);
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      process.stdout.write(`parsed=${JSON.stringify(JSON.parse(match[0]))}\n`);
    } catch (e) {
      process.stdout.write(`parse error=${String(e)}\n`);
    }
  }

  await client.session.delete({ sessionID: sessionId }).catch(() => undefined);
};

const main = async (): Promise<void> => {
  await tryVariant(undefined);
  await tryVariant("minimal");
  await tryVariant("non-thinking");
  await tryVariant("none");
};

main().catch((error) => {
  process.stderr.write(`probe failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
