// What the recorder does around each scenario of `worker.ts`: the requests it
// sends to the Worker, and what ingest answers.
export interface Answer {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Scenario {
  // Sent one after another, in one isolate. One plain GET if absent.
  readonly requests?: ReadonlyArray<{
    readonly method?: 'GET' | 'POST';
    readonly path?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  }>;
  // 'hang' never answers, 'unreachable' refuses the connection.
  readonly answer?: Answer | 'hang' | 'unreachable';
  // Sends through a service binding, and has no other way out.
  readonly serviceBinding?: boolean;
}

// Real in form only.
export const KEY = '00112233445566778899aabbccddeeff';
export const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
export const SPAN_ID = 'b7ad6b7169203331';
const CARD = '4111111111111111';

export const FIXED: ReadonlyArray<string> = [KEY, TRACE_ID, SPAN_ID, CARD];

const twice: Scenario['requests'] = [{ path: '/first' }, { path: '/second' }];

const limited = (status: number, limits: string): Scenario => ({
  requests: twice,
  answer: { status, headers: { 'x-sentry-rate-limits': limits } },
});

// A request with every kind of secret, none of them real.
const sensitive: Scenario = {
  requests: [
    {
      method: 'POST',
      path: '/orders?id=4711&token=query-secret',
      headers: {
        authorization: 'Bearer header-secret',
        cookie: 'theme=dark; session=cookie-secret',
        'content-type': 'application/json',
        'user-agent': 'recorder/1.0',
        'x-forwarded-for': '203.0.113.7',
        'cf-connecting-ip': '203.0.113.7',
      },
      body: `{"item":"book","password":"body-secret","card":"${CARD}"}`,
    },
  ],
};

export const scenarios: Readonly<Record<string, Scenario>> = {
  thrown: {},
  'cause-chain': {},
  'not-an-error': {},
  message: {},
  'fingerprint-custom': {},
  'fingerprint-default': {},
  'fingerprint-divided': {},
  request: sensitive,
  'request-nothing': sensitive,
  context: {},
  'trace-none': {},
  'trace-sentry': {
    requests: [{ headers: { 'sentry-trace': `${TRACE_ID}-${SPAN_ID}-1` } }],
  },
  'trace-traceparent': {
    requests: [{ headers: { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` } }],
  },
  'unsupported-kinds': {},
  'transaction-static': {},
  attachment: {},
  'client-report': { requests: twice },
  tunnel: {},
  'service-binding': { serviceBinding: true },
  repeated: { requests: twice },
  'repeated-kept': { requests: twice },
  flush: {},
  'answer-429': { requests: twice, answer: { status: 429 } },
  'answer-429-retry-after': {
    requests: twice,
    answer: { status: 429, headers: { 'retry-after': '3600' } },
  },
  'answer-429-limits': limited(429, '3600:error:key'),
  'answer-200-limits': limited(200, '3600:error:key'),
  'answer-403': limited(403, '86400::key'),
  'answer-413': { requests: twice, answer: { status: 413 } },
  'answer-500': { requests: twice, answer: { status: 500 } },
  'no-answer': { requests: twice, answer: 'hang' },
  unreachable: { requests: twice, answer: 'unreachable' },
};
