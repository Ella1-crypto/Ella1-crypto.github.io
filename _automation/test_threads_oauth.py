import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import threads_oauth as oa  # noqa: E402
from jaetech_publish import ThreadsError  # noqa: E402
from test_refresh_token import FakeGitHub  # noqa: E402


def oauth_http(username="pick.haru__1", short="SHORT", long="LONG"):
    calls = []

    def http(method, url, params):
        calls.append((method, url, dict(params)))
        if url.endswith("/oauth/access_token"):
            return {"access_token": short} if short else {}
        if url.endswith("/access_token"):
            return {"access_token": long} if long else {}
        return {"username": username, "id": "u2"}
    http.calls = calls
    return http


def run(http, gh, code="abc123", account="pick.haru__1", masked=None):
    return oa.run(account, code, "APP", "SECRET", "o/r", gh, http,
                  encrypt=lambda key, value: f"enc({key},{value})",
                  mask=(masked if masked is not None else []).append)


class CleanCodeTest(unittest.TestCase):
    def test_accepts_bare_code_with_hash_suffix(self):
        self.assertEqual(oa.clean_code("abc123#_"), "abc123")

    def test_extracts_code_from_full_redirect_url(self):
        self.assertEqual(oa.clean_code("https://ella1-crypto.github.io/?code=abc123#_"), "abc123")


class OAuthRunTest(unittest.TestCase):
    def test_exchanges_code_and_stores_long_token_in_account_secret(self):
        gh, masked, http = FakeGitHub(), [], oauth_http()
        result = run(http, gh, code="https://ella1-crypto.github.io/?code=abc123#_", masked=masked)
        self.assertEqual(masked, ["LONG"])
        method, path, body = gh.calls[-1]
        self.assertEqual((method, path), ("PUT", "/repos/o/r/actions/secrets/PICKHARU_THREADS_ACCESS_TOKEN"))
        self.assertEqual(body, {"encrypted_value": "enc(PUBKEY,LONG)", "key_id": "k1"})
        self.assertEqual(http.calls[0][2]["code"], "abc123")
        self.assertEqual(http.calls[0][2]["redirect_uri"], oa.REDIRECT_URI)
        self.assertNotIn("LONG", result)

    def test_refuses_to_store_token_of_other_account(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            run(oauth_http(username="heeya.dailyfit"), gh)
        self.assertFalse([c for c in gh.calls if c[0] == "PUT"])

    def test_fails_when_code_is_expired(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            run(oauth_http(short=""), gh)
        self.assertEqual(gh.calls, [])

    def test_rejects_unknown_account(self):
        with self.assertRaises(ValueError):
            run(oauth_http(), FakeGitHub(), account="someone")


if __name__ == "__main__":
    unittest.main()
