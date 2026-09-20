import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const client = createOpencodeClient({
  baseUrl: process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096",
  throwOnError: false,
  responseStyle: "fields",
});

const model = process.env.OPENCODE_MODEL ?? "opencode-go/deepseek-v4.1-flash";
const [providerID, modelID] = model.split("/") as [string, string];

const schema = {
  type: "object",
  properties: {
    should_send: { type: "boolean" },
    message: { type: "string" },
    reason: { type: "string" },
  },
  required: ["should_send"],
};

const main = async (): Promise<void> => {
  const created = await client.session.create({
    title: "probe",
    model: { id: modelID, providerID },
  });
  const sessionId = created.data?.id;
  process.stdout.write(
    `session=${sessionId} createError=${JSON.stringify(created.error)}\n`,
  );
  if (!sessionId) return;

  const result = await client.session.prompt({
    sessionID: sessionId,
    model: { providerID, modelID },
    format: { type: "json_schema", schema, retryCount: 2 },
    parts: [
      {
        type: "text",
        text: "지금 디스코드 채널에 짧은 말을 보낼지 판단해서 JSON으로만 답해. 보낸다면 message에 한국어 한 문장.",
      },
    ],
  });

  process.stdout.write(`has data: ${result.data !== undefined}\n`);
  if (result.error) {
    process.stdout.write(`error: ${JSON.stringify(result.error, null, 2)}\n`);
  }
  if (result.data) {
    process.stdout.write(`info.error: ${JSON.stringify(result.data.info.error, null, 2)}\n`);
    process.stdout.write(`structured: ${JSON.stringify(result.data.info.structured)}\n`);
    process.stdout.write(`parts: ${JSON.stringify(result.data.parts, null, 2)}\n`);
  }

  await client.session.delete({ sessionID: sessionId }).catch(() => undefined);
};

main().catch((error) => {
  process.stderr.write(`probe failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
