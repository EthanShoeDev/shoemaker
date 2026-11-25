// What Cloudflare charges past the included amounts, in dollars, read on
// 2026-11-25 from its documentation:
//
//   developers.cloudflare.com/workers/platform/pricing/
//   developers.cloudflare.com/d1/platform/pricing/
//   developers.cloudflare.com/durable-objects/platform/pricing/
//   developers.cloudflare.com/queues/platform/pricing/
//   developers.cloudflare.com/email-service/platform/pricing/
//
// Reading D1 and D1 storage are on the D1 page; the rate-limit binding has no
// price. Emails to a verified destination address are free, and are priced here
// as if none were.
export const prices = {
  readOn: '2026-11-25',
  perMillion: {
    workerRequests: 0.3,
    workerCpuMs: 0.02,
    durableObjectRequests: 0.15,
    durableObjectGbSeconds: 12.5,
    durableObjectRowsWritten: 1,
    d1RowsRead: 0.001,
    d1RowsWritten: 1,
    queueOperations: 0.4,
    emails: 350,
  },
  d1GbMonth: 0.75,
} as const;

// The Durable Objects page says that usage past the included amount is rounded
// up to the next unit before it is priced. No other page does.
export const roundedUp: ReadonlyArray<keyof typeof prices.perMillion> = [
  'durableObjectRequests',
  'durableObjectGbSeconds',
  'durableObjectRowsWritten',
];
