# CLAUDE.md - AI Assistant Guidelines

This document provides essential context and guidelines for AI assistants (particularly Claude) working in this repository.

## Repository Overview

**Claude-Standard-Umgebung** (Claude Standard Environment) is a template repository designed to provide a standardized development environment for AI-assisted software development.

### Purpose

This repository serves as a foundation for projects where AI assistants collaborate with developers. It establishes conventions, workflows, and best practices to ensure consistent and high-quality contributions.

## Project Structure

```
Claude-Standard-Umgebung/
├── CLAUDE.md           # AI assistant guidelines (this file)
├── README.md           # Project documentation (to be created)
├── src/                # Source code (to be created)
├── tests/              # Test files (to be created)
├── docs/               # Documentation (to be created)
└── .github/            # GitHub workflows and templates (to be created)
```

> **Note**: This is the initial structure. Update this section as the project evolves.

## Development Guidelines

### Code Style and Conventions

1. **Language**: Use clear, descriptive naming conventions
2. **Comments**: Write comments for complex logic; avoid obvious comments
3. **Documentation**: Keep documentation in sync with code changes
4. **Testing**: Write tests for new functionality
5. **Security**: Never commit secrets, credentials, or sensitive data

### Git Workflow

1. **Branching**:
   - Main branch contains stable code
   - Feature branches follow the pattern: `claude/<description>-<session-id>`
   - Always create descriptive branch names

2. **Commits**:
   - Write clear, concise commit messages
   - Use imperative mood ("Add feature" not "Added feature")
   - Reference issues when applicable
   - Keep commits atomic and focused

3. **Pull Requests**:
   - Provide clear descriptions of changes
   - Include test plans when applicable
   - Request reviews for significant changes

### File Operations

- **Read before edit**: Always read a file before modifying it
- **Minimal changes**: Only modify what's necessary
- **No over-engineering**: Keep solutions simple and focused
- **Preserve formatting**: Maintain existing code style in files

## AI Assistant Instructions

### When Starting Work

1. Explore the repository structure to understand the current state
2. Check for existing documentation and conventions
3. Review recent commits to understand ongoing work
4. Use the TodoWrite tool to plan multi-step tasks

### When Making Changes

1. **Understand first**: Read relevant files before proposing changes
2. **Plan thoroughly**: Break complex tasks into smaller steps
3. **Test changes**: Verify modifications work as expected
4. **Document**: Update documentation when adding features

### When Committing

1. Stage only relevant files
2. Write descriptive commit messages
3. Never commit:
   - Secrets or credentials
   - Generated files (unless intentional)
   - Temporary or debug code
   - Unrelated changes

### Security Considerations

- Never expose API keys, passwords, or tokens
- Validate user input at system boundaries
- Be cautious with file operations outside the project
- Report potential security issues found in the code

## Common Commands

```bash
# Git operations
git status                    # Check current state
git diff                      # View unstaged changes
git log --oneline -10         # View recent commits

# Development (update based on project type)
# npm install                 # Install dependencies
# npm test                    # Run tests
# npm run build               # Build project
```

## Project-Specific Notes

<!-- Add project-specific information here as the project develops -->

This section will be populated with:
- Build instructions
- Environment setup
- API documentation
- Architecture decisions
- Known issues and workarounds

### AffiliateFinder.ai LP Redesign (Variant C) — Key Facts

**Where the current LP lives:**
- The "Peace LP" for AffiliateFinder.ai is served by the **link-in-bio app deployed on Railway** — its code is NOT in this repository.
- The exact GitHub repo could not be identified from a Claude session rooted in this repo: `add_repo` cannot add `Endorsely-software/*` repos to a session whose sources are owned by `michellehavnt` (cross-tier adds unsupported). Likely candidates: `Endorsely-software/affiliate-finder` or `Endorsely-software/endorsely-monorepo`.
- **To find it for sure:** Railway dashboard → the link-in-bio service → Settings → Source shows the connected GitHub repo. To let Claude edit it, start a Claude session from that Endorsely repo.
- Workaround used: the redesigned page is built as a self-contained HTML file in this repo (see `AFLandingC/`), ready to be dropped into the link-in-bio app.

**Design decisions (July 2026):**
- Redesign modeled on kinso.ai's premium waitlist LP style (screenshots in project history).
- Palette: light warm base, **teal as the single accent**, **navy reserved for the dark act-break section** (brand colors from `AFPitch/index.html`: navy `#0c1929`/`#073b55`, teal `#067280`).
- The new page is a **C variant** — the current Peace LP stays live untouched; this is an additional variant for testing.
- Product mockups are built as animatable HTML/CSS DOM components (app window, result rows, floating notification cards), not images.

**ICP for copy:**
- Affiliate Managers at big brands that already run affiliate programs (brand side — NOT aspiring affiliates wanting commissions).
- Research source: **AFbrain** — the "Internal Brain – AffiliateFinder.ai" deployment of the `sales-call-analyzer` app in this repo (deployed on Railway via `afbrain-deploy`). NOT CCbrain: CCbrain is the CopeCart deployment of the same software and contains only CopeCart calls; the connected Fireflies workspace (michelle.habenicht@copecart.com) also holds only CopeCart calls.
- As of 2026-07-22, AFbrain is NOT connected as an MCP server in Claude sessions — it must be added as a connector (like CCbrain) before call analysis can run. Method once connected: search transcripts for affiliate-manager language, EXCLUDE calls whose only customer email is gmail/personal, deep-read full transcripts of ideal-fit calls, quote verbatim.

## Quick Reference

| Task | Approach |
|------|----------|
| Explore codebase | Use Task tool with Explore agent |
| Find files | Use Glob tool with patterns |
| Search code | Use Grep tool for content search |
| Edit files | Read first, then use Edit tool |
| Multi-step tasks | Use TodoWrite to track progress |
| Ask for clarity | Use AskUserQuestion tool |

## Updating This Document

This CLAUDE.md should be updated when:
- Project structure changes significantly
- New conventions are established
- Important dependencies are added
- Workflow processes change

---

*Last updated: 2026-01-22*
*Repository: Claude-Standard-Umgebung*
