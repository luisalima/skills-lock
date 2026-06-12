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

  let url
  if (GITHUB_SHORTHAND.test(rest)) {
    url = `https://github.com/${rest}.git`
  } else if (rest.startsWith('git+')) {
    url = rest.slice('git+'.length)
  } else if (/^(https?|git|ssh):\/\//.test(rest)) {
    url = rest
  } else if (rest.startsWith('/') || rest.startsWith('./') || rest.startsWith('../')) {
    // local path used as a git remote (shared-filesystem setups, tests)
    url = rest
  } else {
    throw new Error(`skill "${name}": unsupported source spec "${source}"`)
  }
  return { type: 'git', url, ref, skillPath, raw: source }
}

export function repoSlug(url) {
  return url
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/[^\w.-]+/g, '-')
    .toLowerCase()
}
