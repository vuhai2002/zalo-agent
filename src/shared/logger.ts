import pino from "pino";
import { ensureUtf8Console } from "./console-encoding.js";

// Phải chạy trước khi có output đầu tiên, nếu không log tiếng Việt bị vỡ trên Windows
ensureUtf8Console();

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export const createLogger = (scope: string) => logger.child({ scope });
