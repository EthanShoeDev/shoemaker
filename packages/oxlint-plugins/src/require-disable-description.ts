// Requires eslint-disable/oxlint-disable directives to carry a description and
// forbids the Effect language-service form: `@effect-diagnostics` silences
// tsgolint but escapes --report-unused-disable-directives, so Effect rules are
// suppressed with oxlint-disable like every other rule. TypeScript directives
// are covered by typescript/ban-ts-comment.
// @see https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/require-description.html
import { definePlugin, defineRule } from '@oxlint/plugins';

const lintDisablePattern =
  /^\s*(eslint-disable|oxlint-disable)(-next-line|-line)?\b/;
const effectDiagnosticsPattern = /^\s*@effect-diagnostics(-next-line)?(?:\s|$)/;

// A separator with nothing after it is not a description: `-- ` reads as
// justified while saying nothing, which is the exact thing this rule exists
// to prevent.
const describedAfterDoubleDash = (text: string) => {
  const separator = text.indexOf('--');
  return separator !== -1 && text.slice(separator + 2).trim().length > 0;
};

const rule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require descriptions on eslint-disable and oxlint-disable directives; forbid @effect-diagnostics suppressions',
    },
    messages: {
      missingLintDescription:
        'Disable directive is missing a description. Add one after "--" (e.g., "// oxlint-disable-next-line rule-name -- reason here").',
      forbiddenEffectDiagnostics:
        '@effect-diagnostics comments escape --report-unused-disable-directives. Use "// oxlint-disable-next-line effecttsgo/<rule> -- reason here" instead.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (effectDiagnosticsPattern.test(text)) {
            context.report({
              node: comment,
              messageId: 'forbiddenEffectDiagnostics',
            });
          } else if (
            lintDisablePattern.test(text) &&
            !describedAfterDoubleDash(text)
          ) {
            context.report({
              node: comment,
              messageId: 'missingLintDescription',
            });
          }
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'disable-comments' },
  rules: { 'require-description': rule },
});
