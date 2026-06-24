import { Hono } from "hono";

/**
 * Throwaway second Vercel project so we can prove two Vercel projects
 * coexist in the same monorepo without interfering with the
 * preview-registry deploy.
 */
const app = new Hono();

app.get("/", (context) => context.text("hello from app/hello\n"));
app.get("/-/ping", (context) => context.text("OK"));
app.get("/whoami", (context) =>
  context.json({
    app: "@mridang/hello",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
    sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  }),
);

/**
 * Vercel `@vercel/node` Fetch handler export. See
 * `apps/preview-registry/api/registry.ts` for the full rationale on
 * why we export `fetch` rather than `default`.
 */
export const fetch = app.fetch;
