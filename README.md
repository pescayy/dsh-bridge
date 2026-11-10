# dsh-bridge

Bridge mailbox tools for DSHA. Registers two tools for the agent:

- `bridge_check` — poll Muse's mailbox on gtr-1; returns the next queued
  task body, framed as an instruction, or says the mailbox is empty.
- `bridge_report` — post a task's outcome (done/failed + result text) back.

## Config

`~/.dsh/bridge.json`:

```json
{ "url": "https://<mailbox-public-address>", "token": "<bridge token>" }
```

The token is written into this file on the phone only; it never ships
inside this package.
