// The Worker the fixtures are recorded from. Each scenario runs in an isolate
// of its own, since the SDK keeps one client for each, and is named by a
// binding.
import * as Sentry from '@sentry/cloudflare';

interface Env {
  readonly SCENARIO: string;
  readonly DSN: string;
  // Where a scenario reaches ingest through a service binding.
  readonly INGEST?: { readonly fetch: typeof fetch };
}

const failure = (message: string) => new Error(message);

const withFingerprint = (fingerprint: Array<string>, message: string) =>
  Sentry.withScope((scope) => {
    scope.setFingerprint(fingerprint);
    Sentry.captureException(failure(message));
  });

type Act = (request: Request) => Promise<string> | string;

// Each request fails differently, since the SDK drops an error that repeats the
// one before it.
const sendsTwoKinds = (request: Request) => {
  Sentry.captureException(
    failure(`Failed in ${new URL(request.url).pathname}`),
  );
  Sentry.captureCheckIn({ monitorSlug: 'nightly', status: 'ok' });
  return 'captured';
};

const flushes = (request: Request) => {
  Sentry.captureException(
    failure(`Failed in ${new URL(request.url).pathname}`),
  );
  return Sentry.flush(1000).then((sent) => `flushed: ${String(sent)}`);
};

// What each scenario does in a request, beside the options below.
const scenarios: Readonly<Record<string, Act>> = {
  thrown: () => {
    throw new TypeError('Cannot load order 4711');
  },
  'cause-chain': () => {
    Sentry.captureException(
      new Error('Could not place order', {
        cause: new RangeError('Quantity out of range', {
          cause: failure('from the form'),
        }),
      }),
    );
    return 'captured';
  },
  'not-an-error': () => {
    Sentry.captureException({ code: 'E42', detail: 'an object was thrown' });
    Sentry.captureException('a string was thrown');
    return 'captured';
  },
  message: () => {
    Sentry.captureMessage('Queue is long', 'warning');
    return 'captured';
  },
  'fingerprint-custom': () => {
    withFingerprint(['payment-failed'], 'Card declined');
    withFingerprint(['payment-failed'], 'Gateway timed out');
    return 'captured';
  },
  'fingerprint-default': () => {
    withFingerprint(['{{ default }}'], 'Card declined');
    return 'captured';
  },
  'fingerprint-divided': () => {
    withFingerprint(['{{ default }}', 'tenant-a'], 'Card declined');
    withFingerprint(['{{ default }}', 'tenant-b'], 'Card declined');
    return 'captured';
  },
  request: () => {
    Sentry.captureException(failure('With a request'));
    return 'captured';
  },
  'request-nothing': () => {
    Sentry.captureException(failure('With a request'));
    return 'captured';
  },
  context: () => {
    Sentry.setUser({ id: 'user-1', email: 'ada@example.com', username: 'ada' });
    Sentry.setTag('tenant', 'acme');
    Sentry.setExtra('cart', { items: 3 });
    Sentry.setContext('order', { id: 4711, password: 'hunter2' });
    Sentry.addBreadcrumb({ category: 'cart', message: 'checked out' });
    Sentry.captureException(failure('With context'));
    return 'captured';
  },
  'trace-sentry': () => {
    Sentry.captureException(failure('Inside a trace'));
    return 'captured';
  },
  'trace-traceparent': () => {
    Sentry.captureException(failure('Inside a trace'));
    return 'captured';
  },
  'trace-none': () => {
    Sentry.captureException(failure('Outside any trace'));
    return 'captured';
  },
  'unsupported-kinds': () => {
    Sentry.captureException(failure('Beside other kinds'), {
      attachments: [],
    });
    Sentry.logger.info('a log line');
    Sentry.metrics.count('orders', 1);
    Sentry.captureCheckIn({ monitorSlug: 'nightly', status: 'ok' });
    Sentry.captureFeedback({ message: 'Nice', email: 'ada@example.com' });
    return 'captured';
  },
  'transaction-static': () => {
    Sentry.captureException(failure('Beside a transaction'));
    return 'captured';
  },
  attachment: () => {
    Sentry.withScope((scope) => {
      scope.addAttachment({
        filename: 'bytes.bin',
        // A newline and bytes that are no UTF-8.
        data: new Uint8Array([0, 10, 255, 254, 10]),
      });
      Sentry.captureException(failure('With an attachment'));
    });
    return 'captured';
  },
  'client-report': () => {
    Sentry.captureException(failure('dropped by beforeSend'));
    Sentry.captureException(failure('kept'));
    return 'captured';
  },
  tunnel: () => {
    Sentry.captureException(failure('Through a tunnel'));
    return 'captured';
  },
  'service-binding': () => {
    Sentry.captureException(failure('Through a service binding'));
    return 'captured';
  },
  // One error again and again, in one request and in the next.
  repeated: () => {
    for (let index = 0; index < 3; index += 1) {
      Sentry.captureException(failure('Again and again'));
    }
    return 'captured';
  },
  'repeated-kept': () => {
    for (let index = 0; index < 3; index += 1) {
      Sentry.captureException(failure('Again and again'));
    }
    return 'captured';
  },
  flush: flushes,
};

// What the SDK does with an answer.
const behaviors: Readonly<Record<string, Act>> = {
  'answer-429': sendsTwoKinds,
  'answer-429-retry-after': sendsTwoKinds,
  'answer-429-limits': sendsTwoKinds,
  'answer-200-limits': sendsTwoKinds,
  'answer-403': sendsTwoKinds,
  'answer-413': sendsTwoKinds,
  'answer-500': flushes,
  'no-answer': flushes,
  unreachable: flushes,
};

type Options = Sentry.CloudflareOptions;

// Everything is collected by default, less what the SDK itself takes for a
// secret.
const nothing: Options = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
};

const extraOptions: Readonly<Record<string, (env: Env) => Options>> = {
  'request-nothing': () => nothing,
  context: () => ({ release: 'shop@1.2.3', environment: 'production' }),
  'trace-sentry': () => ({ tracesSampleRate: 1 }),
  'trace-traceparent': () => ({ tracesSampleRate: 1 }),
  'unsupported-kinds': () => ({ tracesSampleRate: 1, enableLogs: true }),
  'transaction-static': () => ({
    tracesSampleRate: 1,
    traceLifecycle: 'static',
  }),
  'client-report': () => ({
    beforeSend: (event) =>
      event.exception?.values?.[0]?.value === 'dropped by beforeSend'
        ? null
        : event,
  }),
  tunnel: () => ({ tunnel: 'https://tunnel.test/errors' }),
  'repeated-kept': () => ({ enableDedupe: false }),
  'service-binding': ({ INGEST }) =>
    INGEST === undefined
      ? {}
      : {
          transportOptions: {
            fetch: INGEST.fetch.bind(INGEST),
          },
        },
};

const handler = {
  fetch: (request: Request, env: Env) => {
    const act = behaviors[env.SCENARIO] ?? scenarios[env.SCENARIO];
    const said = act?.(request) ?? 'no such scenario';
    return Promise.resolve(said).then((text) => new Response(text));
  },
};

export default Sentry.withSentry(
  (env: Env) => ({ dsn: env.DSN, ...extraOptions[env.SCENARIO]?.(env) }),
  handler,
);
