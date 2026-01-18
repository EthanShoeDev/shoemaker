#!/usr/bin/env bun
/**
 * Parity Test Runner
 *
 * Ensures both APIs are running, then runs tests against both to verify migration correctness.
 * Idempotent - checks if services are already running before starting them.
 *
 * Usage:
 *   bun scripts/parity-test.ts
 */
import { Command } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { CommandUtils } from '@shoe-box-tools/utils/cli-utils';
import { Data, Effect, Schedule } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';

const LEGACY_API_URL = 'http://localhost:8080';
const NEW_API_URL = 'http://localhost:3000';
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const LEGACY_DIR = path.join(ROOT_DIR, 'legacy');
const LEGACY_API_DIR = path.join(LEGACY_DIR, 'api');

// Tagged errors for proper Effect error handling
class ServiceStartError extends Data.TaggedError('ServiceStartError')<{
  service: string;
  cause: unknown;
}> {}

class ParityTestError extends Data.TaggedError('ParityTestError')<{
  test: string;
  api: string;
  cause: unknown;
}> {}

// Check if a port is responding
const isPortResponding = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 2000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        return res.ok || res.status < 500; // Any response means it's up
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

// Check if MongoDB container is running
const isMongoDBRunning = Effect.gen(function* () {
  const result = yield* CommandUtils.runString(
    Command.make(
      'docker',
      'compose',
      '-f',
      path.join(LEGACY_DIR, 'docker-compose.yml'),
      'ps',
      '--status=running',
      '-q',
    ),
  ).pipe(Effect.orElseSucceed(() => ''));
  return result.trim().length > 0;
});

// Start MongoDB via docker compose
const startMongoDB = Effect.gen(function* () {
  const running = yield* isMongoDBRunning;
  if (running) {
    yield* Effect.logInfo('MongoDB already running');
    return;
  }

  yield* Effect.logInfo('Starting MongoDB...');
  yield* CommandUtils.runCommandInheritWithLog(
    Command.make('docker', 'compose', 'up', '-d').pipe(
      Command.workingDirectory(LEGACY_DIR),
    ),
  );

  // Wait for MongoDB to be ready
  yield* Effect.logInfo('Waiting for MongoDB to be ready...');
  yield* Effect.sleep('2 seconds');
});

// Start legacy API
const startLegacyAPI = Effect.gen(function* () {
  const responding = yield* isPortResponding(`${LEGACY_API_URL}/api`);
  if (responding) {
    yield* Effect.logInfo('Legacy API already running on port 8080');
    return;
  }

  yield* Effect.logInfo('Starting Legacy API...');

  // Copy .env.local to api/.env
  const envLocal = path.join(LEGACY_DIR, '.env.local');
  const envTarget = path.join(LEGACY_API_DIR, '.env');
  fs.copyFileSync(envLocal, envTarget);

  // Install dependencies if node_modules doesn't exist
  const nodeModulesExists = fs.existsSync(
    path.join(LEGACY_API_DIR, 'node_modules'),
  );
  if (!nodeModulesExists) {
    yield* Effect.logInfo('Installing legacy API dependencies...');
    yield* CommandUtils.runCommandInheritWithLog(
      Command.make('npm', 'install').pipe(
        Command.workingDirectory(LEGACY_API_DIR),
      ),
    );
  }

  // Start API in background
  yield* Effect.logInfo('Starting legacy API in background...');
  const startCmd = Command.make('node', '--env-file=.env', 'index.js').pipe(
    Command.workingDirectory(LEGACY_API_DIR),
    Command.stdout('inherit'),
    Command.stderr('inherit'),
  );

  // Fork to background - we don't wait for it
  yield* Effect.forkDaemon(
    Effect.gen(function* () {
      yield* Command.exitCode(startCmd);
    }),
  );

  // Wait for API to respond
  yield* Effect.logInfo('Waiting for legacy API to be ready...');
  yield* isPortResponding(`${LEGACY_API_URL}/api`).pipe(
    Effect.filterOrFail(
      (ready) => ready,
      () => new ServiceStartError({ service: 'legacy-api', cause: 'timeout' }),
    ),
    Effect.retry(Schedule.recurs(10).pipe(Schedule.addDelay(() => '1 second'))),
  );
  yield* Effect.logInfo('Legacy API ready on port 8080');
});

// Start new API
const startNewAPI = Effect.gen(function* () {
  const responding = yield* isPortResponding(`${NEW_API_URL}/api/health`);
  if (responding) {
    yield* Effect.logInfo('New API already running on port 3000');
    return;
  }

  yield* Effect.logInfo('Starting New API...');

  // Start API in background
  const startCmd = Command.make('bun', 'run', 'apps/api/src/bin.ts').pipe(
    Command.workingDirectory(ROOT_DIR),
    Command.stdout('inherit'),
    Command.stderr('inherit'),
  );

  yield* Effect.forkDaemon(
    Effect.gen(function* () {
      yield* Command.exitCode(startCmd);
    }),
  );

  // Wait for API to respond
  yield* Effect.logInfo('Waiting for new API to be ready...');
  yield* isPortResponding(`${NEW_API_URL}/api/health`).pipe(
    Effect.filterOrFail(
      (ready) => ready,
      () => new ServiceStartError({ service: 'new-api', cause: 'timeout' }),
    ),
    Effect.retry(Schedule.recurs(10).pipe(Schedule.addDelay(() => '1 second'))),
  );
  yield* Effect.logInfo('New API ready on port 3000');
});

// Parity test definition
interface ParityTest {
  name: string;
  legacyPath: string;
  newPath: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

const parityTests: ParityTest[] = [
  // Add your parity tests here as you identify endpoints
  // Example:
  // { name: 'Get config', legacyPath: '/api/config/someConfig', newPath: '/api/config/someConfig' },
];

const runParityTest = (test: ParityTest) =>
  Effect.gen(function* () {
    const fetchEndpoint = (baseUrl: string, apiPath: string) =>
      Effect.tryPromise({
        try: async () => {
          const method = test.method ?? 'GET';
          const headers: HeadersInit = test.body
            ? { 'Content-Type': 'application/json' }
            : {};
          const body = test.body ? JSON.stringify(test.body) : null;
          const res = await fetch(`${baseUrl}${apiPath}`, {
            method,
            headers,
            body,
          });
          return { status: res.status, body: await res.text() };
        },
        catch: (e) =>
          new ParityTestError({ test: test.name, api: baseUrl, cause: e }),
      });

    const [legacyResult, newResult] = yield* Effect.all([
      fetchEndpoint(LEGACY_API_URL, test.legacyPath),
      fetchEndpoint(NEW_API_URL, test.newPath),
    ]);

    const match =
      legacyResult.status === newResult.status &&
      legacyResult.body === newResult.body;

    return { test: test.name, match, legacyResult, newResult };
  });

const runAllParityTests = Effect.gen(function* () {
  if (parityTests.length === 0) {
    yield* Effect.logWarning(
      'No parity tests defined yet. Add tests to the parityTests array.',
    );
    return;
  }

  yield* Effect.logInfo(`Running ${parityTests.length} parity tests...`);

  const results = yield* Effect.all(parityTests.map(runParityTest));

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.match) {
      yield* Effect.logInfo(`✓ ${result.test}`);
      passed++;
    } else {
      yield* Effect.logError(`✗ ${result.test}`);
      yield* Effect.logError(
        `  Legacy: ${result.legacyResult.status} - ${result.legacyResult.body.slice(0, 100)}`,
      );
      yield* Effect.logError(
        `  New:    ${result.newResult.status} - ${result.newResult.body.slice(0, 100)}`,
      );
      failed++;
    }
  }

  yield* Effect.logInfo(`\nResults: ${passed} passed, ${failed} failed`);
});

const program = Effect.gen(function* () {
  yield* Effect.logInfo('=== Parity Test Runner ===\n');

  // Ensure all services are running (idempotent)
  yield* Effect.logInfo('Checking services...\n');
  yield* startMongoDB;
  yield* startLegacyAPI;
  yield* startNewAPI;

  yield* Effect.logInfo('\n=== Running Parity Tests ===\n');
  yield* runAllParityTests;
});

program.pipe(
  Effect.provide(BunContext.layer),
  Effect.tapErrorCause(Effect.logError),
  BunRuntime.runMain,
);
