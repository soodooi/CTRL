#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const cliArgs = process.argv.slice(2);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function hasArgument(...names) {
  return cliArgs.some((arg) => names.includes(arg));
}

function argumentValues(...names) {
  const values = [];
  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (names.includes(arg)) {
      const value = cliArgs[index + 1];
      if (!value) fail(`${arg} requires a value`);
      values.push(value);
      index += 1;
      continue;
    }
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
      else if (name.length === 2 && arg.startsWith(name) && arg.length > name.length) {
        values.push(arg.slice(name.length));
      }
    }
  }
  return values;
}

function lastArgumentValue(...names) {
  return argumentValues(...names).at(-1);
}

function loadConfigOverride(value) {
  try {
    if (value.trimStart().startsWith("{")) return JSON.parse(value);
    const overridePath = isAbsolute(value) ? value : resolve(process.cwd(), value);
    return JSON.parse(readFileSync(overridePath, "utf8"));
  } catch (error) {
    fail(
      `cannot safely inspect Tauri config override ${value}: ${error.message}. ` +
        "Use strict JSON so the signing guard can validate it.",
    );
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
}

function signingIdentity() {
  const identity = config.bundle?.macOS?.signingIdentity;
  if (typeof identity !== "string" || identity.trim() === "") {
    fail("bundle.macOS.signingIdentity must be set in src-tauri/tauri.conf.json");
  }
  return identity.trim();
}

function signedBundlePath() {
  if (process.env.CARGO_TARGET_DIR) {
    fail("CARGO_TARGET_DIR is not allowed for the guarded macOS app build");
  }
  const target = lastArgumentValue("--target", "-t");
  if (target && !/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/.test(target)) {
    fail(`invalid Rust target triple: ${target}`);
  }
  const targetRoot = join(root, "src-tauri", "target");
  const releaseDir = target ? join(targetRoot, target, "release") : join(targetRoot, "release");
  return join(releaseDir, "bundle", "macos", `${config.productName}.app`);
}

function verifyConfigOverrides(identity) {
  for (const value of argumentValues("--config", "-c")) {
    const override = loadConfigOverride(value);
    const macOverride = override?.bundle?.macOS;
    if (
      macOverride &&
      Object.prototype.hasOwnProperty.call(macOverride, "signingIdentity") &&
      macOverride.signingIdentity !== identity
    ) {
      fail(
        `refusing macOS signingIdentity override (${String(macOverride.signingIdentity)}); ` +
          `the repository authority is ${identity}`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(override, "productName") &&
      override.productName !== config.productName
    ) {
      fail("productName overrides are not allowed for the guarded macOS app build");
    }
    if (
      Object.prototype.hasOwnProperty.call(override, "identifier") &&
      override.identifier !== config.identifier
    ) {
      fail("identifier overrides are not allowed for the guarded macOS app build");
    }
  }
}

function resolveSigningCertificate(identity) {
  const identities = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
  const identityOutput = `${identities.stdout ?? ""}${identities.stderr ?? ""}`;
  const requested = identity.toLowerCase();
  const matches = new Map();
  for (const line of identityOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\)\s+([0-9a-f]{40})\s+\"([^\"]+)\"/i);
    if (!match) continue;
    const certificate = { fingerprint: match[1].toLowerCase(), label: match[2] };
    if (certificate.fingerprint === requested || certificate.label === identity) {
      matches.set(certificate.fingerprint, certificate);
    }
  }
  if (identities.status !== 0 || matches.size === 0) {
    fail(`macOS code-signing identity \"${identity}\" is unavailable`);
  }
  if (matches.size !== 1) {
    fail(`macOS code-signing identity \"${identity}\" is ambiguous across certificates`);
  }
  return [...matches.values()][0];
}

function verifyBuildInputs(identity) {
  if (hasArgument("--debug", "-d")) {
    fail("--debug/-d is not allowed; use npm run tauri:dev for development or build the signed release app");
  }
  if (hasArgument("--no-sign")) fail("--no-sign is forbidden for macOS app bundles");
  if (hasArgument("--no-bundle")) fail("--no-bundle is not a signed app build");
  verifyConfigOverrides(identity);

  const environmentIdentity = process.env.APPLE_SIGNING_IDENTITY;
  if (environmentIdentity && environmentIdentity !== identity) {
    fail(
      `APPLE_SIGNING_IDENTITY=${environmentIdentity} conflicts with the repository authority ${identity}`,
    );
  }
  return resolveSigningCertificate(identity);
}

function verifySignedBundle(certificate, appPath) {
  if (!existsSync(appPath)) fail(`expected signed app bundle was not produced: ${appPath}`);

  const verification = run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    appPath,
  ]);
  if (verification.status !== 0) {
    process.stderr.write(verification.stderr ?? "");
    fail("codesign verification failed");
  }

  const details = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  const detailOutput = `${details.stdout ?? ""}${details.stderr ?? ""}`;
  if (details.status !== 0 || !detailOutput.includes(`Authority=${certificate.label}`)) {
    fail(`built app is not signed by \"${certificate.label}\"`);
  }
  if (detailOutput.includes("Signature=adhoc")) fail("built app is ad-hoc signed");

  const requirement = run("/usr/bin/codesign", ["-d", "-r-", appPath]);
  const requirementOutput = `${requirement.stdout ?? ""}${requirement.stderr ?? ""}`;
  const normalizedRequirement = requirementOutput.toLowerCase();
  const expectedIdentifier = `identifier \"${config.identifier}\"`.toLowerCase();
  const expectedCertificate = `certificate root = h\"${certificate.fingerprint}\"`;
  if (
    requirement.status !== 0 ||
    !normalizedRequirement.includes(expectedIdentifier) ||
    !normalizedRequirement.includes(expectedCertificate) ||
    normalizedRequirement.includes("cdhash")
  ) {
    fail("built app Designated Requirement does not match the configured certificate and identifier");
  }

  console.log(
    `macOS signing verified: ${certificate.label}; certificate ${certificate.fingerprint}; stable Designated Requirement`,
  );
}

const tauriScript = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(tauriScript)) fail("Tauri CLI is not installed; run npm install first");

let identity;
let certificate;
let appPath;
if (process.platform === "darwin") {
  identity = signingIdentity();
  certificate = verifyBuildInputs(identity);
  appPath = signedBundlePath();
  // A stale bundle must never satisfy post-build verification. Removing only
  // generated output binds the check below to this invocation's artifact.
  // (ADR-003 frontend §1.1 v24)
  rmSync(appPath, { force: true, recursive: true });
}

// Invoke the JavaScript entry directly with Node so the same path works on
// macOS, Linux, and Windows without shell-dependent .cmd execution.
const build = run(process.execPath, [tauriScript, "build", ...cliArgs], {
  env: identity
    ? { ...process.env, APPLE_SIGNING_IDENTITY: identity }
    : process.env,
  stdio: "inherit",
});
if (build.error) fail(build.error.message);
if (build.status !== 0) process.exit(build.status ?? 1);

if (process.platform === "darwin") verifySignedBundle(certificate, appPath);
