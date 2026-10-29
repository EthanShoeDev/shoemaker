// Requires every dynamic import() to carry a `dynamic-import -- reason`
// comment. Static imports are the default: they keep the module graph visible
// to bundlers, knip and typecheck, so a lazy load has to say why it is lazy
// (code splitting, a lazy native module, an import cycle, an optional
// dependency).
import { definePlugin, defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

const reasonMarker = /\bdynamic-import\s+--\s+\S/u;

const isStatement = (node: ESTree.Node) =>
  node.type.endsWith('Statement') ||
  node.type === 'VariableDeclaration' ||
  node.type === 'ExportNamedDeclaration' ||
  node.type === 'ExportDefaultDeclaration';

const enclosingStatement = (node: ESTree.ImportExpression) => {
  let current: ESTree.Node = node;
  while (!isStatement(current) && current.type !== 'Program') {
    current = current.parent;
  }
  return current;
};

const rule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a dynamic-import -- reason comment for every dynamic import(); default to static imports.',
    },
    messages: {
      missingReason:
        'Dynamic import() needs a "dynamic-import -- reason" comment on the line above its statement, on ' +
        'the line above the import, or on the import itself, explaining why a ' +
        'static import will not do (code splitting, a lazy native module, an ' +
        'import cycle, an optional dependency).',
    },
  },
  create(context) {
    const comments = context.sourceCode.getAllComments();

    return {
      ImportExpression(node) {
        const statement = enclosingStatement(node);
        const explained = comments.some(
          (comment) =>
            reasonMarker.test(comment.value) &&
            (comment.loc.end.line === statement.loc.start.line - 1 ||
              comment.loc.end.line === node.loc.start.line - 1 ||
              (comment.loc.start.line <= node.loc.end.line &&
                comment.loc.end.line >= node.loc.start.line)),
        );
        if (explained) return;
        context.report({ node, messageId: 'missingReason' });
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'dynamic-import' },
  rules: { 'no-unexplained-dynamic-import': rule },
});
