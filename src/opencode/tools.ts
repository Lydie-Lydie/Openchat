export const DISABLED_TOOLS: Record<string, boolean> = {
  bash: false,
  edit: false,
  write: false,
  read: false,
  glob: false,
  grep: false,
  webfetch: false,
  websearch: false,
  task: false,
  todowrite: false,
  lsp: false,
  skill: false,
};

/** Everything disabled except the web tools, used for optional search. */
export const SEARCH_TOOLS: Record<string, boolean> = {
  ...DISABLED_TOOLS,
  webfetch: true,
  websearch: true,
};

/**
 * OpenCode 1.18.31 cannot restrict which URLs webfetch may open.
 *
 * Verified on a production host:
 *  - `session.create({ permission })` accepts a ruleset but the patterns are never
 *    matched; the catch-all always wins, so a deny rule cannot block a URL.
 *  - The project `opencode.json` granular object form for `webfetch` is rejected by
 *    the config schema (it only accepts "ask" | "allow" | "deny").
 *
 * The mitigation is network-level: `opencode serve` runs as a dedicated user and
 * `openchat-egress.service` blocks that uid from loopback (new connections only),
 * link-local (169.254.0.0/16, cloud metadata) and private ranges. Prompts also treat
 * tool output as untrusted data.
 *
 * Residual risk: an allowed public endpoint could still be used to exfiltrate context
 * via a crafted URL, so do not enable search on servers you do not control.
 */
export const SEARCH_URL_RESTRICTION_SUPPORTED = false;
