import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ServerConfig } from "../config";

/** Where uploaded resumes (and later, generated PDFs) live. Keys look like users/<id>/resumes/<uuid>.pdf */
export interface FileStorage {
  readonly driver: "local" | "s3" | "memory";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /**
   * A short-lived download link (default 5 minutes). S3: a presigned GET. Local and memory: an
   * HMAC-signed link to /api/files, which also checks the file belongs to the signed-in student.
   */
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
}

export interface SignedUrlOptions {
  /** The name the browser saves the file as. */
  filename: string;
  expiresInSeconds?: number;
}

/** Secret and base URL for locally signed download links. */
export interface LocalSigning {
  secret: string;
  appUrl: string;
}

const DEFAULT_EXPIRY_SECONDS = 300;

/** A file name safe for Content-Disposition: letters, digits, spaces, dot, dash, underscore. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w .-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "download";
}

function localSignature(secret: string, key: string, exp: number, name: string): string {
  return createHmac("sha256", secret).update(`${key}|${exp}|${name}`).digest("base64url");
}

/** Builds a locally signed /api/files link. */
export function signLocalFileUrl(
  signing: LocalSigning,
  key: string,
  options: SignedUrlOptions,
  now: Date = new Date(),
): string {
  assertSafeKey(key);
  const name = safeFilename(options.filename);
  const exp = Math.floor(now.getTime() / 1000) + (options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);
  const url = new URL("/api/files", signing.appUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("name", name);
  url.searchParams.set("sig", localSignature(signing.secret, key, exp, name));
  return url.toString();
}

export type LocalFileUrlCheck =
  | { ok: true; key: string; filename: string }
  | { ok: false; reason: "missing" | "bad_signature" | "expired" | "bad_key" };

/** Verifies a locally signed link's parameters (constant-time signature compare, expiry, key shape). */
export function verifyLocalFileUrl(
  params: { key?: string | null; exp?: string | null; name?: string | null; sig?: string | null },
  secret: string,
  now: Date = new Date(),
): LocalFileUrlCheck {
  const { key, exp, name, sig } = params;
  if (!key || !exp || !name || !sig) return { ok: false, reason: "missing" };
  const expNum = Number(exp);
  if (!Number.isInteger(expNum)) return { ok: false, reason: "missing" };
  const expected = Buffer.from(localSignature(secret, key, expNum, name));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  if (expNum * 1000 < now.getTime()) return { ok: false, reason: "expired" };
  try {
    assertSafeKey(key);
  } catch {
    return { ok: false, reason: "bad_key" };
  }
  return { ok: true, key, filename: name };
}

function requireSigning(signing: LocalSigning | undefined): LocalSigning {
  if (!signing) throw new Error("Download links need a signing secret and app URL");
  return signing;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Unsafe storage key");
  }
}

/** Development storage: files in a folder on this machine. Never used in production (config refuses it). */
export function createLocalStorage(rootDir: string, signing?: LocalSigning): FileStorage {
  const resolve = (key: string) => {
    assertSafeKey(key);
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(path.resolve(rootDir) + path.sep)) throw new Error("Unsafe storage key");
    return full;
  };
  return {
    driver: "local",
    async put(key, body) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async get(key) {
      return new Uint8Array(await readFile(resolve(key)));
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
    async signedUrl(key, options) {
      return signLocalFileUrl(requireSigning(signing), key, options);
    },
  };
}

/** S3-compatible storage (Cloudflare R2, AWS S3, MinIO). Objects are private; encryption at rest is the provider's. */
export function createS3Storage(options: {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): FileStorage {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: Boolean(options.endpoint),
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return {
    driver: "s3",
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      if (!res.Body) throw new Error("Empty object");
      return res.Body.transformToByteArray();
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
    async signedUrl(key, { filename, expiresInSeconds }) {
      assertSafeKey(key);
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeFilename(filename)}"`,
        ResponseCacheControl: "private, no-store",
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS });
    },
  };
}

/** In-memory storage for tests. */
export function createMemoryStorage(signing?: LocalSigning): FileStorage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    driver: "memory",
    files,
    async put(key, body) {
      assertSafeKey(key);
      files.set(key, body);
    },
    async get(key) {
      const file = files.get(key);
      if (!file) throw new Error("Not found");
      return file;
    },
    async delete(key) {
      files.delete(key);
    },
    async signedUrl(key, options) {
      return signLocalFileUrl(requireSigning(signing), key, options);
    },
  };
}

let cached: FileStorage | undefined;

export function getStorage(config: ServerConfig): FileStorage {
  if (cached) return cached;
  if (config.STORAGE_DRIVER === "s3") {
    cached = createS3Storage({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET!,
      accessKeyId: config.S3_ACCESS_KEY!,
      secretAccessKey: config.S3_SECRET_KEY!,
    });
  } else {
    // The web app's next.config.ts defaults this to <repo>/.local/storage.
    if (!config.STORAGE_LOCAL_DIR) throw new Error("STORAGE_LOCAL_DIR must be set when STORAGE_DRIVER=local");
    cached = createLocalStorage(config.STORAGE_LOCAL_DIR, { secret: config.AUTH_SECRET, appUrl: config.APP_URL });
  }
  return cached;
}

/**
 * Decides whether a signed-in student may download a locally signed file: the link must be valid
 * and unexpired, AND the file must be under that student's own folder (users/<id>/).
 */
export function authorizeLocalFileRequest(
  params: { key?: string | null; exp?: string | null; name?: string | null; sig?: string | null },
  userId: string,
  secret: string,
  now: Date = new Date(),
): { ok: true; key: string; filename: string } | { ok: false; status: 403 } {
  const check = verifyLocalFileUrl(params, secret, now);
  if (!check.ok) return { ok: false, status: 403 };
  if (!userId || !check.key.startsWith(`users/${userId}/`)) return { ok: false, status: 403 };
  return check;
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function contentTypeForKey(key: string): string {
  return CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
