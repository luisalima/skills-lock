import fs from 'node:fs'
import path from 'node:path'

// A skill name becomes a directory name under each agent's skills folder and
// is used in destructive fs operations (rm before copy). It must never be
// able to escape that folder. Allow the conservative subset agent skills
// already use: alphanumeric start, then alphanumerics plus . _ - up to 64
// chars. This rejects "/", "\", "..", and leading dots/dashes by construction.
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function validateSkillName(name) {
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || name.includes('..')) {
    throw new Error(
      `invalid skill name "${name}" — names must match ${SKILL_NAME} and contain no path separators`
    )
  }
  return name
}

// A skill directory is hashed for integrity and copied verbatim into agent
// skills folders. A symlink in that tree is dangerous twice over: it is
// skipped by the content hash (so --frozen can't see it change), and once
// copied it lets a skill point an agent at arbitrary files (~/.ssh/id_rsa,
// /etc/passwd, …). Skills are markdown + scripts + assets and never need
// symlinks, so reject the whole class. Also rejects a root that is itself a
// symlink (a directory-level escape that lexical containment can't catch).
export function assertNoSymlinks(dir) {
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error(`refusing skill at "${dir}": path is a symlink`)
  }
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isSymbolicLink()) {
        throw new Error(`refusing skill: contains a symlink "${path.relative(dir, full)}" (not allowed)`)
      }
      if (e.isDirectory()) walk(full)
    }
  }
  walk(dir)
}

// Defense in depth for any path derived from untrusted input: assert that
// `target` resolves to `base` itself or something strictly inside it.
export function assertContained(base, target, label) {
  const baseResolved = path.resolve(base)
  const targetResolved = path.resolve(target)
  const rel = path.relative(baseResolved, targetResolved)
  const escapes = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
  if (escapes) {
    throw new Error(`${label ?? 'path'} "${target}" escapes "${base}"`)
  }
  return targetResolved
}
