/**
 * [B24-E review, 2026-10-10] correctness-1, security-1: the sign-in form steps of `production-auth.spec.ts` (D24-34 offline; OD-191),
 * apart from the spec so `b24-e-production-auth-config` case 8 runs them on a recording page, with no browser.
 *
 * Neither credential may reach an artifact. Playwright 1.63 titles a `fill`, `type`, `pressSequentially` or keyboard step with the typed
 * text, and logs `fill("<value>")` into the call log a failed action's error carries; so each value goes in as the argument of one page
 * evaluation (a step titled "Evaluate", its argument in no title or log), which sets the input as React's onChange reads it. Every step is
 * bounded, and the bounds' sum `SIGN_IN_WORST_CASE_MS` ends 20 s inside the config's test timeout, so the spec's `finally` clears both
 * fields before Playwright gives up on the test and tears it down; the config also turns the failure page snapshot off.
 */
import type { Page } from "@playwright/test";

/** Each step's bound, in milliseconds. */
export const SIGN_IN_STEP_TIMEOUTS = Object.freeze({ navigate: 20_000, enter: 10_000, click: 10_000, response: 30_000, settle: 10_000, clear: 5_000 });
const T = SIGN_IN_STEP_TIMEOUTS;
/** Test 1's worst case up to the end of its `finally`: the navigation, two entries, the click and the answer, the settle and two clears. */
export const SIGN_IN_WORST_CASE_MS = T.navigate + 2 * T.enter + T.click + T.response + T.settle + 2 * T.clear;

type FormPage = Pick<Page, "goto" | "getByLabel" | "getByRole" | "waitForResponse" | "waitForFunction">;

/** Runs in the page: the input's value through the prototype's setter (React tracks the instance's own), then one bubbling input event. */
export function setInputValue(element: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("the input has no value setter");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Opens the sign-in page (no field holds a value yet). */
export async function openSignIn(page: FormPage): Promise<void> {
  await page.goto("/signin", { timeout: T.navigate });
}

/** Enters both credentials, clicks Sign in and answers the sign-in POST's status; the answer's wait starts before the click. */
export async function submitSignIn(page: FormPage, email: string, password: string): Promise<number> {
  await page.getByLabel("Email").evaluate(setInputValue, email, { timeout: T.enter });
  await page.getByLabel("Password").evaluate(setInputValue, password, { timeout: T.enter });
  const answer = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/signin" && response.request().method() === "POST", { timeout: T.response });
  answer.catch(() => undefined); // a click that fails leaves this wait to end unobserved
  await page.getByRole("button", { name: "Sign in" }).click({ timeout: T.click });
  return (await answer).status();
}

/** Blanks both fields the page still shows, once the form has settled; bounded, and it never throws. */
export async function clearCredentialFields(page: FormPage): Promise<void> {
  await page.waitForFunction(() => window.location.pathname !== "/signin" || !document.querySelector("button[type=submit]")?.hasAttribute("disabled"), undefined, { timeout: T.settle }).catch(() => undefined);
  for (const label of ["Email", "Password"] as const) {
    const field = page.getByLabel(label);
    if ((await field.count().catch(() => 0)) > 0) await field.evaluate(setInputValue, "", { timeout: T.clear }).catch(() => undefined);
  }
}
