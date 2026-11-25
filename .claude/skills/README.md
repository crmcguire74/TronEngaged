# Project skills

Third-party Claude Code skills vendored into this repo so every session on TronEngaged loads them.
Installed with the `skills` CLI on 2026-11-25. Each folder is a copy of the upstream skill at the commit below.

| Skill | Source repo | Path | Commit |
|---|---|---|---|
| 3d-games | sickn33/agentic-awesome-skills | plugins/agentic-bundle-indie-game-dev/skills/3d-games | 166f581cfdc3 |
| game-design | sickn33/agentic-awesome-skills | plugins/agentic-bundle-indie-game-dev/skills/game-design | 166f581cfdc3 |
| 3d-web-experience | sickn33/agentic-awesome-skills | skills/3d-web-experience | 166f581cfdc3 |
| 3d-modeling | omer-metin/skills-for-antigravity | skills/3d-modeling | e8dcf4e87379 |
| threejs-game-ui-designer | majidmanzarpour/threejs-game-skills | skills/threejs-game-ui-designer | 8286774b22a2 |

To update one, rerun `npx -y skills add <source> --skill <name> -g -y --agent claude-code` and copy the folder from `~/.claude/skills/` back here.
