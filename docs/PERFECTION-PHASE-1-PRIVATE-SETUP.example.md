# Private Golden Certification Setup Example

This file contains no production filenames, fingerprints, URLs or tokens. It documents the one-time operator setup for the manual `Certify Private Golden Source Pack` workflow.

1. Put exactly the six golden source files at the root of a private ZIP.
2. Generate the private manifest with `npm run golden:manifest -- --dir <pack-dir> --out <private-manifest> --key <non-secret-key>`.
3. Compute the ZIP SHA-256.
4. Base64-encode the private manifest as one line.
5. Configure repository Actions secrets `REKIXO_GOLDEN_PACK_URL`, optional `REKIXO_GOLDEN_PACK_TOKEN`, `REKIXO_GOLDEN_PACK_SHA256`, and `REKIXO_GOLDEN_MANIFEST_B64`.
6. Run the workflow manually from GitHub Actions.

A successful run proves both the native DWG path and the browser six-file AutoBuild path for those exact source bytes. A failed run is evidence to fix the engine or source interpretation; it must not be converted into a green result by weakening the checks.
