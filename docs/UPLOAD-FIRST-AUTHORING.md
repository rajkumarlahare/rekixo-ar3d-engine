# Upload-First Authoring

Date: 2026-10-02

Rekixo AR3D uses upload-first authoring as the primary workflow.

Default flow:
1. Upload the available source pack.
2. Inspect every source and preserve provenance.
3. Pick the strongest source per capability.
4. Auto-build as much editable architecture as confidence allows.
5. Send uncertain results to review.
6. Use manual tools mainly for correction, completion, and creative work.

Source roles:
- DWG/DXF: architectural geometry after controlled conversion.
- SKP/SKB: components, materials, and modelling semantics after controlled conversion.
- FBX/GLB: authoring and visual geometry.
- PDF: calibrated plan and dimension evidence.
- Images: facade, finish, landscape, and visual evidence.
- DRS/JSON: resource and provenance metadata.
- CSV/TSV: exact room and unit measurements.

When an unambiguous FBX/GLB model is available, uploading a source pack should run automatic analysis and build immediately. If automation cannot continue, uploaded sources must still be retained and the unresolved dependency shown for review.

Manual Phase 2 wall tools are therefore a correction/completion path, not the expected starting point when usable files exist.
