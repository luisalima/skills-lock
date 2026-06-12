import path from 'node:path'
import { assertContained } from './validate.mjs'

// Project-scoped skill directories for common agents. Extend or override
// per-project via skillsConfig.agentDirs in package.json.
export const AGENT_DIRS = {
  'claude-code': '.claude/skills',
  cursor: '.cursor/skills',
  opencode: '.opencode/skills',
  windsurf: '.windsurf/skills',
  'github-copilot': '.github/skills',
  amp: '.agents/skills',
  universal: '.agents/skills',
}

export function agentTargets(root, config) {
  const agents = config.agents ?? ['claude-code']
  const overrides = config.agentDirs ?? {}
  return agents.map((agent) => {
    const dir = overrides[agent] ?? AGENT_DIRS[agent]
    if (!dir) {
      const known = Object.keys(AGENT_DIRS).join(', ')
      throw new Error(
        `unknown agent "${agent}" — known agents: ${known}, or map it via skillsConfig.agentDirs`
      )
    }
    // agentDirs comes from package.json; a traversing or absolute override
    // would aim the install (rm + copy) outside the project. Keep it inside.
    const target = path.join(root, dir)
    assertContained(root, target, `agent "${agent}" directory`)
    return { agent, dir: target }
  })
}
