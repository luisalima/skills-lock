// End-to-end test: builds a local git repo of skills, then exercises the
// full lifecycle in a throwaway project — add, install, lockfile pinning,
// --frozen verification, tamper detection, update, remove.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, '..', 'bin', 'skills-lock.mjs')
const FIXTURES = path.join(here, 'fixtures', 'skills-repo')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-lock-test-'))
const skillsRepo = path.join(tmp, 'skills-repo')
const project = path.join(tmp, 'project')

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: project, ...opts })
}
function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd })
}
function run(...args) {
  return sh(process.execPath, [CLI, ...args])
}
function runFails(...args) {
  try {
    sh(process.execPath, [CLI, ...args])
  } catch (err) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  throw new Error(`expected failure: skills-lock ${args.join(' ')}`)
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
let passed = 0
function ok(label, fn) {
  fn()
  passed++
  console.log(`ok ${passed} - ${label}`)
}

// --- set up a local git "skills repo" with a tag and a moving main branch ---
fs.cpSync(FIXTURES, skillsRepo, { recursive: true })
git(['init', '-q', '-b', 'main'], skillsRepo)
git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], skillsRepo)
git(['add', '.'], skillsRepo)
git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'v1 skills'], skillsRepo)
git(['tag', 'v1.0.0'], skillsRepo)
const v1sha = git(['rev-parse', 'HEAD'], skillsRepo).trim()

fs.mkdirSync(project)
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo', private: true }, null, 2))

const lockPath = path.join(project, 'skills-lock.json')
const installedSkill = path.join(project, '.claude', 'skills', 'release-notes', 'SKILL.md')

ok('add --list shows skills without installing', () => {
  const out = run('add', `file:${skillsRepo}`, '--list')
  assert.match(out, /hello-world/)
  assert.match(out, /release-notes/)
  assert.ok(!fs.existsSync(lockPath))
})

ok('add from git url pinned to a tag installs and locks a commit', () => {
  const out = run('add', `${skillsRepo}#v1.0.0`, '--skill', 'release-notes')
  assert.match(out, /\+ release-notes/)
  assert.ok(fs.existsSync(installedSkill))
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'release-notes', 'references', 'style.md')))
  const lock = readJSON(lockPath)
  assert.equal(lock.skills['release-notes'].commit, v1sha)
  assert.match(lock.skills['release-notes'].integrity, /^sha256-/)
  const pkg = readJSON(path.join(project, 'package.json'))
  assert.equal(pkg.skills['release-notes'], `${skillsRepo}#v1.0.0`)
})

ok('install --frozen succeeds when lock matches', () => {
  const out = run('install', '--frozen')
  assert.match(out, /verified against skills-lock\.json/)
})

ok('install --frozen fails when a skill is missing from the lock', () => {
  const pkgPath = path.join(project, 'package.json')
  const pkg = readJSON(pkgPath)
  pkg.skills['hello-world'] = `${skillsRepo}#v1.0.0`
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  const out = runFails('install', '--frozen')
  assert.match(out, /not pinned by skills-lock\.json/)
})

ok('plain install pins the new skill', () => {
  run('install')
  assert.equal(readJSON(lockPath).skills['hello-world'].commit, v1sha)
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'hello-world', 'SKILL.md')))
})

ok('install --frozen detects tampered lock integrity', () => {
  const lock = readJSON(lockPath)
  const saved = lock.skills['hello-world'].integrity
  lock.skills['hello-world'].integrity = 'sha256-TAMPERED'
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
  const out = runFails('install', '--frozen')
  assert.match(out, /integrity mismatch/)
  lock.skills['hello-world'].integrity = saved
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
})

ok('floating ref stays pinned until update', () => {
  const pkgPath = path.join(project, 'package.json')
  const pkg = readJSON(pkgPath)
  pkg.skills['release-notes'] = `${skillsRepo}#main`
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  run('install') // spec changed → resolves main (== v1 for now)
  // advance main upstream
  fs.appendFileSync(path.join(skillsRepo, 'skills', 'release-notes', 'SKILL.md'), '\nAlways include a Thanks section.\n')
  git(['add', '.'], skillsRepo)
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'tweak'], skillsRepo)
  const v2sha = git(['rev-parse', 'HEAD'], skillsRepo).trim()

  run('install') // spec unchanged → must keep the locked commit
  assert.equal(readJSON(lockPath).skills['release-notes'].commit, v1sha)
  assert.ok(!fs.readFileSync(installedSkill, 'utf8').includes('Thanks'))

  run('update', 'release-notes') // explicit update → re-resolve main
  assert.equal(readJSON(lockPath).skills['release-notes'].commit, v2sha)
  assert.ok(fs.readFileSync(installedSkill, 'utf8').includes('Thanks'))
  // the untouched skill keeps its pin
  assert.equal(readJSON(lockPath).skills['hello-world'].commit, v1sha)
})

ok('list shows pinned commits', () => {
  const out = run('list')
  assert.match(out, /release-notes\s+.*#main\s+[0-9a-f]{12}/)
})

ok('remove deletes manifest entry, lock entry, and installed files', () => {
  run('remove', 'hello-world')
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'skills', 'hello-world')))
  assert.ok(!('hello-world' in readJSON(lockPath).skills))
  assert.ok(!('hello-world' in readJSON(path.join(project, 'package.json')).skills))
})

ok('multi-agent install via skillsConfig', () => {
  const pkgPath = path.join(project, 'package.json')
  const pkg = readJSON(pkgPath)
  pkg.skillsConfig = { agents: ['claude-code', 'cursor'] }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  run('install')
  assert.ok(fs.existsSync(path.join(project, '.cursor', 'skills', 'release-notes', 'SKILL.md')))
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nall ${passed} tests passed`)
