import path from 'node:path'
import { parseArgs } from 'node:util'
import { findProjectRoot, loadManifest, saveManifest, loadLock, LOCKFILE_NAME } from './manifest.mjs'
import { parseSpec, repoSlug } from './spec.mjs'
import { resolveRef, ensureCommit } from './git.mjs'
import { discoverSkills, findSkill } from './skills.mjs'
import { installAll, removeSkills, cacheRoot } from './install.mjs'

const HELP = `skills-pm — declarative package management for agent skills

Skills are declared in package.json under "skills" and pinned in ${LOCKFILE_NAME}.

Usage:
  skills-pm install [--frozen]        install all declared skills (--frozen: CI mode,
                                      verify against the lockfile, never re-resolve)
  skills-pm add <source> [options]    add skill(s) from a source and install
      --skill <name>                  pick skill(s) when the source contains several
                                      (repeatable)
      --path <dir>                    explicit path to the skill inside the source
      --list                          list skills in the source without installing
  skills-pm update [name...]          re-resolve floating refs (branches) and reinstall
  skills-pm remove <name...>          remove skill(s) from manifest, lock, and agent dirs
  skills-pm list                      show declared skills and their pinned commits

Sources:
  owner/repo[#ref]      GitHub (ref = tag, branch, or commit SHA)
  github:owner/repo[#ref]
  https://host/repo.git[#ref]
  file:path/to/dir      local directory

Example package.json:
  {
    "skills": {
      "code-review": "acme/skills#v2.1.0",
      "deploy": { "source": "acme/skills#v2.1.0", "path": "ops/deploy" }
    },
    "skillsConfig": { "agents": ["claude-code", "cursor"] }
  }
`

function requireRoot() {
  const root = findProjectRoot()
  if (!root) {
    throw new Error('no package.json found — run inside a project (or `npm init -y` first)')
  }
  return root
}

async function cmdAdd(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      skill: { type: 'string', multiple: true },
      path: { type: 'string' },
      list: { type: 'boolean' },
    },
    allowPositionals: true,
  })
  const source = positionals[0]
  if (!source) throw new Error('usage: skills-pm add <source> [--skill name] [--path dir] [--list]')

  const root = requireRoot()
  const spec = parseSpec(values.path ? { source, path: values.path } : source, source)

  // Fetch the source once so we can discover what's in it.
  let sourceDir, label
  if (spec.type === 'file') {
    sourceDir = path.resolve(root, spec.filePath)
    label = spec.raw
  } else {
    const commit = resolveRef(spec.url, spec.ref)
    sourceDir = ensureCommit(spec.url, commit, path.join(cacheRoot(root), repoSlug(spec.url), commit))
    label = `${spec.raw} @ ${commit.slice(0, 12)}`
  }

  let selected
  if (values.path) {
    selected = [findSkill(sourceDir, path.basename(values.path), values.path, label)]
  } else {
    const all = discoverSkills(sourceDir)
    if (all.length === 0) throw new Error(`no SKILL.md found in ${label}`)
    if (values.list) {
      console.log(`skills in ${label}:`)
      for (const s of all) console.log(`  ${s.name}  ${s.relPath}  ${s.description}`.trimEnd())
      return
    }
    if (values.skill?.length) {
      selected = values.skill.map((name) => {
        const match = all.find((s) => s.name === name || path.basename(s.relPath) === name)
        if (!match) {
          throw new Error(`skill "${name}" not found in ${label}. available: ${all.map((s) => s.name).join(', ')}`)
        }
        return match
      })
    } else if (all.length === 1) {
      selected = all
    } else {
      console.log(`${label} contains ${all.length} skills — pick with --skill <name>:`)
      for (const s of all) console.log(`  ${s.name}  ${s.relPath}  ${s.description}`.trimEnd())
      process.exitCode = 1
      return
    }
  }

  const manifest = loadManifest(root)
  const duplicateNames = new Map()
  for (const s of discoverSkills(sourceDir)) {
    duplicateNames.set(s.name, (duplicateNames.get(s.name) ?? 0) + 1)
  }
  for (const skill of selected) {
    // Short string form when the skill is unambiguously discoverable by
    // name; otherwise record the path explicitly.
    const needsPath = values.path || (duplicateNames.get(skill.name) ?? 0) > 1
    manifest.skills[skill.name] = needsPath ? { source, path: skill.relPath } : source
  }
  saveManifest(manifest)
  installAll(root)
}

function cmdList() {
  const root = requireRoot()
  const manifest = loadManifest(root)
  const lock = loadLock(root)
  const names = Object.keys(manifest.skills).sort()
  if (names.length === 0) {
    console.log('no skills declared in package.json')
    return
  }
  for (const name of names) {
    const entry = manifest.skills[name]
    const spec = typeof entry === 'string' ? entry : `${entry.source} (path: ${entry.path})`
    const locked = lock?.skills?.[name]
    const pin = locked?.commit ? locked.commit.slice(0, 12) : locked ? 'local' : 'NOT LOCKED'
    console.log(`${name}  ${spec}  ${pin}`)
  }
}

export async function main(argv) {
  const [command, ...rest] = argv
  switch (command) {
    case 'install':
    case 'i': {
      const { values } = parseArgs({ args: rest, options: { frozen: { type: 'boolean' } } })
      installAll(requireRoot(), { frozen: values.frozen ?? false })
      break
    }
    case 'add':
      await cmdAdd(rest)
      break
    case 'update': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true })
      installAll(requireRoot(), { update: true, only: positionals.length ? positionals : null })
      break
    }
    case 'remove':
    case 'rm': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true })
      if (!positionals.length) throw new Error('usage: skills-pm remove <name...>')
      removeSkills(requireRoot(), positionals)
      break
    }
    case 'list':
    case 'ls':
      cmdList()
      break
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP)
      break
    default:
      throw new Error(`unknown command "${command}" — see \`skills-pm help\``)
  }
}
