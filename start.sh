#!/bin/sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required. Set it to your PostgreSQL connection string."
  exit 1
fi

echo "==> Using DATABASE_URL=${DATABASE_URL}"

echo "==> Running prisma db push (create/sync tables)..."
npx prisma db push --skip-generate --accept-data-loss 2>&1

if [ "${CLEAN_DEMO_DATA_ON_STARTUP:-true}" = "true" ]; then
  echo "==> Removing demo seed data if present..."
  npx tsx scripts/cleanup-demo-data.ts 2>&1 || true
fi

if [ "${AUTO_SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "==> Checking if demo seed data is needed..."
  node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count().then(c => {
    if (c === 0) {
      console.log('No users found — running demo seed...');
      process.exit(0);
    } else {
      console.log('Users exist (' + c + ') — skipping demo seed.');
      process.exit(1);
    }
  }).catch(() => process.exit(0)).finally(() => p.\$disconnect());
  " && npx tsx prisma/seed.ts 2>&1 || true
else
  echo "==> Demo seed disabled. Set AUTO_SEED_DEMO_DATA=true to load sample users/equipment."
fi

echo "==> Starting background sync worker..."
npx tsx scripts/sync-daemon.ts 2>&1 &
SYNC_DAEMON_PID=$!
sleep 2
if kill -0 "$SYNC_DAEMON_PID" 2>/dev/null; then
  echo "==> Background sync worker running as PID ${SYNC_DAEMON_PID}."
else
  echo "==> Background sync worker exited during startup. Check logs above for the sync-daemon error."
fi

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
