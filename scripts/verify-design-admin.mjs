const origin = 'https://admin.rekixo.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path, kind) {
  let diagnostic = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const url = new URL(path, origin);
    url.searchParams.set("_rekixo_verify", `${Date.now()}-${attempt}`);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(30000),
      });
      const type = res.headers.get("content-type") || "";
      if (res.ok && type.includes(kind)) return res.text();
      diagnostic = `HTTP ${res.status}, content-type ${type || "(missing)"}`;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 5) await sleep(3000);
  }
  throw Error(
    `Design Admin verification failed after propagation retries: ${path} (${diagnostic})`,
  );
}
const html = await get('/3Dprojects/studio', 'text/html');
if (!html.includes('href="/3Dprojects/favicon.svg"')) throw Error('Missing 3D Design Admin favicon link.');
const favicon = await get('/3Dprojects/favicon.svg', 'image/svg+xml');
for (const gold of ['#FFD166', '#B77900', '#E4A11B'])
  if (!favicon.includes(gold)) throw Error(`Deployed golden favicon is missing ${gold}.`);
const entry = html.match(/src="(\/3Dprojects\/assets\/[^" ]+\.js)"/);
if (!entry) throw Error('Missing admin entry script.');
const code = await get(entry[1], 'javascript');
const studio = code.match(/(?:\.\/)?(Studio-[\w-]+\.js)/);
if (!studio) throw Error('The deployed admin has no Studio bundle.');
const editor = await get(`/3Dprojects/assets/${studio[1]}`, 'javascript');
for (const feature of ['3D DESIGN ADMIN', 'Use design for new project', 'Project slug', 'Duplicate furnished floor'])
  if (!editor.includes(feature)) throw Error(`Deployed editor is missing ${feature}.`);
console.log(`Design Admin route, JavaScript and reuse controls verified: ${studio[1]}`);
const catalog = JSON.parse(await get('/3Dprojects/published/catalog.json', 'json'));
for (const entry of catalog) {
  const manifest = JSON.parse(await get(`/3Dprojects/published/${entry.slug}/manifest.json`, 'json'));
  if (manifest.project.slug !== entry.slug) throw Error('Published slug mismatch');
  for (const a of manifest.assets) {
    const response = await fetch(`${origin}/3Dprojects/published/${entry.slug}/${a.path}`);
    if (!response.ok) throw Error('Published model unavailable');
    const bytes = await response.arrayBuffer();
    const { createHash } = await import('node:crypto');
    if (bytes.byteLength !== a.size || createHash('sha256').update(Buffer.from(bytes)).digest('hex') !== a.hash) throw Error('Live published model checksum mismatch');
  }
  console.log(`Published design and model verified: ${entry.slug}`);
}
