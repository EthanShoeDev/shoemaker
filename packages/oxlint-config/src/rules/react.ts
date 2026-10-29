import type { OxlintRules } from '../helpers.ts';

/** React, react-perf and jsx-a11y, for apps compiled by the React Compiler. */
export const react: OxlintRules = {
  // JSX depth is judged in review.
  'react/jsx-max-depth': 'off',
  // Small helper components live beside their parent.
  'react/no-multi-comp': 'off',
  // Automatic JSX runtime (jsx: 'react-jsx').
  'react/react-in-jsx-scope': 'off',
  // TypeScript already confines JSX to .tsx.
  'react/jsx-filename-extension': 'off',
  // `{...props}` forwarding is how wrapper components work.
  'react/jsx-props-no-spreading': 'off',
  // Copy is inline until an i18n layer exists; translation coverage is reviewed by hand.
  'react/jsx-no-literals': 'off',
  // className/style on components is the Tailwind idiom.
  'react/forbid-component-props': 'off',
  // Same reason as func-style.
  'react/function-component-definition': 'off',
  // `onClick={service.logout}` is cleaner than a wrapper.
  'react/jsx-handler-names': 'off',
  // Render props are called as functions by their consumers; a component prop is typed as one.
  'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
  // Default depth 2 cannot see label text through layout wrapper divs; 4 reaches real markup.
  'jsx-a11y/control-has-associated-label': ['error', { depth: 4 }],
  // oxlint's port ships no element→role map, so these are eslint-plugin-jsx-a11y's
  // documented defaults; `<ul role="listbox">` with `role="option"` is the ARIA pattern.
  'jsx-a11y/no-noninteractive-element-to-interactive-role': [
    'error',
    {
      ul: [
        'listbox',
        'menu',
        'menubar',
        'radiogroup',
        'tablist',
        'tree',
        'treegrid',
      ],
      ol: [
        'listbox',
        'menu',
        'menubar',
        'radiogroup',
        'tablist',
        'tree',
        'treegrid',
      ],
      li: ['menuitem', 'option', 'row', 'tab', 'treeitem'],
      table: ['grid'],
      td: ['gridcell'],
      fieldset: ['radiogroup', 'presentation'],
    },
  ],
};

/** Rules the React Compiler makes obsolete or cannot compile. */
export const reactCompiler: OxlintRules = {
  // React Compiler memoizes context values.
  'react/jsx-no-constructed-context-values': 'off',
  // Upstream ships this off: it lists what the compiler skips (Effect.gen
  // programs inside components, try/finally, ??=), not defects.
  'react/todo': 'off',
  // Upstream ships this off. It flags every capitalized call in a render body
  // (Schema.Struct(), Option.some()) as a possible component, and oxlint
  // exposes no allowlist for the non-components.
  'react/capitalized-calls': 'off',
  // React Compiler memoizes inline props.
  'react-perf/jsx-no-new-function-as-prop': 'off',
  // React Compiler memoizes inline props.
  'react-perf/jsx-no-new-object-as-prop': 'off',
  // React Compiler memoizes inline props.
  'react-perf/jsx-no-new-array-as-prop': 'off',
  // React Compiler memoizes inline props.
  'react-perf/jsx-no-jsx-as-prop': 'off',
  // React Compiler does not support ||= / ??= yet (see react/todo).
  'logical-assignment-operators': 'off',
};
