/**
 * Disallows CSS backdrop filters: Tailwind `backdrop-blur-*` and the other
 * `backdrop-*` filter utilities, `[backdrop-filter:...]` arbitrary properties,
 * and `backdropFilter` keys in style or animation objects.
 *
 * A backdrop filter re-samples and re-filters everything behind the element on
 * every frame the element or its backdrop changes. On a menu or dialog that
 * animates open, that turned a 150 ms zoom into two or three visible frames.
 */

import { definePlugin, defineRule } from '@oxlint/plugins';

const BACKDROP_CLASS_RE =
  /backdrop-(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia|filter)\b/;

const BACKDROP_STYLE_KEYS = new Set(['backdropFilter', 'WebkitBackdropFilter']);

const rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow backdrop filters; they re-filter the backdrop every frame and make animations stutter.',
    },
    messages: {
      noBackdropFilter:
        'Backdrop filters re-filter everything behind the element on every frame and make open/close ' +
        'animations stutter. Use an opaque or semi-opaque background instead.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (BACKDROP_CLASS_RE.test(String(node.value))) {
          context.report({ node, messageId: 'noBackdropFilter' });
        }
      },
      TemplateElement(node) {
        if (BACKDROP_CLASS_RE.test(node.value.raw)) {
          context.report({ node, messageId: 'noBackdropFilter' });
        }
      },
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          !node.computed &&
          BACKDROP_STYLE_KEYS.has(node.key.name)
        ) {
          context.report({ node: node.key, messageId: 'noBackdropFilter' });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'backdrop-filter' },
  rules: { 'no-backdrop-filter': rule },
});
