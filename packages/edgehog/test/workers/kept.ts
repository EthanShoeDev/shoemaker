import { waitUntil } from 'cloudflare:workers';

import { serve } from './serve.ts';

// A load outlives the request that began it.
export default serve(waitUntil);
