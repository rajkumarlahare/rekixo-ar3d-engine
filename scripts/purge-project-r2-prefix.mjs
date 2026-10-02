const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET || "rekixo-3d-assets";
const prefix = process.env.R2_PREFIX || "projects/";
const confirm = process.env.CONFIRM_ENGINE_PROJECT_PURGE;

if (!token || !accountId)
  throw new Error("Cloudflare account/token environment is required.");
if (confirm !== "DELETE_ENGINE_PROJECT_DATA")
  throw new Error("Refusing R2 purge without explicit confirmation.");
if (!prefix || prefix === "/")
  throw new Error("Refusing unsafe R2 prefix.");

const base =
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
};

async function api(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok || payload?.success === false)
    throw new Error(`Cloudflare R2 API failed (${response.status}): ${JSON.stringify(payload).slice(0,1200)}`);
  return payload;
}

function objectUrl(key) {
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function listAll() {
  const keys = [];
  let cursor = "";
  do {
    const url = new URL(base);
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await api(url);
    for (const item of page.result || []) if (typeof item?.key === "string") keys.push(item.key);
    cursor = page.result_info?.is_truncated ? String(page.result_info?.cursor || "") : "";
  } while (cursor);
  return keys;
}

const keys = await listAll();
console.log(`Engine R2 project purge: found ${keys.length} object(s) under ${prefix}`);

const concurrency = 12;
for (let i = 0; i < keys.length; i += concurrency) {
  const batch = keys.slice(i, i + concurrency);
  await Promise.all(batch.map((key) => api(objectUrl(key), { method: "DELETE" })));
  console.log(`Deleted ${Math.min(i + batch.length, keys.length)}/${keys.length}`);
}

const remaining = await listAll();
if (remaining.length)
  throw new Error(`R2 project purge incomplete: ${remaining.length} object(s) remain.`);

console.log("Engine R2 project prefix is empty.");
