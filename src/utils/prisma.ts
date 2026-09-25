import { PrismaClient } from "@prisma/client";

// Singleton so hot-reload (tsx watch) doesn't open a new connection pool per reload.
export const prisma = new PrismaClient();
