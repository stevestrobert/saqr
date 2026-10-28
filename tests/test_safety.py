from saqr.verification.safety import check_target, host_is_blocked


def test_internal_targets_are_refused():
    for url in ("http://127.0.0.1:8000/api/status", "http://localhost/", "http://169.254.169.254/latest/meta-data/",
                "http://10.0.0.5/", "http://192.168.1.1/", "http://[::1]/", "http://metadata.google.internal/",
                "http://printer.local/", "file:///etc/passwd", "ftp://example.com/", "http://example.com:22/"):
        assert check_target(url), url


def test_public_targets_pass():
    for url in ("https://rta-fines-refund.com/refund", "http://8.8.8.8/", "https://example.com:8443/x"):
        assert check_target(url) is None, url


def test_router_guard_blocks_literal_internal_hosts_without_dns():
    assert host_is_blocked("127.0.0.1") and host_is_blocked("localhost") and host_is_blocked("10.1.2.3") and host_is_blocked("box.internal")
    assert not host_is_blocked("rta-fines-refund.com") and not host_is_blocked("1.1.1.1")
