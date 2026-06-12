import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  })
}

const FULL_SHA = /^[0-9a-f]{40}$/

// Resolve a ref (tag, branch, SHA, or null for the default branch) to a
// full commit SHA without cloning.
export function resolveRef(url, ref) {
  if (ref && FULL_SHA.test(ref)) return ref
  const target = ref ?? 'HEAD'
  let out
  try {
    // `--` ends option parsing: url and refs that follow are always treated
    // as positionals, never as git options, even if they begin with "-".
    out = ref
      ? git(['ls-remote', '--', url, `refs/tags/${ref}^{}`, `refs/tags/${ref}`, `refs/heads/${ref}`, ref])
      : git(['ls-remote', '--', url, 'HEAD'])
  } catch (err) {
    throw new Error(`could not reach ${url}: ${firstLine(err.stderr) ?? err.message}`)
  }
  const refs = new Map()
  for (const line of out.trim().split('\n')) {
    const [sha, refname] = line.split('\t')
    if (sha && refname) refs.set(refname, sha)
  }
  const sha = ref
    ? (refs.get(`refs/tags/${ref}^{}`) ??
       refs.get(`refs/tags/${ref}`) ??
       refs.get(`refs/heads/${ref}`) ??
       refs.get(ref))
    : refs.get('HEAD')
  if (!sha) throw new Error(`ref "${ref ?? 'HEAD'}" not found in ${url}`)
  return sha
}

// Materialize a commit's tree at cacheDir (no .git retained). Reuses the
// cache if it already exists; builds in a temp dir and renames for atomicity.
export function ensureCommit(url, commit, cacheDir) {
  if (!FULL_SHA.test(commit)) {
    // commit may originate from the lockfile; never pass an unvalidated
    // value to git as a positional (could be read as an option).
    throw new Error(`refusing to fetch non-SHA commit "${commit}" from ${url}`)
  }
  if (fs.existsSync(cacheDir)) return cacheDir
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
  const tmp = `${cacheDir}.tmp-${process.pid}`
  fs.rmSync(tmp, { recursive: true, force: true })
  try {
    // Empty template: don't copy user hook templates into cache checkouts.
    git(['init', '-q', '--template=', tmp])
    git(['-C', tmp, 'remote', 'add', 'origin', url])
    try {
      git(['-C', tmp, 'fetch', '-q', '--depth', '1', 'origin', commit])
    } catch {
      // Server refuses fetch-by-SHA; fall back to a full fetch.
      git(['-C', tmp, 'fetch', '-q', 'origin'])
    }
    git(['-C', tmp, 'checkout', '-q', '--detach', commit])
    fs.rmSync(path.join(tmp, '.git'), { recursive: true, force: true })
    fs.renameSync(tmp, cacheDir)
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw new Error(`failed to fetch ${commit.slice(0, 12)} from ${url}: ${firstLine(err.stderr) ?? err.message}`)
  }
  return cacheDir
}

function firstLine(text) {
  if (!text) return null
  const line = String(text).trim().split('\n')[0]
  return line.length ? line : null
}
