import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ServerConfig } from "../config";

/** Where uploaded resumes (and later, generated PDFs) live. Keys look like users/<id>/resumes/<uuid>.pdf */
export interface FileStorage {
  readonly driver: "local" | "s3" | "memory";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Unsafe storage key");
  }
}

/** Development storage: files in a folder on this machine. Never used in production (config refuses it). */
export function createLocalStorage(rootDir: string): FileStorage {
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
  };
}

/** In-memory storage for tests. */
export function createMemoryStorage(): FileStorage & { files: Map<string, Uint8Array> } {
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
    cached = createLocalStorage(config.STORAGE_LOCAL_DIR);
  }
  return cached;
}
