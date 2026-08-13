// Backblaze B2 holds the actual photo/video/audio files (no per-file size
// cap the way Supabase's free storage tier had). Supabase still holds the
// structured data (captions, order, title card text) -- see
// assets/supabase-config.js. This key is scoped to only the bucket below
// (see README for the tradeoff, same shape as the Supabase anon key).

window.B2_KEY_ID = "004645a0cb563320000000004";
window.B2_APPLICATION_KEY = "K004G+vArOWYsRaQAsHsqCND4eieUR8";
window.B2_BUCKET_ID = "5604e53ae0ecfbb596f30312";
window.B2_BUCKET_NAME = "PatrickService2026";
window.B2_DOWNLOAD_URL = "https://f004.backblazeb2.com";
window.B2_S3_ENDPOINT = "s3.us-west-004.backblazeb2.com";
window.B2_REGION = "us-west-004";

// Soft cap enforced client-side before each upload (B2 itself has no
// built-in per-bucket quota). Not a hard server-side guarantee, but the
// only person who ever uploads here is going through this same page.
window.B2_MAX_BUCKET_BYTES = 10 * 1024 * 1024 * 1024; // 10GB
