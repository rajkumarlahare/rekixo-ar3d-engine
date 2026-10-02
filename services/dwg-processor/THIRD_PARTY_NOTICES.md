# DWG Processor Third-Party Notices

## GNU LibreDWG

The isolated Rekixo DWG processor invokes **GNU LibreDWG 0.14** as a command-line
decoder. LibreDWG is licensed under the GNU General Public License, version 3 or
later.

- Upstream project: https://www.gnu.org/software/libredwg/
- Upstream source mirror: https://github.com/LibreDWG/libredwg
- Pinned release: 0.14
- Source archive: `libredwg-0.14.tar.xz`
- SHA-256: `62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275`

The container build downloads the pinned upstream source archive, verifies the
published checksum, builds `dwgread`, and keeps LibreDWG isolated behind
Rekixo's versioned normalized-DWG HTTP contract. Rekixo application code does
not link to LibreDWG.

When distributing the container image, retain this notice and the corresponding
LibreDWG license/source obligations for that distribution.
