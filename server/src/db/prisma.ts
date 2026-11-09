import { PrismaClient } from "@prisma/client";
import { loadDbConfig } from "./config.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const { databaseUrl } = loadDbConfig();
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
    log: process.env.PRISMA_LOG === "1" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function checkPrismaConnection(
  timeoutMs = 4_000,
): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1 AS connected`,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Prisma health check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch (err) {
    console.error("Prisma connection check failed:", err);
    return false;
  }
}
