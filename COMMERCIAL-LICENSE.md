# Licensing

totalmod is dual-licensed. Copyright © 2026 sumanprime. All rights reserved except as granted below.

The npm packages declare this as `(AGPL-3.0-only OR LicenseRef-totalmod-Commercial)`: you may use them under either license. `LicenseRef-totalmod-Commercial` means the commercial license described in section 2.

## 1. GNU AGPL-3.0 (free)

The code in this repository is available under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). You can use, modify and distribute it free of charge, including commercially, **as long as you meet the AGPL's terms**. In short:

- If you run a modified version, or an application that includes totalmod's packages (`@totalmod/server`, `@totalmod/widget`, `@totalmod/flags`, `@totalmod/core`), as a network service, you must offer that whole application's source code to its users under the AGPL.
- You must keep the copyright and license notices.

This fits open-source projects, internal experiments, and anyone happy to publish their application's code under the AGPL.

## 2. Commercial license (paid)

If you want to use totalmod in a closed-source product or service, without the AGPL's source-sharing obligations, you need a commercial license. It typically covers:

- use in proprietary applications, with no obligation to release your source code,
- private modifications,
- support and updates, depending on the plan.

To get a commercial license, contact **[ama@sumansarkar.com](mailto:ama@sumansarkar.com)**.

## What is not covered by either license

- **Code that `npx totalmod init` generates in your repository** (the route handler, adapter, widget mount, config, workflow files, and so on) is licensed [MIT-0](templates/LICENSE). It's yours to change, and it doesn't by itself put your application under the AGPL.
- **Code the build agent writes in your repository** for your users' feature requests is your code.
- **Running the totalmod GitHub Action in your CI** doesn't make your application a derivative work.

## Contributing

To keep dual licensing possible, contributors sign a [Contributor License Agreement](CLA.md) before their first pull request is merged. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

This page summarises the licensing model and is not legal advice. The [LICENSE](LICENSE) file and a signed commercial agreement are what govern.
