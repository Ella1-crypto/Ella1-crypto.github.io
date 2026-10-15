import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refresh_token as rt  # noqa: E402
from jaetech_publish import ThreadsError  # noqa: E402


def threads_http(username="heeya.dailyfit", new_token="NEW"):
    def http(method, url, params):
        if "refresh_access_token" in url:
            return {"access_token": new_token, "expires_in": 5184000} if new_token else {}
        return {"username": username, "id": "u1"}
    return http


class FakeGitHub:
    def __init__(self):
        self.calls = []

    def __call__(self, method, path, body):
        self.calls.append((method, path, body))
        return {"key": "PUBKEY", "key_id": "k1"} if method == "GET" else {}


class RefreshTest(unittest.TestCase):
    def test_refreshes_and_stores_encrypted_secret(self):
        gh, masked = FakeGitHub(), []
        result = rt.run("OLD", "o/r", gh, threads_http(),
                        encrypt=lambda key, value: f"enc({key},{value})", mask=masked.append)
        self.assertIn("60일", result)
        self.assertEqual(masked, ["NEW"])
        method, path, body = gh.calls[-1]
        self.assertEqual((method, path), ("PUT", "/repos/o/r/actions/secrets/THREADS_ACCESS_TOKEN"))
        self.assertEqual(body, {"encrypted_value": "enc(PUBKEY,NEW)", "key_id": "k1"})
        self.assertNotIn("NEW", result)

    def test_does_not_update_secret_when_new_token_is_other_account(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            rt.run("OLD", "o/r", gh, threads_http(username="someone"), encrypt=lambda k, v: v)
        self.assertEqual(gh.calls, [])

    def test_missing_token_in_response_raises(self):
        gh = FakeGitHub()
        with self.assertRaises(ThreadsError):
            rt.run("OLD", "o/r", gh, threads_http(new_token=""), encrypt=lambda k, v: v)
        self.assertEqual(gh.calls, [])


if __name__ == "__main__":
    unittest.main()
