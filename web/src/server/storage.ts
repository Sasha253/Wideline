import { S3Client } from "@aws-sdk/client-s3";

/**
 * S3 clients. Only the S3 API is used, so RustFS (local) and Hetzner Object
 * Storage (production) are interchangeable by configuration.
 *
 *  - internal: server-side calls from inside the network.
 *  - public: signs presigned URLs. A signature covers the host, so URLs must be
 *    signed for the hostname the browser or worker will actually use.
 */

function client(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

let internal: S3Client | undefined;
let publicClient: S3Client | undefined;

export function s3Internal(): S3Client {
  internal ??= client(process.env.S3_INTERNAL_ENDPOINT ?? "http://localhost:9000");
  return internal;
}

export function s3Public(): S3Client {
  publicClient ??= client(process.env.S3_PUBLIC_ENDPOINT ?? "http://s3.wideline.localhost");
  return publicClient;
}

export function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
}
