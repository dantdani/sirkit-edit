/**
 * [B19-D I5c review] The image source policy is SERVED, not only configured.
 *
 * The chat renderer never emits an <img> for markdown (unit-tested); this header is the second line: even an image element
 * that some future renderer emitted could only load from Sirkit itself, data: or blob:. The unit test reads next.config's
 * headers(); this proves the running application sends it on the page and on an API response.
 */
import { expect, test } from "@playwright/test";

const POLICY = "img-src 'self' data: blob:";

test("the page response carries the image source policy", async ({ page }) => {
  const response = await page.goto("/");
  expect(response, "the page loaded").not.toBeNull();
  expect(response!.headers()["content-security-policy"] ?? "").toContain(POLICY);
});

test("an API response carries it too", async ({ request }) => {
  const response = await request.get("/api/ai/runtime");
  expect(response.headers()["content-security-policy"] ?? "").toContain(POLICY);
});
