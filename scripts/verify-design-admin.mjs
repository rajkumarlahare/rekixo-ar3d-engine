const origin = 'https://admin.rekixo.com';
async function get(path, kind) {
  const res = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000) });
  if (!res.ok || !res.headers.get('content-type')?.includes(kind))
    throw Error(`Design Admin verification failed: ${path} ${res.status}`);
  return res.text();
}
const html = await get('/3Dprojects/studio', 'text/html');
const entry = html.match(/src="(\/3Dprojects\/assets\/[^" ]+\.js)"/);
if (!entry) throw Error('Missing admin entry script.');
const code = await get(entry[1], 'javascript');
const studio = code.match(/(?:\.\/)?(Studio-[\w-]+\.js)/);
if (!studio) throw Error('The deployed admin has no Studio bundle.');
const editor = await get(`/3Dprojects/assets/${studio[1]}`, 'javascript');
for (const feature of ['3D DESIGN ADMIN', 'Use design for new project', 'Project slug', 'Duplicate furnished floor'])
  if (!editor.includes(feature)) throw Error(`Deployed editor is missing ${feature}.`);
console.log(`Design Admin route, JavaScript and reuse controls verified: ${studio[1]}`);
