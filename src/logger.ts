import { createRequire } from "node:module";
import { pino, type Logger } from "pino";

export type { Logger };

const require = createRequire(import.meta.url);

const hasPinoPretty = (): boolean => {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
};

export const createLogger = (level: string, nodeEnv: string): Logger => {
  const pretty = nodeEnv !== "production" && hasPinoPretty();
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          },
        }
      : {}),
  });
};
