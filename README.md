# skills-lock

**The lock layer for agent skills.** Skills are declared in `package.json`,
pinned to exact commits and content hashes in `skills-lock.json`, and
installed into agent directories (`.claude/skills/`, `.cursor/skills/`, …)
with one command. Like a package manager's lockfile workflow, but the
packages are `SKILL.md` directories and the registry is any git repo.

```jsonc
// package.json
{
  "skills": {
    "frontend-design": "anthropics/skills",
    "code-review": "acme/skills#v2.1.0",
    "deploy": { "source": "acme/skills#v2.1.0", "path": "ops/deploy" }
  },
  "skillsConfig": { "agents": ["claude-code", "cursor"] }
}
```

```console
$ skills-lock install
+ frontend-design  anthropics/skills @ 575462609294  → claude-code, cursor
+ code-review      acme/skills#v2.1.0 @ 8f3c2a19bd04  → claude-code, cursor
+ deploy           acme/skills#v2.1.0 @ 8f3c2a19bd04  → claude-code, cursor
✓ 3 skill(s) installed, skills-lock.json written
```

Commit `skills-lock.json`. Teammates and CI run `skills-lock install --frozen`
and get byte-identical skills, verified by content hash — or a hard failure.

## Why

Skills today are distributed imperatively: `npx skills add owner/repo`
fetches whatever is on `main` right now and vendors it into your repo. That
leaves four gaps that every package ecosystem solved years ago:

1. **No manifest.** There is no record of which skills a project depends on,
   so there is no "clone and restore" workflow.
2. **No version pinning.** Fetching a branch head means upstream edits change
   your agents' behavior silently. A skill is a *prompt injected into a
   privileged agent* — silent drift is a supply-chain problem, not just a
   reproducibility annoyance.
3. **No lockfile / integrity.** Even a pinned tag can be force-moved.
   Content hashes make tampering loud.
4. **No CI story.** `--frozen` is what lets a pipeline assert "the skills in
   this build are exactly the ones the team reviewed."

`package.json` already sits in most repos and tolerates extra fields. It
would suffice as the standard manifest — this tool is the existence proof.

## Install

```console
$ npm install -g skills-lock    # or: npx skills-lock ...
```

Requires Node ≥ 18 and git. Zero runtime dependencies.

## Commands

| Command | What it does |
|---|---|
| `skills-lock install` | Resolve + install everything in `"skills"`, write `skills-lock.json`. Already-locked skills are **not** re-resolved — the pin holds until you ask. |
| `skills-lock install --frozen` | CI mode: no resolution, no lockfile writes. Fails if the lock is missing, out of sync with `package.json`, or any content hash mismatches. |
| `skills-lock add <source> [--skill name]… [--path dir] [--list]` | Discover skills in a source, add them to `package.json`, install. `--list` previews without installing. |
| `skills-lock update [name…]` | Re-resolve floating refs (e.g. `#main`) to their current commit and re-pin. The only command that moves a pin. |
| `skills-lock remove <name…>` | Remove from manifest, lockfile, and all agent directories. |
| `skills-lock list` | Declared skills with their pinned commits. |

## Sources

```
owner/repo                  GitHub shorthand, repo default branch
owner/repo#v1.2.0           pinned to a tag (also: branch or full commit SHA)
github:owner/repo#ref       explicit prefix
https://host/repo.git#ref   any git remote (GitLab, internal mirrors, …)
file:../team-skills         local directory — no pinning, integrity only
```

A repo can host many skills (a catalog): `skills-lock` finds every `SKILL.md`
and matches by frontmatter `name`, falling back to directory name. When a
name is ambiguous, use the long form `{ "source": …, "path": … }`.

## The lockfile

```json
{
  "lockfileVersion": 1,
  "skills": {
    "frontend-design": {
      "spec": "anthropics/skills",
      "resolved": "https://github.com/anthropics/skills.git",
      "ref": null,
      "commit": "57546260929473d4e0d1c1bb75297be2fdfa1949",
      "path": "skills/frontend-design",
      "integrity": "sha256-ZlxYVFXey8sCEWvJKK31FIuc0PZ7frSQjIwNZHwA9oo="
    }
  }
}
```

`commit` pins the source; `integrity` is a sha256 over the skill directory's
file tree, so even a rewritten tag or a poisoned cache cannot slip modified
instructions past `--frozen`.

## Agents

Default target is `claude-code` (`.claude/skills/`). Configure more in
`package.json`:

```json
{
  "skillsConfig": {
    "agents": ["claude-code", "cursor", "my-agent"],
    "agentDirs": { "my-agent": ".my-agent/skills" }
  }
}
```

Built-in: `claude-code`, `cursor`, `opencode`, `windsurf`, `github-copilot`,
`amp`, `universal` (`.agents/skills`).

## CI

```yaml
- run: npx skills-lock install --frozen
```

Set `SKILLS_LOCK_CACHE` to relocate the git checkout cache (default:
`.skills/cache/` in the project, auto-gitignored) — useful for sharing a
cache directory across CI jobs.

## Security

A skill is a prompt injected into a privileged agent, and the manifest that
selects skills is often written by someone other than the person running the
install — you clone a repo and run `skills-lock install` to restore *its*
skills. So the threat model treats `package.json` and `skills-lock.json` as
**untrusted input**, and running `install` against a hostile manifest must
not execute code or touch anything outside the project.

What that means concretely:

- **Source transports are allowlisted.** Only `http(s)://`, `git://`,
  `ssh://`, and explicit local paths are accepted. Git's `ext::` transport
  (which runs an arbitrary command) and other schemes are refused — including
  via the `git+` prefix, which does not bypass the check.
- **No git argument injection.** Refs and URLs may not begin with `-`, and
  `--` terminates option parsing before any user value reaches `git`. Commits
  read from the lockfile must be full 40-hex SHAs before they touch git.
- **No path escapes.** Skill names are restricted to a safe directory
  charset; the install destination, `entry.path`, and `skillsConfig.agentDirs`
  overrides are all asserted to stay inside their expected directory before
  any recursive remove or copy.
- **No symlinks.** A skill tree containing a symlink is refused, closing both
  the integrity-hash bypass (symlinks evade content hashing) and the
  arbitrary-file-read risk (a symlink copied into an agent dir pointing at,
  say, `~/.ssh/id_rsa`).
- **Integrity is verified.** `install --frozen` recomputes a sha256 tree hash
  of each skill and fails on any mismatch, so a rewritten tag or a poisoned
  cache cannot slip modified instructions past CI.

These guarantees are covered by adversarial regression tests in
`test/e2e.mjs` (each asserts the *absence* of the bad effect — no executed
payload, victim directories left intact — not merely that an error is shown).

Two residual notes: `file:` sources are inherently local-trust (they read a
path you put in your own manifest), and `ssh://` hostname hardening relies on
your installed git (use git ≥ 2.30). Found a gap? Please open an issue.

## How this relates to prior art

| | manifest | lockfile | pinning | integrity | new infra needed |
|---|---|---|---|---|---|
| `npx skills add` (skills.sh) | — | — | ref in URL, not recorded | — | none |
| `paks` | per-skill frontmatter | — | `--version` at install | — | own registry |
| pixi/conda ([pavel.pink](https://pavel.pink/blog/pixi-skills/)) | `pixi.toml` | `pixi.lock` | semver | conda hashes | conda packaging + pixi in every project |
| **skills-lock** | `package.json` | `skills-lock.json` | tag/branch/SHA → commit | sha256 tree hash | none — any git repo is a registry |

The pixi approach is the most complete (conda's `run_constraints` can even
couple a skill's version to the library it documents) but demands conda
tooling in every consuming project. `skills-lock` deliberately targets the
other end: zero new infrastructure over the way skills are *already*
distributed — git repos of `SKILL.md` directories.

## Status & direction

This is a working prototype making a standards argument: **the manifest
format for agent skills should be `package.json`, and installs should be
lockfile-driven.** The ideal endgame is not another tool — it's this
workflow (manifest + lock + `--frozen`) absorbed into the ecosystem leader
(`vercel-labs/skills`), whose agent-directory map already covers 70+ agents.

Not yet handled, by design or by youth:

- **Semver ranges** (`^1.2`) — would resolve against git tags; pinned refs
  cover the core need first.
- **Global scope** (`~/.claude/skills`) — project scope is where
  reproducibility matters most.
- **Skill dependencies** — `SKILL.md` frontmatter has no standard field yet.
- **Symlink installs** — copies are maximally compatible; symlinks into the
  cache would give a single source of truth.

## License

MIT
