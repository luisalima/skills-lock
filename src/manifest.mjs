import fs from 'node:fs'
import path from 'node:path'

export const LOCKFILE_NAME = 'skills-lock.json'
export const LOCKFILE_VERSION = 1

export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadManifest(root) {
  const file = path.join(root, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    file,
    pkg,
    skills: pkg.skills ?? {},
    config: pkg.skillsConfig ?? {},
  }
}

export function saveManifest(manifest) {
  manifest.pkg.skills = manifest.skills
  fs.writeFileSync(manifest.file, JSON.stringify(manifest.pkg, null, 2) + '\n')
}

export function loadLock(root) {
  const file = path.join(root, LOCKFILE_NAME)
  if (!fs.existsSync(file)) return null
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (lock.lockfileVersion !== LOCKFILE_VERSION) {
    throw new Error(
      `unsupported lockfileVersion ${lock.lockfileVersion} in ${LOCKFILE_NAME} (expected ${LOCKFILE_VERSION})`
    )
  }
  return lock
}

export function saveLock(root, lock) {
  const file = path.join(root, LOCKFILE_NAME)
  const sorted = { lockfileVersion: LOCKFILE_VERSION, skills: {} }
  for (const name of Object.keys(lock.skills).sort()) {
    sorted.skills[name] = lock.skills[name]
  }
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
}
