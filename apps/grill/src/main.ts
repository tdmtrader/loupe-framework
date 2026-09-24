// loupe-grill: node on 127.0.0.1:6182. Two loupe-owned jsonl streams in
// LOUPE_GRILL_DIR; fs.watch repaints open fabrials when the agent asks.
import { resolve } from 'node:path';
import { createGrillApp, watchGrill } from './app.ts';

const HOST = process.env['LOUPE_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['LOUPE_PORT'] ?? 6182);
const grillDir = resolve(process.env['LOUPE_GRILL_DIR'] ?? '.grill');

const app = createGrillApp(grillDir);
await app.listen(PORT, HOST);
watchGrill(app, grillDir);
console.log(`loupe-grill on http://${HOST}:${PORT} (grill: ${grillDir})`);
