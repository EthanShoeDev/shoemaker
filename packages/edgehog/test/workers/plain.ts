import { Function } from 'effect';

import { serve } from './serve.ts';

// What a request leaves running is stopped with it.
export default serve(Function.constVoid);
