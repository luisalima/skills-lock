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
