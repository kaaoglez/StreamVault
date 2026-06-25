import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// IMPORTANT: Do NOT override datasourceUrl here.
// Let Prisma Client read from .env (DATABASE_URL=file:./db/custom.db)
// so it uses the SAME database file as `prisma db push`.
// Overriding with path.join(process.cwd(), ...) can resolve differently
// (especially on Windows with spaces in the path), causing schema mismatches.

export const db =
  globalForPrisma.prisma ??
  new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db