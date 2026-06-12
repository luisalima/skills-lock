import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Deterministic content hash of a directory tree: sorted relative paths and
// file contents, NUL-separated. Stored in the lockfile and verified on
// --frozen installs.
export function hashTree(dir) {
  const files = []
  const walk = (sub) => {
    for (const e of fs.readdirSync(sub, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(sub, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) files.push(full)
    }
  }
  walk(dir)
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(dir, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return `sha256-${hash.digest('base64')}`
}
