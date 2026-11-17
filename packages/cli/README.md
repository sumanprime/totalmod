# totalmod

CLI for [totalmod](https://github.com/sumanprime/totalmod): your users ask for a feature, an AI builds it, you merge.

```bash
npx totalmod init     # add totalmod to a Next.js App Router app
npx totalmod doctor   # check config, flags, workflows and the Vercel preview env
```

`init` never edits your existing files, and keeps files that already exist unless you pass `--force`. The files it adds are MIT-0 licensed: they're yours.

On first run the CLI says what anonymous telemetry it sends. Turn it off with `DO_NOT_TRACK=1` or `telemetry: false` in `totalmod.config.yaml`.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
