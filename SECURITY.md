# Security policy

## Reporting a vulnerability

Please report security problems **privately**, through GitHub's private
vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. GitHub's guide:
https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately

Do **not** report a vulnerability in a public issue, pull request, discussion
or comment. If private reporting is not available to you, open an issue that
asks the maintainer for a private contact channel and gives no details of the
problem.

A useful report includes:

- what is affected (file, route, function or workflow) and the commit you
  tested;
- how to reproduce it, ideally against the keyless fixture runtime
  (`pnpm run dev:fixture`, see [CONTRIBUTING.md](CONTRIBUTING.md));
- the impact you expect.

Never include real API keys, tokens, passwords, cookies or other people's data
in a report. If you find a credential committed anywhere in this repository or
its history, report it privately in the same way; do not test it.

## Supported versions

Only the `main` branch is supported. There are no releases or maintained
release branches, so fixes land on `main` only.

## What to expect

This is a small project. The maintainer will acknowledge
a report and work on a fix as time allows, and will credit you in the fix or
advisory if you want to be credited. There is **no bug bounty** and no paid
reward of any kind.

## Scope

This policy covers the source code in this repository. The project does not
advertise or support a hosted service, so please do not test against any
deployment you do not own. If you run your own deployment of Sirkit, you are
responsible for operating and securing it.
