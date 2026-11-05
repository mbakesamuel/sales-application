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

export async function checkPrismaConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 AS connected`;
    return true;
  } catch (err) {
    console.error("Prisma connection check failed:", err);
    return false;
  }
}
