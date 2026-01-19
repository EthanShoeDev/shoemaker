/**
 * Demo of spanoptic - TUI OTEL visualizer for Effect programs.
 *
 * Run with: bun packages/spanoptic/src/demo.ts
 */

import { Effect } from 'effect';
import { traceVisualize } from './index.js';

// Helper for random delay with jitter (like visual-effect)
const randomDelay = (min: number, max: number) =>
  Effect.sleep(`${Math.floor(Math.random() * (max - min + 1)) + min} millis`);

// Simulated operations with realistic delays and logging
const fetchUser = Effect.gen(function* () {
  yield* Effect.log('Fetching user from database...');
  yield* Effect.annotateCurrentSpan('user.id', 1);
  yield* Effect.annotateCurrentSpan('user.role', 'admin');
  yield* randomDelay(300, 600);
  yield* Effect.log('User fetched successfully');
  return { id: 1, name: 'Alice' };
}).pipe(Effect.withSpan('fetchUser'));

const processData = Effect.gen(function* () {
  yield* Effect.log('Starting data processing');
  yield* randomDelay(200, 400);
  yield* Effect.logDebug('Processed 42 records');
  yield* Effect.log('Data processing complete');
}).pipe(Effect.withSpan('processData'));

const sendNotifications = Effect.gen(function* () {
  yield* Effect.log('Sending notifications to 3 users');
  yield* randomDelay(400, 800);
  yield* Effect.logInfo('Email sent to user@example.com');
  yield* Effect.logInfo('Push notification sent');
}).pipe(Effect.withSpan('sendNotifications'));

const updateCache = Effect.gen(function* () {
  yield* Effect.log('Invalidating cache entries');
  yield* randomDelay(150, 300);
  yield* Effect.logDebug('Cache key: user:1 invalidated');
}).pipe(Effect.withSpan('updateCache'));

const trackAnalytics = Effect.gen(function* () {
  yield* Effect.log('Recording analytics event');
  yield* randomDelay(200, 500);
  yield* Effect.logDebug('Event: page_view recorded');
}).pipe(Effect.withSpan('trackAnalytics'));

const connectToDatabase = Effect.gen(function* () {
  yield* Effect.log('Establishing database connection');
  yield* randomDelay(100, 200);
  yield* Effect.log('Connected to PostgreSQL');
}).pipe(Effect.withSpan('connectToDatabase'));

const queryUsers = Effect.gen(function* () {
  yield* Effect.log('Executing query: SELECT * FROM users');
  yield* Effect.annotateCurrentSpan('db.table', 'users');
  yield* Effect.annotateCurrentSpan('db.rows_returned', 42);
  yield* randomDelay(250, 500);
  yield* Effect.logDebug('Query returned 42 rows in 234ms');
}).pipe(Effect.withSpan('queryUsers'));

const queryOrders = Effect.gen(function* () {
  yield* Effect.log('Executing query: SELECT * FROM orders');
  yield* Effect.annotateCurrentSpan('db.table', 'orders');
  yield* Effect.annotateCurrentSpan('db.rows_returned', 156);
  yield* randomDelay(300, 600);
  yield* Effect.logDebug('Query returned 156 rows in 412ms');
  yield* Effect.logWarning('Large result set - consider pagination');
}).pipe(Effect.withSpan('queryOrders'));

const generateReport = Effect.gen(function* () {
  yield* Effect.log('Generating monthly report');
  yield* randomDelay(400, 700);
  yield* Effect.logInfo('Report generated: report_2024_01.pdf');
  yield* Effect.log('Report saved to S3');
}).pipe(Effect.withSpan('generateReport'));

// Main program - simulates a typical API request flow
const program = Effect.gen(function* () {
  yield* Effect.log('Starting API request handler');

  // Initial setup
  const user = yield* fetchUser;
  yield* processData;

  // Database operations (sequential)
  yield* Effect.gen(function* () {
    yield* Effect.log('Starting database operations');
    yield* connectToDatabase;
    yield* queryUsers;
    yield* queryOrders;
    yield* Effect.log('Database operations complete');
  }).pipe(Effect.withSpan('databaseOperations'));

  // Parallel side effects
  yield* Effect.all([sendNotifications, updateCache, trackAnalytics], {
    concurrency: 'unbounded',
  }).pipe(Effect.withSpan('sideEffects'));

  // Final processing
  yield* generateReport;

  yield* Effect.sleep('200 millis').pipe(Effect.withSpan('finalize'));

  yield* Effect.log('Request completed successfully');
  return user;
}).pipe(Effect.withSpan('main'));

// Run with trace visualization
Effect.runPromise(traceVisualize(program, { serviceName: 'trace-demo' })).then(
  (result) => {
    console.log('\nResult:', result);
  }
);
