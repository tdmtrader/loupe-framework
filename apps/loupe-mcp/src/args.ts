// The three flags the launcher sets, and nothing else.
//
// A stdio MCP server is started by a harness reading `.mcp.json`, which means
// its whole configuration is one argv line written by a human once. There is
// no config file to fall back on and no prompt to ask, so a flag that is
// missing or malformed must SAY SO on stderr and exit rather than start a
// server that answers every tool with a transport error. `--app` is the one
// flag with no defensible default: the server is generic over any loupe app
// (§5.5), so it cannot guess which one.
//
// Parsing lives here rather than in `main.ts` so it can be exercised without
// a process, which is also why it takes argv and returns a value instead of
// reading `process.argv` and calling `exit`.

/**
 * The default `await` timeout, stated in the tool's own description so the
 * model reads the number rather than inferring one (R3: "the default timeout
 * is a served constant the tool description states"). Two minutes is long
 * enough that a human deciding a finding is not racing it, and short enough
 * that a harness with a per-call ceiling under it fails visibly on the first
 * call rather than mysteriously on the tenth.
 */
export const DEFAULT_AWAIT_TIMEOUT_MS = 120_000;

export interface McpArgs {
  /** Base URL of the loupe app this server is a transport for. */
  app: string;
  /**
   * The name this server signs its dispatches with (`X-Loupe-Actor`). `null`
   * — the default — sends no header at all, and the app stamps its configured
   * actor, which for a screen-facing app is the human. R4's whole point is that an
   * agent should not sign the human's name, so a server started without this
   * flag is a server whose records are indistinguishable from a person's.
   */
  actor: string | null;
  awaitTimeoutMs: number;
}

/**
 * The same expression `@loupe/serve` tests `X-Loupe-Actor` against
 * (`ACTOR_NAME`, `serve/src/index.ts`), restated here on purpose.
 *
 * It is a duplicate rather than an import because this package may import
 * `@loupe/client` and `@loupe/protocol` and nothing else, and it is worth the
 * duplication: the serve side's response to a name it does not like is to
 * IGNORE the header and stamp the app's own actor — silently, correctly, and
 * indistinguishably from a server that was never given `--actor` at all. So a
 * typo'd actor does not fail; it signs the human's name to the agent's
 * records, which is the exact mistake R4 exists to prevent. Refusing here, at
 * startup, in one sentence, is the only place the mistake is visible.
 *
 * The README's registration placeholder is `<your-agent-name>` for this reason: it does
 * NOT match, so an unedited entry exits 2 with a sentence instead of quietly
 * shipping records signed by nobody in particular.
 */
const ACTOR_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export const USAGE =
  'loupe-mcp --app <base url> [--actor <name>] [--await-timeout-ms <ms>]\n' +
  '  --app               required; the loupe app to be a transport for, e.g. http://127.0.0.1:6182\n' +
  '  --actor             the name every record this server writes carries; unset sends no identity\n' +
  `  --await-timeout-ms  how long the await tool blocks before answering empty (default ${DEFAULT_AWAIT_TIMEOUT_MS})`;

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value.\n\n${USAGE}`);
  }
  return value;
}

/**
 * argv (already sliced past node and the script) → the three settings. Throws
 * an Error whose message is the whole sentence a human needs; `main.ts` prints
 * it and exits, so every refusal here is readable in a harness's server log.
 */
export function parseArgs(argv: readonly string[]): McpArgs {
  let app: string | null = null;
  let actor: string | null = null;
  let awaitTimeoutMs = DEFAULT_AWAIT_TIMEOUT_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    switch (flag) {
      case '--app':
        app = requireValue(flag, argv[i + 1]);
        i += 1;
        break;
      case '--actor': {
        const raw = requireValue(flag, argv[i + 1]);
        if (!ACTOR_NAME.test(raw)) {
          throw new Error(
            `--actor ${raw} is not a name the app will accept: it must be 1–64 characters of letters, ` +
              'digits, dot, underscore or hyphen (the harness ignores anything else and stamps its own ' +
              'actor instead, so the records would be signed by the human). If this is still the ' +
              'registration placeholder, replace it with this agent’s own name.' +
              `\n\n${USAGE}`,
          );
        }
        actor = raw;
        i += 1;
        break;
      }
      case '--await-timeout-ms': {
        const raw = requireValue(flag, argv[i + 1]);
        const ms = Number(raw);
        if (!Number.isInteger(ms) || ms <= 0) {
          throw new Error(`--await-timeout-ms must be a positive whole number of milliseconds, not ${raw}.\n\n${USAGE}`);
        }
        awaitTimeoutMs = ms;
        i += 1;
        break;
      }
      default:
        throw new Error(`unknown flag ${flag}.\n\n${USAGE}`);
    }
  }

  if (app === null) throw new Error(`--app is required: this server is generic over any loupe app and cannot guess one.\n\n${USAGE}`);
  // A base URL, not a host: the client appends `/loupe/...` to it and the WS
  // path is derived from the scheme, so a value that is not a URL fails here
  // — one sentence at startup — rather than inside every fetch. The SCHEME is
  // checked too, because `new URL` alone does not refuse `localhost:6182`: it
  // reads it as the scheme `localhost:` with the path `6182`, and the failure
  // would surface a fetch at a time as an unhelpful `Failed to parse URL`.
  let parsed: URL;
  try {
    parsed = new URL(app);
  } catch {
    throw new Error(`--app must be a base URL, e.g. http://127.0.0.1:6182 — got ${app}.\n\n${USAGE}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `--app must be a base URL over http or https, e.g. http://127.0.0.1:6182 — got ${app}, whose ` +
        `scheme is ${parsed.protocol}.\n\n${USAGE}`,
    );
  }

  return { app, actor, awaitTimeoutMs };
}
