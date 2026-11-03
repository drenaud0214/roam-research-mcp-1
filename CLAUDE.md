# CLAUDE.md — roam-research-mcp

David's fork of the upstream Roam Research MCP server and `roam` CLI.
`README.md` is upstream's and describes the project; this file is how to work
in this clone. The clone is `~/system/roam-research-mcp` on the Air and
`~/dev/roam-research-mcp` on the Mini.

## Branch and remotes

- **Work on `david-main`.** It tracks `fork` (`drenaud0214/roam-research-mcp-1`),
  so a plain `git push` goes there. The machines sync pulls `david-main` from
  `fork` on both Macs (`repos.conf`).
- **`origin` is the upstream, `2b3pro/roam-research-mcp`: never push to it.**
  Fetch from it and merge `origin/main` into `david-main` to take upstream work.
- **`backup` (`drenaud0214/roam-research-mcp`) is an older copy**: one branch,
  `main`, upstream v2.18.2 plus a task-aging commit that `david-main` does not
  have. Nothing syncs to it; don't push there.

## Build

`build/` is git-ignored, so a pull or a merge changes nothing that runs until
you rebuild:

```bash
npm ci          # only when package-lock.json changed
npm run build   # tsc -> build/index.js (the MCP server) and build/cli/roam.js (the CLI)
npm test        # vitest
```

## What runs this build

- The **Convexity**, **Know_Stack** and **Zettel_Graph** MCP servers all run
  `node <this clone>/build/index.js`, one per graph, in Claude Code
  (`~/.claude.json`) and in the Claude app. **A rebuild changes all three.**
  Each picks it up when its server restarts: a new Claude Code session, or a
  restart of the app.
- Those entries come from claude-home's `mcp/servers.json`, written out by
  `mcp/render.py`. Change them there, not in `~/.claude.json`.
- `build/cli/roam.js` is the `roam` CLI that knowledge-system's
  `wiki/roam-js/scripts/deploy.sh` runs.
