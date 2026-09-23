# 70-case PCR classifier evidence

This folder preserves the exact system and user messages presented to the local PCR classifier and all decision-bearing model output fields persisted by the application. The summary and interpretation are in [the report](../pcr-classifier-70-case-local-evaluation-2026-09-23.md).

- `system-prompt.txt`: exact system message. Its SHA-256 over the file bytes is recorded in `invocation.json`.
- `invocation.json`: model, prompt version, tool schema, forced tool choice, sampling settings, and confidence threshold. No endpoint or credential is included.
- `manifest.json`: 70-case index with expected and observed labels.
- `cases/01.json` through `cases/70.json`: exact classifier input, system and user messages, submission body where captured, persisted validated model tool-argument values, and stored decision.

The first 20-case run did not capture its complete API submission JSON. Its exact model-facing messages and outputs are present. Cases 21–70 include the full API submission JSON. Original model response envelopes, token usage, finish reasons, and byte formatting of tool arguments were not stored by the application and cannot be recovered. `storedModelToolArguments` reconstructs the validated JSON values from database fields; it is null when validation produced no stored output. No secrets are in these files.
