declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    QUEUE_AUTOMATION_TOKEN?: string;
  }
}
