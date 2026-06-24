import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Workspace package directories the verify script will build and pack.
 *
 * Kept aligned with `packages/*` by convention.
 */
const WORKSPACE_PACKAGES = ["packages/foo", "packages/bar", "packages/baz"] as const;

/** Absolute path to the workspace root that owns `packages/*`. */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/** TCP port the local Hono server binds to during the test run. */
const PORT = Number(process.env.PORT ?? 3000);

/** Origin the throwaway consumer project points its npm registry at. */
const REGISTRY = `http://localhost:${PORT}`;

/** Stylised log prefix so verify output stands out from child process output. */
const verifyLog = (message: string): void => {
  console.log(`\x1b[1;36m[verify]\x1b[0m ${message}`);
};

/**
 * Poll a URL until it returns 2xx or the timeout elapses.
 *
 * Used to wait for the local Hono server to bind its port before
 * sending any real requests.
 */
const waitForServerReady = async (url: string, timeoutMs = 10_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not bound yet; retry
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 200));
  }
  throw new Error(`server at ${url} did not become ready within ${timeoutMs}ms`);
};

/**
 * Shape of the output the in-memory consumer script prints.
 *
 * Verified at the end of the run against an expected shape rather than
 * exact strings so the test stays useful when the package outputs
 * legitimately change on a feature branch.
 */
interface ConsumerOutput {
  readonly foo: string;
  readonly bar: string;
  readonly baz: string;
  readonly names: readonly string[];
}

/** Compile every workspace package's TypeScript so `pnpm pack` has dist output to ship. */
const buildWorkspacePackages = (): void => {
  for (const packageDirectory of WORKSPACE_PACKAGES) {
    const result = spawnSync("corepack", ["pnpm", "exec", "tsc", "-p", "tsconfig.json"], {
      cwd: join(REPO_ROOT, packageDirectory),
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`build failed for ${packageDirectory}`);
    }
  }
};

/** Pack and upload every workspace package into the local FS blob store. */
const stageWorkspaceSnapshots = (): void => {
  const result = spawnSync(
    "corepack",
    ["pnpm", "tsx", "apps/preview-registry/scripts/stage-local.ts"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, LOCAL_BRANCH: "local", PUBLIC_BASE: REGISTRY },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error("staging failed");
};

/**
 * Scaffold a throwaway consumer project that resolves
 * `@mridang/*` packages against the local registry.
 */
const writeConsumerProject = (consumerDirectory: string): void => {
  mkdirSync(consumerDirectory, { recursive: true });
  writeFileSync(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      { name: "consumer-spike", version: "0.0.0", private: true, type: "module" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumerDirectory, ".npmrc"),
    `registry=${REGISTRY}\n@mridang:registry=${REGISTRY}\n`,
  );
  writeFileSync(
    join(consumerDirectory, "run.mjs"),
    `import { greet, PKG as FOO } from '@mridang/foo'
import { loudGreet, PKG as BAR } from '@mridang/bar'
import { baz, PKG as BAZ } from '@mridang/baz'
const output = { foo: greet('world'), bar: loudGreet('world'), baz: baz(), names: [FOO, BAR, BAZ] }
console.log(JSON.stringify(output))
`,
  );
};

/**
 * Parse the consumer project's stdout and fail the script if any
 * field is missing, empty, or mis-shaped. Content-agnostic so the
 * check survives PRs that legitimately change package output.
 */
const assertConsumerOutput = (raw: string): void => {
  const parsed = JSON.parse(raw.trim()) as ConsumerOutput;
  const expectedNames = ["@mridang/foo", "@mridang/bar", "@mridang/baz"];
  const ok =
    typeof parsed.foo === "string" &&
    parsed.foo.length > 0 &&
    typeof parsed.bar === "string" &&
    parsed.bar.length > 0 &&
    typeof parsed.baz === "string" &&
    parsed.baz.length > 0 &&
    parsed.bar === parsed.foo.toUpperCase() &&
    JSON.stringify(parsed.names) === JSON.stringify(expectedNames);
  if (!ok) {
    console.error("FAIL: got", parsed);
    throw new Error("runtime mismatch");
  }
  verifyLog("\x1b[1;32mPASS\x1b[0m — packages installed from local registry and ran correctly");
  verifyLog(JSON.stringify(parsed));
};

/**
 * Drive the full local round-trip: spawn the Hono registry, build and
 * stage every workspace package, install them into a throwaway consumer
 * project pointed at the registry, and assert the imported code runs.
 */
const verifyEndToEnd = async (): Promise<void> => {
  const consumerDirectory = mkdtempSync(join(tmpdir(), "consumer-"));
  let server: ReturnType<typeof spawn> | undefined;

  try {
    verifyLog("starting local-server");
    server = spawn("corepack", ["pnpm", "tsx", "apps/preview-registry/scripts/local-server.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => process.stdout.write(`  [server] ${chunk}`));
    server.stderr?.on("data", (chunk) => process.stderr.write(`  [server!] ${chunk}`));

    await waitForServerReady(`${REGISTRY}/-/ping`);
    verifyLog("server up");

    verifyLog("building workspace packages");
    buildWorkspacePackages();

    verifyLog("staging tarballs to FS blob store");
    stageWorkspaceSnapshots();

    verifyLog(`probing packument @mridang/foo via ${REGISTRY}`);
    const packumentResponse = await fetch(`${REGISTRY}/@mridang/foo`);
    if (!packumentResponse.ok) {
      throw new Error(`packument GET failed: ${packumentResponse.status}`);
    }
    const packument = (await packumentResponse.json()) as {
      readonly name: string;
      readonly "dist-tags": Readonly<Record<string, string>>;
    };
    verifyLog(`packument ok: name=${packument.name} latest=${packument["dist-tags"].latest}`);

    verifyLog(`writing consumer project at ${consumerDirectory}`);
    writeConsumerProject(consumerDirectory);

    verifyLog("npm install from local registry");
    const installResult = spawnSync(
      "npm",
      ["install", "@mridang/foo", "@mridang/bar", "@mridang/baz"],
      { cwd: consumerDirectory, stdio: "inherit" },
    );
    if (installResult.status !== 0) throw new Error("npm install failed");

    verifyLog("importing and exercising installed packages");
    const runResult = spawnSync("node", ["run.mjs"], {
      cwd: consumerDirectory,
      encoding: "utf8",
    });
    if (runResult.status !== 0) {
      console.error(runResult.stderr);
      throw new Error("consumer run failed");
    }
    assertConsumerOutput(runResult.stdout);
  } finally {
    if (server) server.kill("SIGTERM");
    rmSync(consumerDirectory, { recursive: true, force: true });
  }
};

await verifyEndToEnd();
