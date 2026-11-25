// Where skills go, inside the repo: OpenSpec's shared folder, which Codex and
// most agents read, and Claude Code's. Copies rather than OpenSpec's symlinks,
// which Windows checkouts break; OpenSpec treats a copy as installed.
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills'] as const;
