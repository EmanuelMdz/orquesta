# Working on Orquesta

Use codebase-memory-mcp for code discovery: index this repository if needed, then prefer search_graph, trace_path, get_code_snippet and query_graph. Fall back to text search when the graph is insufficient or for configuration and literal strings.

This is a local TypeScript/Node CLI and MCP server. Astra plans, answers decisions, creates independent tests and reviews. Opus proposes implementation files. Preserve this division and the rule that an approval cannot override failed tests.

- Run `npm test` for changes to orchestration, subprocesses, Git isolation or protocol behavior. Use targeted tests for independent small changes.
- `npm run test:live` calls real paid/subscription models. Run only when real model testing is authorized; normal tests must stay offline.
- Preserve exact file scope validation, independent QA, commit-bound checks, cancellation, secret redaction and loopback authentication.
- Never weaken a test to make an implementation pass. Never silently substitute another model.
- Keep `.orquesta`, credentials, local execution logs and package archives out of Git. Do not automatically push branches.
- Document actual limitations and avoid claiming full sandboxing or crash recovery.
