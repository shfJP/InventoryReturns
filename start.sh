#!/bin/sh
set -e

echo "==> Running prisma db push (create/sync tables)..."
npx prisma db push --skip-generate --accept-data-loss 2>&1

echo "==> Checking if seed data is needed..."
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(c => {
  if (c === 0) {
    console.log('No users found — running seed...');
    process.exit(0);
  } else {
    console.log('Users exist (' + c + ') — skipping seed.');
    process.exit(1);
  }
}).catch(() => process.exit(0)).finally(() => p.\$disconnect());
" && npx tsx prisma/seed.ts 2>&1 || true

echo "==> Starting Next.js..."
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

if [ -f ".next/standalone/server.js" ]; then
  mkdir -p .next/standalone/.next
  if [ -d ".next/static" ] && [ ! -d ".next/standalone/.next/static" ]; then
    cp -R .next/static .next/standalone/.next/static
  fi
  if [ -d "public" ] && [ ! -d ".next/standalone/public" ]; then
    cp -R public .next/standalone/public
  fi
  exec node .next/standalone/server.js
fi

exec npm run start -- -H "$HOSTNAME" -p "$PORT"
