# 0000. Record architecture decisions as Markdown ADRs

- Status: accepted
- Date: 2026-10-25

## Context

Several people and agents work on this repository in parallel. Decisions made in chat threads and PR descriptions are hard to find later.

## Decision

Significant decisions go in `docs/adr/NNNN-short-title.md`: context, decision, consequences. A decision that replaces another marks the old one "superseded by NNNN". Raising a number in `perf-budget.json`, adding a client dependency, or loosening a security header needs an ADR.

## Consequences

New contributors (human or agent) read `docs/adr/`, `DESIGN.md` and `THREAT_MODEL.md` before changing architecture, UI or security posture.
