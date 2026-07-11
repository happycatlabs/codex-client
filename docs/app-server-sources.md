# Codex App Server Sources

Use these sources before changing protocol types or client behavior:

- Official docs: https://developers.openai.com/codex/app-server.md
  (308-redirects to https://learn.chatgpt.com/docs/app-server.md — use the
  mirror directly if your fetcher does not follow cross-host redirects)
- App-server source: https://github.com/openai/codex/tree/main/codex-rs/app-server
- App-server README: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Installed CLI schema generator:

```sh
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

Generated schema output is specific to the installed `codex` version. For this
client, prefer generated shapes over inferred payloads when adding request,
response, or notification types.

The stable generated `ClientRequest` union filters experimental RPCs. Do not
treat absence from that union as proof that a public experimental method was
removed. Before deleting an existing wrapper, cross-check the official docs,
the matching tagged protocol source, and (when safe) a live initialized
app-server probe. For codex-cli `0.144.1`, this applies to live methods such as
`thread/turns/list`, `thread/items/list`, and `collaborationMode/list`.
