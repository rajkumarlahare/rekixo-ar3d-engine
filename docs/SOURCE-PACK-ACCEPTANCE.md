# Source Pack Acceptance

Status: active production contract.

## Normal project workflow

A normal Rekixo building project can be created from a mixed source pack. The
recommended full-support pack has six roles:

1. 3D authoring model — FBX or GLB;
2. CAD — DWG or DXF;
3. SketchUp support source — SKP or SKB;
4. drawing/brochure — PDF;
5. exterior/visual reference — JPG/PNG/WebP/TIFF;
6. render/resource metadata — DRS or JSON.

The Engine detects these roles from file formats/content. Customer names,
filenames and hashes never unlock hidden project geometry.

## Acceptance states

`completeSupportPack` means all six roles are attached.

`autoBuildReady` means the Engine has an unambiguous 3D authoring model and no
blocking source ambiguity. The CAD/SketchUp native provider may still be
unavailable; that is a review/provider issue, not a reason to prevent the FBX/GLB
automatic building path from running.

## One-click automatic building

When Auto Build is available, the Engine may:

- select the unambiguous authoring model;
- prepare a web GLB derivative from FBX;
- recover safe texture files from ZIP-style SketchUp archives;
- analyze model bounds, materials, floor levels and architectural candidates;
- build parametric wall candidates;
- detect repeated floors;
- create conservative rooms only from closed wall loops;
- associate high-confidence doors/windows;
- retain uncertainty in the review queue.

It must not fabricate missing dimensions, units, room names or architectural
relationships.

## CAD policy

ASCII DXF can be normalized inside the generic Engine when drawing units and
semantic layers are usable.

Binary DWG is checksum-preserved and evidence-scanned in the generic browser
path. Full editable DWG/AEC extraction must use a controlled commercial-compatible
provider. GPL DWG parsers are not embedded into the commercial Rekixo runtime.

## SketchUp policy

ZIP-style SKB/SKP archives can be safely inspected and texture files recovered.
Native SketchUp component/geometry semantics remain behind a controlled provider
boundary when the archive does not expose sufficient portable metadata.

## Browser-smoke stability

Critical Playwright authoring controls use stable test IDs rather than visible
button/heading wording. Product copy may evolve without turning a healthy build
red. The stable IDs cover:

- analyze project;
- detected floor levels;
- build automatically;
- build analyzed draft;
- open visual editor.

## Review principle

Automation reduces repetitive work. Confidence never silently upgrades a
derived fact into reviewed architectural truth. Ambiguous/conflicting evidence
stays visible until an operator confirms it.
