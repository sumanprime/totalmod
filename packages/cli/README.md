# totalmod

CLI for [totalmod](https://github.com/sumanprime/totalmod): your users ask for a feature, an AI builds it, you merge.

```bash
npx totalmod demo     # try the whole loop locally: no API key or accounts
npx totalmod init     # add totalmod to a Next.js App Router app
npx totalmod doctor   # check config, flags, workflows and the Vercel preview env
```

`demo` puts a scripted copy of the demo notes app in `./totalmod-demo` (or `--dir`), installs and builds it, and runs it on port 3000 with its mock-data preview on 3001 (`--port` to change). The AI, GitHub and the build are simulated, and its servers get none of your environment's credentials.

`init` never edits your existing files, and keeps files that already exist unless you pass `--force`. The files it adds are MIT-0 licensed: they're yours.

On first run the CLI says what anonymous telemetry it sends. Turn it off with `DO_NOT_TRACK=1` or `telemetry: false` in `totalmod.config.yaml`.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
