"""Native acceptance backend: real manager, local fixture source, no GitHub access."""
import json
from pathlib import Path

import helper


class FixtureManager(helper.PackageManager):
    def __init__(self, root):
        if not (Path(root) / "mods-plus-fixture.json").is_file():
            raise ValueError("Use the disposable home prepared by native-fixture.mjs")
        super().__init__(root)
        self.fixture = json.loads((Path(root) / "mods-plus-fixture.json").read_text())
        self.blobs = {helper.blob_sha(value.encode()): value.encode() for value in self.fixture["files"].values()}

    def _gh_api(self, path):
        if path != "repos/fixture/packages":
            raise ValueError("Fixture source is fixture/packages")
        return {"default_branch": "main", "private": False}

    def branch_tree(self, repo, branch="HEAD", refresh=False):
        if repo != "fixture/packages":
            raise ValueError("Unknown fixture source")
        return {"HEAD": self.fixture["commit"], **{p: helper.blob_sha(v.encode()) for p, v in self.fixture["files"].items()}}

    def blob_bytes(self, repo, sha):
        if sha in self.blobs:
            return self.blobs[sha]
        return self.fixture["baseline"][sha].encode()

    def raw_content(self, repo, branch, path):
        return self.fixture["files"].get(path, "").encode()


helper.PackageManager = FixtureManager
helper.gallery.official_packages = lambda manager: []
if __name__ == "__main__":
    helper.main()
