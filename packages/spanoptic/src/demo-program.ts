import { Effect, Random } from 'effect';

import { withTracedSpan } from './index.ts';

const randomDelay = (min: number, max: number) =>
  Effect.flatMap(Random.nextIntBetween(min, max), (ms) => Effect.sleep(ms));

const fetchUser = Effect.gen(function* () {
  yield* Effect.log('Fetching user from database...');
  yield* Effect.annotateCurrentSpan('user.id', 1);
  yield* Effect.annotateCurrentSpan('user.role', 'admin');
  yield* randomDelay(300, 600);
  yield* Effect.log('User fetched successfully');
  return { id: 1, name: 'Alice' };
}).pipe(withTracedSpan('fetchUser'));

const processData = Effect.gen(function* () {
  yield* Effect.log('Starting data processing');
  yield* randomDelay(200, 400);
  yield* Effect.logDebug('Processed 42 records');
  yield* Effect.log('Data processing complete');
}).pipe(withTracedSpan('processData'));

const connectToDatabase = Effect.gen(function* () {
  yield* Effect.log('Establishing database connection');
  yield* randomDelay(100, 200);
  yield* Effect.log('Connected to PostgreSQL');
}).pipe(withTracedSpan('connectToDatabase'));

const queryUsers = Effect.gen(function* () {
  yield* Effect.log('Executing query: SELECT * FROM users');
  yield* Effect.annotateCurrentSpan('db.table', 'users');
  yield* Effect.annotateCurrentSpan('db.rows_returned', 42);
  yield* randomDelay(250, 500);
  yield* Effect.logDebug('Query returned 42 rows in 234ms');
}).pipe(withTracedSpan('queryUsers'));

const queryOrders = Effect.gen(function* () {
  yield* Effect.log('Executing query: SELECT * FROM orders');
  yield* Effect.annotateCurrentSpan('db.table', 'orders');
  yield* Effect.annotateCurrentSpan('db.rows_returned', 156);
  yield* randomDelay(300, 600);
  yield* Effect.logDebug('Query returned 156 rows in 412ms');
  yield* Effect.logWarning('Large result set - consider pagination');
}).pipe(withTracedSpan('queryOrders'));

const databaseOperations = Effect.gen(function* () {
  yield* Effect.log('Starting database operations');
  yield* connectToDatabase;
  yield* queryUsers;
  yield* queryOrders;
  yield* Effect.log('Database operations complete');
}).pipe(withTracedSpan('databaseOperations'));

const sendNotifications = Effect.gen(function* () {
  yield* Effect.log('Sending notifications to 3 users');
  yield* randomDelay(400, 800);
  yield* Effect.logInfo('Email sent to user@example.com');
  yield* Effect.logInfo('Push notification sent');
}).pipe(withTracedSpan('sendNotifications'));

const updateCache = Effect.gen(function* () {
  yield* Effect.log('Invalidating cache entries');
  yield* randomDelay(150, 300);
  yield* Effect.logDebug('Cache key: user:1 invalidated');
}).pipe(withTracedSpan('updateCache'));

const trackAnalytics = Effect.gen(function* () {
  yield* Effect.log('Recording analytics event');
  yield* randomDelay(200, 500);
  yield* Effect.logDebug('Event: page_view recorded');
}).pipe(withTracedSpan('trackAnalytics'));

const generateReport = Effect.gen(function* () {
  yield* Effect.log('Generating monthly report');
  yield* randomDelay(400, 700);
  yield* Effect.logInfo('Report generated: report_2024_01.pdf');
  yield* Effect.log('Report saved to S3');
}).pipe(withTracedSpan('generateReport'));

/** A simulated API request handler: sequential, nested and parallel spans. */
export const demoProgram = Effect.gen(function* () {
  yield* Effect.log('Starting API request handler');
  const user = yield* fetchUser;
  yield* processData;
  yield* databaseOperations;
  yield* Effect.all([sendNotifications, updateCache, trackAnalytics], {
    concurrency: 'unbounded',
  }).pipe(withTracedSpan('sideEffects'));
  yield* generateReport;
  yield* Effect.sleep('200 millis').pipe(withTracedSpan('finalize'));
  yield* Effect.log('Request completed successfully');
  return user;
}).pipe(withTracedSpan('main'));
