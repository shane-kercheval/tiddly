"""
Capture a JSON snapshot of the Content MCP server's advertised tool schema.

Use this before and after upgrading `fastmcp` (or any change that might alter
how tool metadata is emitted) to detect LLM-visible drift that unit tests
cannot catch. The output is the `tools/list` response that LLM clients see:
tool names, descriptions, input schemas, annotations.

Why this matters: pytest verifies Python behavior, but the MCP protocol
sends a serialized schema to the LLM. A library upgrade can change that
serialization (e.g., by adding/removing fields, altering descriptions,
reordering properties) without breaking any Python test — yet change how
the LLM decides which tool to call and what arguments to pass.

Example workflow:

    # Before the upgrade (on the current fastmcp version)
    uv run python evals/content_mcp/schema_snapshot.py > /tmp/before.json

    # After bumping the lockfile / installing the new version
    uv run python evals/content_mcp/schema_snapshot.py > /tmp/after.json

    # Compare
    diff -u /tmp/before.json /tmp/after.json

An empty diff is a strong signal that the MCP evals should behave the same.
A non-empty diff is not necessarily a regression, but must be inspected.

Prints JSON to stdout (sorted keys, indented) so diffs are stable.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend" / "src"))

from fastmcp import Client
from fastmcp.client.transports import FastMCPTransport

from mcp_server.server import mcp


async def main() -> None:
    async with Client(FastMCPTransport(mcp)) as client:
        tools = await client.list_tools()
        payload = [t.model_dump(mode="json") for t in tools]
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
