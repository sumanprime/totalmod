# @totalmod/telemetry

The anonymous usage counts [totalmod](https://github.com/sumanprime/totalmod) sends: a fixed list of events (`first_run`, `request_submitted`, `preview_ready`, `iteration`, `merged`, `ga`, `rejected`), an install id that can't be traced back, the source and version, and a few allowlisted numbers. Never request text, specs, code, prompts, file paths or user ids.

Disabled by `DO_NOT_TRACK=1` or `telemetry: false` in `totalmod.config.yaml`. Sending never throws and gives up after 1.5 seconds.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
