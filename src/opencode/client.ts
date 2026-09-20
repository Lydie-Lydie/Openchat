import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OutputFormat } from "@opencode-ai/sdk/v2";
import type { Logger } from "../logger.js";

export type TokenUsage = {
  readonly input: number;
  readonly output: number;
  readonly cost: number;
};

export type GenerateInput = {
  readonly prompt: string;
  readonly model: string;
  readonly system?: string;
  readonly format?: OutputFormat;
  readonly tools?: Record<string, boolean>;
  readonly agent?: string;
};

export type GenerateResult = {
  readonly text: string;
  readonly structured: unknown;
  readonly usage: TokenUsage | undefined;
  readonly latencyMs: number;
  readonly errorName: string | undefined;
};

export type OpenCodeGateway = {
  readonly raw: OpencodeClient;
  health(): Promise<{ healthy: boolean; version: string }>;
  generate(input: GenerateInput): Promise<GenerateResult>;
  close(): void;
};

export type OpenCodeOptions = {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string | undefined;
  readonly timeoutMs: number;
  readonly sessionTitle: string;
  readonly logger: Logger;
};

export const parseModel = (model: string): { providerID: string; modelID: string } => {
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) {
    throw new Error(`Invalid model identifier "${model}", expected "provider/model"`);
  }
  return { providerID: model.slice(0, index), modelID: model.slice(index + 1) };
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (typeof data === "object" && data !== null && "message" in data) {
      return String((data as { message: unknown }).message);
    }
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
    // fall through to String()
  }
  return String(error);
};

const extractText = (parts: readonly { type: string }[]): string =>
  parts
    .filter((part) => part.type === "text")
    .map((part) => (part as unknown as { text: string }).text)
    .join("")
    .trim();

export const createOpenCodeGateway = (options: OpenCodeOptions): OpenCodeGateway => {
  const headers: Record<string, string> = {};
  if (options.password) {
    const token = Buffer.from(
      `${options.username}:${options.password}`,
      "utf8",
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  const client = createOpencodeClient({
    baseUrl: options.baseUrl,
    headers,
  });

  return {
    raw: client,

    async health() {
      const result = await client.global.health();
      if (result.error) throw new Error(describeError(result.error));
      return { healthy: result.data.healthy, version: result.data.version };
    },

    async generate(input) {
      const started = Date.now();
      const parsed = parseModel(input.model);

      const created = await client.session.create({
        title: options.sessionTitle,
        model: { id: parsed.modelID, providerID: parsed.providerID },
      });
      if (created.error) throw new Error(describeError(created.error));
      const sessionId = created.data.id;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);

      try {
        const response = await client.session.prompt(
          {
            sessionID: sessionId,
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
            parts: [{ type: "text", text: input.prompt }],
            ...(input.system !== undefined ? { system: input.system } : {}),
            ...(input.format !== undefined ? { format: input.format } : {}),
            ...(input.tools !== undefined ? { tools: input.tools } : {}),
            ...(input.agent !== undefined ? { agent: input.agent } : {}),
          },
          { signal: controller.signal },
        );

        if (response.error) throw new Error(describeError(response.error));

        const info = response.data.info;
        const usage: TokenUsage | undefined =
          info.tokens !== undefined
            ? { input: info.tokens.input, output: info.tokens.output, cost: info.cost }
            : undefined;

        return {
          text: extractText(response.data.parts),
          structured: info.structured,
          usage,
          latencyMs: Date.now() - started,
          errorName: info.error?.name,
        };
      } finally {
        clearTimeout(timer);
        try {
          await client.session.delete({ sessionID: sessionId });
        } catch (error) {
          options.logger.warn(
            { sessionId, error: String(error) },
            "failed to delete opencode session",
          );
        }
      }
    },

    close() {
      options.logger.debug("opencode gateway closed");
    },
  };
};
