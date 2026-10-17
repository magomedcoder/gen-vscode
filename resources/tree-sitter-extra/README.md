# Tree-sitter grammars (VSIX)

ABI-compatible wasm for languages **not** in `@vscode/tree-sitter-wasm`.

Copied into `dist/tree-sitter/` by `esbuild.js` on every build.

## Always shipped

- `tree-sitter-html.wasm`
- `tree-sitter-json.wasm`
- `tree-sitter-yaml.wasm`
- `tree-sitter-sql.wasm`
- `tree-sitter-kotlin.wasm`
- `tree-sitter-swift.wasm`
- `tree-sitter-dart.wasm` (Dart / Flutter)

From `@vscode/tree-sitter-wasm` (also always in VSIX): JS/TS, Python, Go, Rust, C++, PHP, Java, Bash, **CSS**.

See `gen-vscode-docs/tree-sitter-languages.md`.
