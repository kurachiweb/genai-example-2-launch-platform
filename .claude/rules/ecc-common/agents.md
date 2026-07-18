# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| ecc-planner | Implementation planning | Complex features, refactoring |
| ecc-architect | System design | Architectural decisions |
| ecc-tdd-guide | Test-driven development | New features, bug fixes |
| ecc-code-reviewer | Code review | After writing code |
| ecc-security-reviewer | Security analysis | Before commits |
| ecc-build-error-resolver | Fix build errors | When build fails |
| ecc-e2e-runner | E2E testing | Critical user flows |
| ecc-refactor-cleaner | Dead code cleanup | Code maintenance |
| ecc-doc-updater | Documentation | Updating docs |
| ecc-rust-reviewer | Rust code review | Rust projects |
| ecc-harmonyos-app-resolver | HarmonyOS app development | HarmonyOS/ArkTS projects |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **ecc-planner** agent
2. Code just written/modified - Use **ecc-code-reviewer** agent
3. Bug fix or new feature - Use **ecc-tdd-guide** agent
4. Architectural decision - Use **ecc-architect** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
