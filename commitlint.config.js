module.exports = {
  plugins: ['commitlint-plugin-function-rules'],
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [0],
    'scope-empty': [2, 'never'],
    'function-rules/scope-enum': [
      2,
      'always',
      ({ scope }) => {
        const scopeRegex = /PO-[0-9]+/;
        const isScopeValid = scope && scope.match(scopeRegex);
        if (isScopeValid) {
          return [true];
        }
        return [false, `scope must match this regex: ${scopeRegex}`];
      },
    ],
  },
};
