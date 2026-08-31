# Third-party notices

The connector build installs the following direct upstream components. Their
source is not relicensed by this package.

| Component | Pinned source | License | Upstream |
| --- | --- | --- | --- |
| Google Ads MCP | commit `88f0467b9e536c562941fa52a94dd02b193c8fa4` | Apache-2.0 | <https://github.com/googleads/google-ads-mcp> |
| Google Analytics MCP | commit `a8ca729d4a8fa99bffe87962c17c0539c6aa9da7` | Apache-2.0 | <https://github.com/googleanalytics/google-analytics-mcp> |
| FastMCP | `3.3.1` | Apache-2.0 | <https://github.com/PrefectHQ/fastmcp> |
| GSC MCP Server | `@jlnkrth/gsc-mcp-server@1.1.0` | MIT | <https://github.com/jlnkrth/gsc-mcp-server> |
| Model Context Protocol SDK for TypeScript | `1.30.0` | MIT | <https://github.com/modelcontextprotocol/typescript-sdk> |
| Zod | `4.4.3` | MIT | <https://github.com/colinhacks/zod> |
| Postgres.js | `3.4.9` | Unlicense | <https://github.com/porsager/postgres> |
| pgvector | `0.8.6` / PostgreSQL 17 Bookworm image | PostgreSQL License | <https://github.com/pgvector/pgvector> |

Transitive dependency versions and integrity hashes are recorded in `uv.lock`
and the connector `package-lock.json` files. A released connector image must
retain installed distribution metadata and be accompanied by an SBOM or an
equivalent complete dependency-license report. This notice is not a substitute
for those transitive notices.
