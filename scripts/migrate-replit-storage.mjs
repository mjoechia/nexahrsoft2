/**
 * migrate-replit-storage.mjs
 *
 * RUN THIS INSIDE REPLIT (not locally).
 * It downloads every file from Replit Object Storage and re-uploads to Supabase.
 *
 * Usage (in Replit shell):
 *   SUPABASE_URL=https://nqnhyxdwqwufdgprodcs.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<your-key> \
 *   node scripts/migrate-replit-storage.mjs
 */

import { Client } from "@replit/object-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const replitStorage = new Client();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Bucket routing — adjust if needed
// Public:  logos, favicons, clock-in logos → nexahrsoft-public
// Private: MC docs, receipts, employee docs → nexahrsoft-private
function getBucket(key) {
  const lower = key.toLowerCase();
  if (
    lower.includes("logo") ||
    lower.includes("favicon") ||
    lower.includes("branding") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".webp")
  ) {
    return "nexahrsoft-public";
  }
  return "nexahrsoft-private";
}

function getContentType(key) {
  const ext = key.split(".").pop()?.toLowerCase();
  const map = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    ico: "image/x-icon", pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

async function main() {
  console.log("Listing all objects in Replit storage...");
  const { ok, value: objects, error } = await replitStorage.list();
  if (!ok) {
    console.error("Failed to list objects:", error);
    process.exit(1);
  }

  console.log(`Found ${objects.length} objects\n`);

  let success = 0, failed = 0;

  for (const obj of objects) {
    const key = obj.name;
    try {
      // Download from Replit
      const { ok, value: data, error } = await replitStorage.downloadAsBytes(key);
      if (!ok) throw new Error(error);

      const buffer = Buffer.from(data);
      const bucket = getBucket(key);
      const contentType = getContentType(key);

      // Upload to Supabase
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(key, buffer, { contentType, upsert: true });

      if (uploadError) throw new Error(uploadError.message);

      console.log(`✓ [${bucket}] ${key} (${buffer.length} bytes)`);
      success++;
    } catch (err) {
      console.error(`✗ ${key}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} uploaded, ${failed} failed.`);

  // Print public URLs for any public files
  if (success > 0) {
    console.log("\nPublic URLs:");
    for (const obj of objects) {
      if (getBucket(obj.name) === "nexahrsoft-public") {
        const { data } = supabase.storage.from("nexahrsoft-public").getPublicUrl(obj.name);
        console.log(`  ${obj.name} → ${data.publicUrl}`);
      }
    }
  }
}

main().catch(console.error);
