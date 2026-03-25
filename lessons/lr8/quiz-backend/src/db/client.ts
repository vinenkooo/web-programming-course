import { PrismaClient } from "@prisma/client";

const slowQueryMs = Number(process.env.PRISMA_SLOW_QUERY_MS ?? 200);

export const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }, "warn", "error"],
});

prisma.$on("query", (event: any) => {
  if (event.duration >= slowQueryMs) {
    console.warn(`[prisma][slow-query] ${event.duration}ms`);
  }
});
