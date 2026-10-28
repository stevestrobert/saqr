"""The RFC 6962 tailer against a mocked log (no network): follows tree growth, parses leaves, survives errors."""
import asyncio
import json
from pathlib import Path

import httpx

from saqr.sensing.ct.rfc6962 import CTLogTailer, MultiLogSource

LEAVES = json.loads((Path(__file__).parent / "fixtures" / "ct_leaves.json").read_text())


class FakeLog:
    """Serves get-sth / get-entries like a real log whose tree grows over time."""

    def __init__(self) -> None:
        self.tree_size = 1000
        self.calls = {"sth": 0, "entries": 0}
        self.fail_next = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.fail_next:
            self.fail_next = False
            return httpx.Response(503, text="try later")
        if request.url.path.endswith("get-sth"):
            self.calls["sth"] += 1
            self.tree_size += 3  # the log grows between polls
            return httpx.Response(200, json={"tree_size": self.tree_size, "timestamp": 0, "sha256_root_hash": "", "tree_head_signature": ""})
        if request.url.path.endswith("get-entries"):
            self.calls["entries"] += 1
            start, end = int(request.url.params["start"]), int(request.url.params["end"])
            end = min(end, start + 1)  # real logs cap the batch size
            entries = [{"leaf_input": LEAVES[i % len(LEAVES)]["leaf_input"], "extra_data": ""} for i in range(start, end + 1)]
            return httpx.Response(200, json={"entries": entries})
        return httpx.Response(404)


def test_tailer_follows_the_log_and_recovers_from_http_errors():
    fake = FakeLog()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    tailer = CTLogTailer("https://log.example/2026h2/", "Example log", batch_size=4, poll_interval=0.01, backfill=5, client=client)

    async def run():
        out = []
        async for entry in tailer.stream():
            out.append(entry)
            if len(out) == 3:
                fake.fail_next = True   # inject a 503; the tailer must back off and continue
            if len(out) >= 12:
                tailer.stop()
                break
        await client.aclose()
        return out

    entries = asyncio.run(run())
    assert len(entries) == 12
    assert all(e.domains and e.issuer and e.fingerprint and e.log == "Example log" for e in entries)
    assert entries[0].index == 1003 - 5  # started `backfill` entries behind the first STH
    assert [e.index for e in entries] == list(range(entries[0].index, entries[0].index + 12))  # no gaps, no duplicates
    assert tailer.stats.http_errors == 1 and tailer.stats.entries == 12 and tailer.stats.online


def test_multi_log_source_merges_logs():
    fakes = [FakeLog(), FakeLog()]
    src = MultiLogSource(["https://a.example/", "https://b.example/"], batch_size=2, poll_interval=0.01, backfill=2)
    for t, f in zip(src.tailers, fakes):
        t._client = httpx.AsyncClient(transport=httpx.MockTransport(f.handler))

    async def run():
        seen = []
        async for e in src.stream():
            seen.append(e.log)
            if len(seen) >= 8:
                break
        return seen

    logs = asyncio.run(run())
    assert set(logs) == {"a.example", "b.example"}
    stats = src.stats()
    assert stats["source"] == "ctlogs" and len(stats["logs"]) == 2 and all(s["entries"] > 0 for s in stats["logs"])
