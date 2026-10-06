# R2 — Phase 6B Source-Backed Unit Hierarchy

## Purpose

Phase 6B turns already-aligned room/unit evidence into deterministic floor-scoped unit metadata and connects those units to Phase 6A stair/lift cores only when a real reviewed door path proves access.

This remains reconstruction metadata, not architecture generation.

## Unit authority

A room may participate in automatic unit hierarchy only when its unit label is supported by one of these evidence paths:

- aligned uploaded semantic evidence already applied by `roomSemanticBinding`; or
- an operator-reviewed room that still carries immutable source provenance.

A typed unit label by itself is not evidence and stays outside the automatic hierarchy.

Units are floor-scoped. Their IDs are deterministic from floor identity plus normalized unit label. The derivation does not write IDs back into the scene and never changes room geometry or verification flags.

## Circulation binding

A source-backed unit may be linked to an `auto-ready` Phase 6A stair/lift core only when all of the following hold:

1. the core member resolves to exactly one same-floor room whose semantic name matches the core kind (`Stair`/`Staircase` or `Lift`/`Elevator`);
2. every traversed transition is an existing `reviewed: true` door;
3. intermediate rooms are common circulation rooms such as lobby/corridor/stair/lift;
4. the path terminates in a source-backed unit room;
5. no missing room, guessed opening, nearest-door shortcut, or geometry mutation is used.

If any requirement is missing, unit access is not inferred. The report records unresolved evidence for review instead.

## Safety properties

`buildUnitHierarchy` is pure metadata derivation:

- no scene mutation;
- no source mutation;
- no geometry generation;
- no automatic `verified: true` or `reviewed: true`;
- no use of manual labels as source truth;
- no Platform/Super Admin dependency;
- no project-specific identity or Jyoti special case.

## R2 completion direction

Phase 6A circulation plus Phase 6B units form the remaining source-backed hierarchy layer. The next R2 completion work wires these reports into the shared automatic processing result and client-ready acceptance gate, then reruns the generic six-role source-pack certification before presentation intelligence begins.
