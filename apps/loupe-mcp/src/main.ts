// The fourth process in the estate: a stdio MCP server in front of one loupe
// app.
//
// Everything it needs arrives on argv, because a harness reading `.mcp.json`
// is the only thing that ever starts it. STDOUT IS THE WIRE — a stdio MCP
// transport carries JSON-RPC on it and nothing else — so every word this
// process says to a human goes to stderr, where the harness's server log
// picks it up.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { wsClient } from '@loupe/client';
import { parseArgs, type McpArgs } from './args.ts';
import { ReservedVerbNameError, createLoupeMcp, manifestUnreadableNote } from './server.ts';

function readArgs(): McpArgs {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

const args = readArgs();

// wsClient, not httpClient: `await` and the resource subscriptions both want
// a push, and wsClient already falls back to the poll twin — the same
// `/loupe/records` and `?after=seq` routes httpClient uses — whenever the
// socket is down. One transport, both behaviours, chosen once here.
const client = wsClient(args.app, args.actor !== null ? { actor: args.actor } : {});
// `appUrl` is handed over as well as being the client's base: the client hides
// it, and the server has two things to say that must name it — the sentence an
// unreachable app owes an `await`, and the one probe (`/loupe/records`) that
// tells an app predating the record wire from an app with nothing to say.
const { server, refresh } = createLoupeMcp({
  client,
  awaitTimeoutMs: args.awaitTimeoutMs,
  appUrl: args.app,
});

// Read the manifest before answering anything, so a misconfigured `--app` is
// one sentence at startup rather than a surprise on the first tool call. It
// is NOT fatal: the app may simply not be up yet, and a server that exits
// over that has to be restarted by hand, while one that stays answers
// correctly the moment the app appears — `tools/list` re-reads the manifest
// every time it is asked.
try {
  const app = await refresh();
  console.error(
    `loupe-mcp: ${app.app.name} ${app.app.version} at ${args.app} — ${app.verbs.length} verbs, ` +
      `${app.projections.length} projections` +
      (args.actor !== null
        ? `, signing as ${args.actor}`
        : ', signing nothing (every record will carry the app’s own actor)'),
  );
} catch (err) {
  // TWO FAILURES, TWO ENDINGS. An app that is down recovers by itself — the
  // manifest is re-read on every `tools/list` — so the server stays up and
  // says so. An app whose manifest declares a verb named `snapshot` or
  // `await` never recovers: every `tools/list` would throw the same refusal
  // for the life of the process while this line claimed it was serving. That
  // one is a configuration error, and a configuration error exits.
  if (err instanceof ReservedVerbNameError) {
    console.error(`loupe-mcp: ${err.message} Fix the app's manifest, or point --app at a different app.`);
    process.exit(2);
  }
  console.error(`loupe-mcp: ${manifestUnreadableNote(args.app, err)} Serving anyway.`);
}

await server.connect(new StdioServerTransport());
