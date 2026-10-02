# Rekixo CAD Processor

This isolated service converts uploaded DWG files to ASCII DXF with GNU LibreDWG and then normalizes architectural evidence into the Rekixo `rekixo-cad-architecture@1` contract.

It is intentionally separate from the browser bundle. The current implementation extracts:

- wall, door, window, stair, lift, column and slab semantic geometry from named CAD layers
- INSERT anchors for architectural blocks
- TEXT/MTEXT labels
- DIMENSION values
- drawing units normalized to metres
- floor-label hints
- source SHA-256 and DWG version provenance

The service fails closed when units are missing or unsupported and never invents dimensions.

Runtime API:

- `GET /health`
- `POST /v1/process-dwg?name=<filename>`
- optional `Authorization: Bearer <PROCESSOR_TOKEN>`

The production Admin Worker proxies authenticated Studio requests to this service so the browser never receives the processor token.

## License boundary

The Docker image installs GNU LibreDWG 0.14, which is GPL-licensed. It remains an isolated processing service rather than a dependency bundled into the Rekixo browser applications. Review distribution/deployment obligations before redistributing the processor image outside Rekixo infrastructure.
