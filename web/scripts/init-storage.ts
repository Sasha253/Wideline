// Creates the bucket if it does not exist. Run by the `init` compose service.
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { bucket, s3Internal } from "../src/server/storage";

const s3 = s3Internal();
const name = bucket();

for (let attempt = 1; ; attempt++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    console.log(`bucket ${name} exists`);
    break;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: name }));
      console.log(`bucket ${name} created`);
      break;
    }
    // Storage may still be starting.
    if (attempt >= 20) throw err;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
