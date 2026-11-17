# Security policy

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Report it privately through [GitHub's vulnerability reporting](https://github.com/sumanprime/totalmod/security/advisories/new). If you can't use that, email **[ama@sumansarkar.com](mailto:ama@sumansarkar.com)** with "totalmod security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within 3 working days. Once a fix is released, you'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release of the npm packages (`totalmod` and `@totalmod/*`) and of the GitHub Action (`sumanprime/totalmod/action@v0`) gets security fixes.

## In scope

totalmod's safety model is in the [README](README.md#safety-model). These are the reports we most want:

- preview code reaching production data or production secrets;
- raw request text, rather than the confirmed spec, reaching the build agent;
- a change getting past the policy or path checks in `totalmod.config.yaml`;
- secrets reaching the agent's context;
- a preview link opening for someone other than its requester, or after it expires;
- telemetry sending anything beyond the anonymous counts the README lists.

Code that `npx totalmod init` copies into your app, and code the build agent writes for your users, belong to your app. Report problems there to that app's owner, unless they come from a totalmod template.
