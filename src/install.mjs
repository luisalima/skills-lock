import fs from 'node:fs'
import path from 'node:path'
import { loadManifest, saveManifest, loadLock, saveLock, LOCKFILE_NAME, LOCKFILE_VERSION } from './manifest.mjs'
import { parseSpec, repoSlug } from './spec.mjs'
import { resolveRef, ensureCommit } from './git.mjs'
import { findSkill } from './skills.mjs'
import { hashTree } from './integrity.mjs'
import { agentTargets } from './agents.mjs'
import { validateSkillName, assertContained } from './validate.mjs'

export function cacheRoot(root) {
  if (process.env.SKILLS_LOCK_CACHE) {
    const dir = path.resolve(process.env.SKILLS_LOCK_CACHE)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  const dir = path.join(root, '.skills', 'cache')
  fs.mkdirSync(dir, { recursive: true })
  // Keep the cache out of version control without asking users to edit
  // their .gitignore.
  const ignore = path.join(root, '.skills', '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n')
  return dir
}

// Resolve one manifest entry to a concrete skill directory + lock entry.
// `update` forces re-resolution of floating refs; `frozen` forbids anything
// not already pinned by the lockfile.
function resolveSkill(root, name, entry, locked, { frozen, update }) {
  const spec = parseSpec(entry, name)

  if (spec.type === 'file') {
    const baseDir = path.resolve(root, spec.filePath)
    if (!fs.existsSync(baseDir)) throw new Error(`skill "${name}": ${spec.raw} does not exist`)
    const skill = findSkill(baseDir, name, spec.skillPath, spec.raw)
    const integrity = hashTree(skill.dir)
    if (frozen) {
      assertFrozenMatch(name, spec, locked, integrity)
    }
    return {
      skillDir: skill.dir,
      lockEntry: { spec: spec.raw, path: skill.relPath, integrity },
      label: spec.raw,
    }
  }

  let commit
  if (frozen) {
    if (!locked?.commit || locked.spec !== spec.raw) {
      throw new Error(
        `skill "${name}" is not pinned by ${LOCKFILE_NAME} (run \`skills-lock install\` and commit the lockfile)`
      )
    }
    commit = locked.commit
  } else if (!update && locked?.commit && locked.spec === spec.raw) {
    commit = locked.commit
  } else {
    commit = resolveRef(spec.url, spec.ref)
  }

  const sourceDir = ensureCommit(spec.url, commit, path.join(cacheRoot(root), repoSlug(spec.url), commit))
  const label = `${spec.raw} @ ${commit.slice(0, 12)}`
  const knownPath = commit === locked?.commit ? locked?.path : null
  const skill = findSkill(sourceDir, name, spec.skillPath ?? knownPath, label)
  const integrity = hashTree(skill.dir)
  if (frozen) {
    assertFrozenMatch(name, spec, locked, integrity)
  }
  return {
    skillDir: skill.dir,
    lockEntry: { spec: spec.raw, resolved: spec.url, ref: spec.ref ?? null, commit, path: skill.relPath, integrity },
    label,
  }
}

function assertFrozenMatch(name, spec, locked, integrity) {
  if (!locked || locked.spec !== spec.raw) {
    throw new Error(
      `skill "${name}": ${LOCKFILE_NAME} is out of date with package.json (run \`skills-lock install\`)`
    )
  }
  if (locked.integrity !== integrity) {
    throw new Error(`skill "${name}": integrity mismatch — expected ${locked.integrity}, got ${integrity}`)
  }
}

function copyToAgents(root, config, name, skillDir) {
  // `name` is an attacker-controlled manifest key and is used in a recursive
  // rm before the copy — a traversing name (e.g. "../../x") would delete and
  // overwrite paths outside the agent directory. Validate, then assert the
  // resolved destination stays inside the target dir.
  validateSkillName(name)
  const installed = []
  for (const target of agentTargets(root, config)) {
    const dest = path.join(target.dir, name)
    assertContained(target.dir, dest, `skill "${name}" destination`)
    fs.mkdirSync(target.dir, { recursive: true })
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(skillDir, dest, { recursive: true })
    installed.push(target.agent)
  }
  return installed
}

export function installAll(root, { frozen = false, update = false, only = null } = {}) {
  const manifest = loadManifest(root)
  const lock = loadLock(root) ?? { lockfileVersion: LOCKFILE_VERSION, skills: {} }
  const names = Object.keys(manifest.skills)
  if (names.length === 0) {
    console.log('no skills declared in package.json ("skills" field) — try `skills-lock add <source>`')
    return
  }
  if (frozen && only) throw new Error('--frozen cannot be combined with a partial update')

  names.forEach((name) => validateSkillName(name))

  const newLock = { lockfileVersion: LOCKFILE_VERSION, skills: {} }
  for (const name of names) {
    const doUpdate = update && (!only || only.includes(name))
    const result = resolveSkill(root, name, manifest.skills[name], lock.skills[name], {
      frozen,
      update: doUpdate,
    })
    const agents = copyToAgents(root, manifest.config, name, result.skillDir)
    newLock.skills[name] = result.lockEntry
    console.log(`+ ${name}  ${result.label}  → ${agents.join(', ')}`)
  }

  if (frozen) {
    const extra = Object.keys(lock.skills).filter((n) => !names.includes(n))
    if (extra.length) {
      throw new Error(`${LOCKFILE_NAME} pins skills missing from package.json: ${extra.join(', ')}`)
    }
    console.log(`✓ ${names.length} skill(s) verified against ${LOCKFILE_NAME}`)
  } else {
    saveLock(root, newLock)
    console.log(`✓ ${names.length} skill(s) installed, ${LOCKFILE_NAME} written`)
  }
}

export function removeSkills(root, names) {
  const manifest = loadManifest(root)
  const lock = loadLock(root)
  for (const name of names) {
    if (!(name in manifest.skills)) throw new Error(`skill "${name}" is not in package.json`)
    validateSkillName(name)
    delete manifest.skills[name]
    if (lock) delete lock.skills[name]
    for (const target of agentTargets(root, manifest.config)) {
      const dest = path.join(target.dir, name)
      assertContained(target.dir, dest, `skill "${name}" destination`)
      fs.rmSync(dest, { recursive: true, force: true })
    }
    console.log(`- ${name} removed`)
  }
  saveManifest(manifest)
  if (lock) saveLock(root, lock)
}
