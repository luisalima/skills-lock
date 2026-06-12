// A skill entry in the "skills" field of package.json is either a string
// source spec or an object { source, path } where path points at the skill
// directory inside the source (for repos hosting many skills with clashing
// or non-discoverable names).
//
// Supported source specs:
//   owner/repo                  GitHub shorthand, default branch
//   owner/repo#ref              GitHub shorthand pinned to tag/branch/SHA
//   github:owner/repo[#ref]     explicit GitHub prefix
//   https://host/repo[#ref]     any git-over-HTTP(S) remote
//   git+https://host/repo.git[#ref]
//   file:relative/or/abs/path   local directory (no commit pinning)

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/
const ALLOWED_SCHEME = /^(https?|git|ssh):\/\//
const LOCAL_PATH = /^(\/|\.\/|\.\.\/)/

// A git remote URL is handed to `git` as a positional argument. Even without
// a shell, git treats some URLs as code: the `ext::` transport runs an
// arbitrary command, and a value starting with "-" is parsed as an option.
// Only well-known network schemes and explicit local paths are allowed.
function assertSafeGitUrl(url, name) {
  if (url.startsWith('-')) {
    throw new Error(`skill "${name}": source "${url}" may not start with "-"`)
  }
  if (!ALLOWED_SCHEME.test(url) && !LOCAL_PATH.test(url)) {
    throw new Error(
      `skill "${name}": refusing source "${url}" — only http(s)/git/ssh remotes or local paths are allowed`
    )
  }
}

export function parseSpec(entry, name) {
  const source = typeof entry === 'string' ? entry : entry?.source
  const skillPath = typeof entry === 'object' && entry !== null ? (entry.path ?? null) : null
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error(`skill "${name}": entry must be a source string or { source, path } object`)
  }

  if (source.startsWith('file:')) {
    return { type: 'file', filePath: source.slice('file:'.length), skillPath, raw: source }
  }

  let rest = source.startsWith('github:') ? source.slice('github:'.length) : source
  let ref = null
  const hash = rest.indexOf('#')
  if (hash !== -1) {
    ref = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
  }
  if (ref !== null && (ref.length === 0 || ref.startsWith('-'))) {
    // A ref is passed to `git` as a positional; "-..." would be read as an option.
    throw new Error(`skill "${name}": invalid ref "${ref}"`)
  }

  let url
  if (GITHUB_SHORTHAND.test(rest)) {
    url = `https://github.com/${rest}.git`
  } else if (rest.startsWith('git+')) {
    url = rest.slice('git+'.length)
  } else if (ALLOWED_SCHEME.test(rest)) {
    url = rest
  } else if (LOCAL_PATH.test(rest)) {
    // local path used as a git remote (shared-filesystem setups, tests)
    url = rest
  } else {
    throw new Error(`skill "${name}": unsupported source spec "${source}"`)
  }
  assertSafeGitUrl(url, name)
  return { type: 'git', url, ref, skillPath, raw: source }
}

export function repoSlug(url) {
  return url
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/[^\w.-]+/g, '-')
    .toLowerCase()
}
