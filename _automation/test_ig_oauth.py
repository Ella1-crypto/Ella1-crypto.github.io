import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ig_oauth as io  # noqa: E402
from jaetech_publish import ThreadsError  # noqa: E402
from test_refresh_token import FakeGitHub  # noqa: E402


def ig_http(token="tk-secret-value", page_accounts=None, ig_me=None, expires_in=None):
    """page_accounts: /me/accounts 결과의 인스타 계정 목록, ig_me: graph.instagram.com /me 결과(없으면 오류)."""
    calls = []

    def http(method, url, params):
        calls.append((method, url, dict(params)))
        if url.endswith("/oauth/access_token"):
            if params.get("grant_type") == "fb_exchange_token":
                return {"access_token": "LONG"}
            if not token:
                return {}
            body = {"access_token": token}
            if expires_in is not None:
                body["expires_in"] = expires_in
            return body
        if url.endswith("/me/accounts"):
            return {"data": [{"instagram_business_account": a} for a in (page_accounts or [])]}
        if "graph.instagram.com" in url:
            if ig_me is None:
                raise ThreadsError("HTTP 400: Invalid OAuth access token")
            return ig_me
        return {}
    http.calls = calls
    return http


def run(http, gh, code="abc123", masked=None):
    return io.run(code, "APP", "SECRET", "o/r", gh, http,
                  encrypt=lambda key, value: f"enc({key},{value})",
                  mask=(masked if masked is not None else []).append)


class ExchangeTest(unittest.TestCase):
    def test_stores_token_when_page_linked_account_matches(self):
        gh, masked = FakeGitHub(), []
        http = ig_http(page_accounts=[{"id": "1789", "username": "pick.haru.daily"}])
        result = run(http, gh, code="https://ella1-crypto.github.io/?code=abc123#_", masked=masked)
        self.assertEqual(masked, ["tk-secret-value"])
        self.assertEqual(gh.calls[-1][1], "/repos/o/r/actions/secrets/PICKHARU_IG_ACCESS_TOKEN")
        self.assertEqual(http.calls[0][2]["code"], "abc123")
        self.assertEqual(http.calls[0][2]["redirect_uri"], io.REDIRECT_URI)
        self.assertIn("1789", result)
        self.assertNotIn("tk-secret-value", result)

    def test_finds_account_through_instagram_host(self):
        gh = FakeGitHub()
        result = run(ig_http(ig_me={"user_id": "1790", "username": "pick.haru.daily"}), gh)
        self.assertIn("1790", result)
        self.assertIn("graph.instagram.com", result)

    def test_refuses_when_only_other_accounts_are_found(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            run(ig_http(page_accounts=[{"id": "9", "username": "gonuna.pick"}]), gh)
        self.assertFalse([c for c in gh.calls if c[0] == "PUT"])

    def test_stores_with_warning_when_no_account_is_visible(self):
        gh = FakeGitHub()
        result = run(ig_http(), gh)
        self.assertIn("확인 못함", result)
        self.assertEqual(gh.calls[-1][0], "PUT")

    def test_short_user_token_is_exchanged_for_long_one(self):
        gh, masked = FakeGitHub(), []
        http = ig_http(expires_in=3600, page_accounts=[{"id": "1", "username": "pick.haru.daily"}])
        run(http, gh, masked=masked)
        self.assertEqual(masked, ["LONG"])

    def test_fails_without_touching_secrets_when_code_is_expired(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            run(ig_http(token=""), gh)
        self.assertEqual(gh.calls, [])


if __name__ == "__main__":
    unittest.main()
