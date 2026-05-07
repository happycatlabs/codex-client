# Codex App Server Sources

Use these sources before changing protocol types or client behavior:

- Official docs: https://developers.openai.com/codex/app-server.md
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
