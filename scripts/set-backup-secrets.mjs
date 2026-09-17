/**
 * Sets the GitHub secrets backup.nightly uploads with — but only after
 * proving the key pair can actually write to the backup bucket.
 *
 * Why this exists: GitHub secrets are write-only, so a wrong paste (the
 * read-only token, the Cloudflare "Token value", a key ID and secret from two
 * different rolls) only shows up a night later as AccessDenied or
 * SignatureDoesNotMatch. This tests the exact values it is about to store:
 * PutObject → HeadObject → DeleteObject on a throwaway key, then `gh secret
 * set`. Nothing is echoed or written to disk.
 *
 *   node scripts/set-backup-secrets.mjs
 *
 * Needs the `apex-backups-write` token (Object Read & Write, apex-backups
 * only) — NOT the read-only one in .env.local, which belongs to backup.verify.
 */
import { execFileSync } from "node:child_process";
import readline from "node:readline";
import { config } from "dotenv";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

config({ path: ".env.local", quiet: true });

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BACKUP_BUCKET;
if (!accountId || !bucket) fail("R2_ACCOUNT_ID and R2_BACKUP_BUCKET must be set in .env.local");

function fail(message) {
  console.error(`\n✗ ${message}\n  Nothing was saved to GitHub.`);
  process.exit(1);
}

// One interface and a line queue for both prompts — input can arrive before
// the second prompt is asked (a fast paste, or piped), and must not be lost.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hiding = false;
const writeToOutput = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => {
  if (!hiding) writeToOutput(s);
};
const lines = [];
const waiters = [];
rl.on("line", (line) => (waiters.length ? waiters.shift()(line) : lines.push(line)));
rl.on("close", () => waiters.splice(0).forEach((w) => w("")));

async function ask(question, hidden) {
  process.stdout.write(question);
  hiding = hidden;
  const answer = lines.length ? lines.shift() : await new Promise((resolve) => waiters.push(resolve));
  hiding = false;
  if (hidden) process.stdout.write("\n");
  return answer.trim();
}

console.log(`Bucket: ${bucket}   (from .env.local)\n`);
const keyId = await ask("Access Key ID of apex-backups-write: ", false);
const secret = await ask("Secret Access Key (hidden as you paste): ", true);
rl.close();

if (!/^[0-9a-f]{32}$/.test(keyId)) fail("Access Key ID must be 32 characters of 0-9/a-f.");
if (!/^[0-9a-f]{64}$/.test(secret)) {
  fail("Secret Access Key must be 64 characters of 0-9/a-f. The Cloudflare 'Token value' is not it.");
}
if (keyId === process.env.R2_BACKUP_ACCESS_KEY_ID) {
  fail("That is the read-only token from .env.local. Use apex-backups-write.");
}
if (keyId === process.env.R2_ACCESS_KEY_ID) fail("That is the app token (apex-app-production). Use apex-backups-write.");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: keyId, secretAccessKey: secret },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const testKey = `healthcheck/write-test-${Date.now()}.txt`;
try {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: testKey, Body: "backup write test" }));
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: testKey }));
} catch (e) {
  const hint =
    e.name === "SignatureDoesNotMatch"
      ? "This Secret Access Key does not belong to this Access Key ID. Roll apex-backups-write and copy BOTH from the same screen."
      : e.name === "AccessDenied"
        ? "The key works but cannot write here. The token needs Object Read & Write on apex-backups."
        : e.name === "InvalidAccessKeyId" || e.name === "Unauthorized"
          ? "Cloudflare does not recognise this Access Key ID (deleted or rolled token?)."
          : "";
  fail(`Write test failed: ${e.name}. ${hint}`);
}
console.log(`✓ Wrote and read back ${bucket}/${testKey}`);
try {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
  console.log("✓ Removed the test object");
} catch (e) {
  console.warn(`! Could not remove the test object (${e.name}) — harmless, delete it in the dashboard if you like`);
}

for (const [name, value] of [
  ["R2_BACKUP_ACCESS_KEY_ID", keyId],
  ["R2_BACKUP_SECRET_ACCESS_KEY", secret],
  ["R2_BACKUP_BUCKET", bucket],
]) {
  execFileSync("gh", ["secret", "set", name], { input: value, stdio: ["pipe", "ignore", "inherit"] });
  console.log(`✓ Saved GitHub secret ${name}`);
}
console.log("\nDone. The verified pair is now what backup.nightly uses.");
