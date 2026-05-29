# Revor Skills

AI agent skills and reference docs for Revor project workflows.

## Overview

This repository contains reusable AI agent skills for working with Revor-related development, documentation, outreach, and project-specific workflows.

Each skill is defined by a `SKILL.md` file and may include additional reference documents, examples, or supporting files.

The repository currently includes:

- `revor-outreach`: function-triggered outreach execution via Revor, with guidance for LinkedIn, Email, WhatsApp, connected account checks, message dispatch, and LinkedIn post-like warm-up flows.

More Revor workflow skills can be added under `skills/` as the project evolves.

## Installation

Install from GitHub:

```bash
npx skills add laiye-revor/revor-skills
```

## Repository Structure

```txt
skills/
  revor-outreach/
    SKILL.md
    reference/
      accounts.md
      dispatch/
        dispatch.md
        linkedin-post-like.md
```

## Skill Layout

A typical skill directory contains:

- `SKILL.md`: the main skill definition, trigger guidance, and execution rules.
- `reference/`: supporting documentation used only when relevant to the task.
- Optional examples or supporting files for more complex workflows.

## Notes

Some skills may require Revor configuration, such as `REVOR_API_KEY`, before they can perform live API-backed actions. See the relevant skill's `SKILL.md` for exact requirements.
