/**
 * [B24-A2] D24-4, OD-195 - the secret scan's reviewed allowlist (secret-scan.ts): exact paths, never a glob or a directory; each entry
 * a rule, the sha256 of the line's text (never the text) and a reason. Every entry is a test sentinel that a redaction or denylist
 * test feeds its own classifier - read in its test before it was added here, characterised by its length only and never printed ([B24-A2F, 2026-10-09] except the entries marked `historyOnly: true`, the last of the array: B24-C3's test fake as committed at ba4f562, which no test at HEAD reads since aaa6a1b rewrote it, so it holds in the pull request's history alone; [PR-L/M integration, 2026-10-18] now the LAST TWO: + PR-D's v1 generate-proposal line as committed at e5817558, which 00d0343 rewrote; [PR-L6 integration, 2026-10-19] now the LAST THREE: + PR-L6's l6-plan-assumptions literal as committed at 2240363a, which 9a42c36b rewrote). An
 * edited line hits again; a line that no longer hits makes its entry stale, and the tree-mode scan fails until the entry goes - except an entry marked `historyOnly: true` ([B24-A2F, 2026-10-09]: its line was rewritten by the commit its reason names and exists only in the pull request's history,
 * so it allowlists the history scan alone, is never stale, and its line back in the tree is a finding; secret-scan.ts, the end of the file). A real secret is never allowlisted: it is reported to the lead as `path:line rule` and rotated by the owner (LB-13).
 */
import type { SecretScanAllowlistEntry } from "./secret-scan";

export const SECRET_SCAN_ALLOWLIST: readonly SecretScanAllowlistEntry[] = Object.freeze([
  {
    path: "app/lib/mcp/server/__tests__/b20-c3-descriptor-text-gate.test.ts",
    rule: "pem-private-key",
    sha256: "8c0d1d8ffe273fbe6900a40ceb6e5ecb6a129f350d555482f7b1292f53bb2879",
    reason: "the `marker pem` case of B20-C3's descriptor-text gate: a bare PEM marker string with no key material after it, the input the gate must refuse",
  },
  {
    path: "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts",
    rule: "anthropic-key-shape",
    sha256: "03e51468d39a784229ef69180b741abf503d8f22f04f60662f1aa8f833e1552d",
    reason: "B11.1's trace-integrity case 'a secret embedded in a KEY NAME is redacted': a 27-character key-shaped fake inside an object key, which the validator must not echo",
  },
  {
    path: "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts",
    rule: "anthropic-key-shape",
    sha256: "6ef200ad1d9a5ad74fd4f69e9ffc7dbdeaf84ad885ff7c2ff02320af7bcb4d8e",
    reason: "B11.1's replay-capsule case: a 29-character key-shaped fake hidden on a prototype as a bearer value, which the capsule validator must refuse unread",
  },
  {
    path: "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts",
    rule: "anthropic-key-shape",
    sha256: "ce0fcad6e490efb3e948ba0d92946b9b892d6038018432f4b82f0a2f4ed18a49",
    reason: "B11.1's replay-capsule key-name case: a 27-character key-shaped fake inside an object key, which the capsule validator must not echo",
  },
  {
    path: "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts",
    rule: "aws-access-key-id-shape",
    sha256: "72900bb59ae68cfd22dddde4c577b373e9e7991f87b95ab0a65225db6c7e5fdd",
    reason: "B11.1's secret-shaped-text probes: a 20-character access-key-id-shaped fake in a JSON-quoted credential field, which the classifier must flag",
  },
  {
    path: "app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts",
    rule: "anthropic-key-shape",
    sha256: "ddb3cf9810d941bf27f7f282dad843c62d1ac15c0125d64e5b9d0b225f1f1f68",
    reason: "B11's redaction case 'secret-shaped values are redacted at record time': a 29-character key-shaped fake the recorder must redact",
  },
  // [B24-A2 review, 2026-10-06] security-2: the two lines the connection-string rule hits in the tree, each read in its test first
  {
    path: "app/api/__tests__/b16-0-12-tranche-parity.test.ts",
    rule: "connection-string-password",
    sha256: "c656c46bb2f48e2e22abde59144a68d8ddfd9a47b7f38954278862199946410d",
    reason: "B16.0.12's /api/ai/runtime case 'adversarial sentinel env values never appear in the serialized response': a database URL whose password is a named SENTINEL, stubbed into the environment so the response can be checked for it",
  },
  {
    path: "app/lib/db/__tests__/b16-b-database-qualification.test.ts",
    rule: "connection-string-password",
    sha256: "960457ace48b1f8763d0e094812288600a3743899247f06a8befab7848026623",
    reason: "B16-B's database-qualification fixture ENV_LOCAL_STYLE_URL: a pooler URL shaped like an owner's .env.local value, for a project named deadtenant that does not resolve, with a placeholder password; the qualification must refuse it without its marker",
  },
  // [PR-G lead, 2026-10-17] the three redaction cases PR-D/PR-F added, each read in its test first: a 55-character key-shaped fake
  // (the alphabet, no key material) inside a thrown error's message, which the gateway's refusal diagnostics must never echo
  {
    path: "app/lib/engineering/__tests__/pr-d-catalog-inspect.test.ts",
    rule: "anthropic-key-shape",
    sha256: "564faed325f7e6a0976ba69ffe06c8f4e8a4b905c1719645461df4e496781557",
    reason: "PR-D's catalog-inspect refusal case: the fake catalog port throws 'connection refused' followed by a 55-character key-shaped alphabet placeholder; the read must refuse implementation_failed without the message's secret shape in its diagnostics",
  },
  {
    path: "app/lib/engineering/__tests__/pr-d-generate-proposal.test.ts",
    rule: "anthropic-key-shape",
    sha256: "0d36d7140314e27901cf1114a29a29fed1ab55c4f7f7fcd06cfb19c15973d4f7",
    reason: "PR-D's generate-proposal failure case, [PR-L, 2026-10-18] as rewritten for the 2.0.0 port (runbook L.5): the fake generation-task port's start throws 'socket hang up' followed by the same alphabet placeholder; the refusal must carry the first words and never the key shape",
  },
  {
    path: "app/lib/parts/__tests__/pr-f-missing-facts-read.test.ts",
    rule: "anthropic-key-shape",
    sha256: "564faed325f7e6a0976ba69ffe06c8f4e8a4b905c1719645461df4e496781557",
    reason: "PR-F's missing-facts read: the fake catalog port throws the same 'connection refused' line (byte-identical to PR-D's catalog-inspect case); the read answers catalog unavailable without the message's secret shape",
  },
  // [B24-A2F, 2026-10-09] the history-only kind (secret-scan.ts, the end of the file): the one line B24-C3's commit carried and the
  // lead's fix rewrote, which the pull request's history scan still reads; the digest verified by the lead and by this increment
  // against `git show ba4f562:<path> | sed -n 75p` piped into sha256, the line never printed; neither used nor stale in tree mode
  {
    path: "app/lib/qualification/__tests__/b24-c3-trace-read.test.ts",
    rule: "connection-string-password",
    sha256: "8bbe84aef14181902a233659797cf030bfd89aceb5f844542df7aee61e584a01",
    historyOnly: true as const,
    reason: "B24-C3's fake connection string as committed at ba4f562:75 - a template literal assigned to FAKE_URL, user and password assembled from joined fragments, host db.invalid, no credential - matched by shape only; replaced at aaa6a1b by joined fragments under FAKE_CONNECTION, so it exists only in the pull request's history",
  },
  // [PR-L, 2026-10-18] history-only, LAST: PR-D's v1 line of the same case (the fake 1.0.0 generation port), which the pull request's
  // history scan still reads in e5817558's blob; the digest is the one PR-G's lead verified for the tree entry above before L.5 rewrote it
  {
    path: "app/lib/engineering/__tests__/pr-d-generate-proposal.test.ts",
    rule: "anthropic-key-shape",
    sha256: "4ac308fec5066095a8b2153307f2c714c48da82f5326474fdf097ce9d4495eeb",
    historyOnly: true as const,
    reason: "PR-D's generate-proposal failure line as committed at e5817558 - the fake 1.0.0 generation port throwing 'socket hang up' and the 55-character alphabet placeholder, no key material - rewritten at 00d0343 by runbook L.5 (2026-10-18) for the 2.0.0 port, so it exists only in the pull request's history", // [PR-L/M integration, 2026-10-18] the reason names the REPLACING commit (00d0343), as secret-scan.ts requires, beside the introducing one
  },
  // [PR-L6 integration, 2026-10-19] history-only, LAST: the key-shaped literal of l6-plan-assumptions case 76 as committed at 2240363a;
  // the gates runner computed the line digest without printing it and the lead re-verified it the same way (it is not the owner's key)
  {
    path: "app/lib/schematic/__tests__/l6-plan-assumptions.test.ts",
    rule: "openai-key-shape",
    sha256: "e4e6b02a0774fb3e13b9a94a68d7ce97237f20787db4df08286de9410337eade",
    historyOnly: true as const,
    reason: "PR-L6's plan-assumptions redaction case as committed at 2240363a:76 - a 46-character key-shaped placeholder the builder wrote to prove an assumption line never carries a key, no key material (the lead compared it with the configured key by value, never printing either: not equal, no shared 12-character run) - rewritten at 9a42c36b to assemble the same placeholder at run time, so it exists only in the pull request's history",
  },
].map((entry) => Object.freeze(entry as SecretScanAllowlistEntry)));
