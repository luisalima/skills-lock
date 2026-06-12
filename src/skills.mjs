import fs from 'node:fs'
import path from 'node:path'

// Minimal YAML frontmatter parser — skills only need flat string fields
// (name, description), so a full YAML parser is not worth a dependency.
export function parseFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return fields
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.skills'])

// Find every directory containing a SKILL.md under rootDir.
export function discoverSkills(rootDir, maxDepth = 6) {
  const found = []
  const walk = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
      found.push({
        name: fm.name ?? path.basename(dir),
        description: fm.description ?? '',
        dir,
        relPath: path.relative(rootDir, dir) || '.',
      })
      return
    }
    if (depth >= maxDepth) return
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
        walk(path.join(dir, e.name), depth + 1)
      }
    }
  }
  walk(rootDir, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

// Locate the skill named `name` inside a fetched source tree. An explicit
// skillPath wins; otherwise match discovered skills by frontmatter name,
// then by directory name.
export function findSkill(sourceDir, name, skillPath, sourceLabel) {
  if (skillPath) {
    const dir = path.join(sourceDir, skillPath)
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
      throw new Error(`skill "${name}": no SKILL.md at path "${skillPath}" in ${sourceLabel}`)
    }
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
    return { name, description: fm.description ?? '', dir, relPath: skillPath }
  }
  const all = discoverSkills(sourceDir)
  for (const matcher of [(s) => s.name === name, (s) => path.basename(s.relPath) === name]) {
    const matches = all.filter(matcher)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      const paths = matches.map((s) => s.relPath).join(', ')
      throw new Error(
        `skill "${name}" is ambiguous in ${sourceLabel} (${paths}) — use { "source": ..., "path": ... }`
      )
    }
  }
  const available = all.map((s) => s.name).join(', ') || '(none)'
  throw new Error(`skill "${name}" not found in ${sourceLabel}. available skills: ${available}`)
}
