import plugin from '../src/no-render-time-match-route.ts';
import { ruleOf, tester } from './rule-tester.ts';

const frozen = { messageId: 'renderTimeMatchRoute' };
const header = "import { useMatchRoute } from '@tanstack/react-router';\n";

tester.run(
  'route-active/no-render-time-match-route',
  ruleOf(plugin, 'no-render-time-match-route'),
  {
    valid: [
      // Event-time calls run after render against live router state.
      `${header}function Nav() {
  const matchRoute = useMatchRoute();
  return <a onClick={() => matchRoute({ to: '/' })} />;
}`,
      // A same-named hook from elsewhere is not the router's.
      `import { useMatchRoute } from './local';
function Nav() {
  const matchRoute = useMatchRoute();
  return matchRoute({ to: '/' });
}`,
      // useCallback defers past render.
      `${header}import { useCallback } from 'react';
function Nav() {
  const matchRoute = useMatchRoute();
  const isHome = useCallback(() => matchRoute({ to: '/' }), [matchRoute]);
  return isHome;
}`,
    ],
    invalid: [
      {
        name: 'render-time call',
        code: `${header}function Nav() {
  const matchRoute = useMatchRoute();
  const active = matchRoute({ to: '/' });
  return active;
}`,
        errors: [frozen],
      },
      {
        name: 'inline invocation',
        code: `${header}function Nav() {
  return useMatchRoute()({ to: '/' });
}`,
        errors: [frozen],
      },
      {
        name: 'aliased import inside useMemo',
        code: `import { useMatchRoute as useMR } from '@tanstack/react-router';
import React from 'react';
function Nav() {
  const mr = useMR();
  return React.useMemo(() => mr({ to: '/' }), [mr]);
}`,
        errors: [frozen],
      },
    ],
  },
);
