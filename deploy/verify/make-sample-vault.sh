#!/usr/bin/env bash
# Creates a throwaway bare git repo with placeholder content, for local end-to-end
# verification of the git-sync -> builder -> Caddy chain (docker-compose.verify.yml).
# Never contains real vault content — see agents.md's "never bake vault content" rule.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf sample-vault sample-vault.git
mkdir sample-vault
cd sample-vault
git init -q -b main
git config user.email "verify@localhost"
git config user.name "verify"
echo "# Sample Vault" > index.md
echo "Placeholder content for local Caddy/git-sync verification." >> index.md
git add index.md
git commit -q -m "initial commit"
cd ..
git clone -q --bare sample-vault sample-vault.git
rm -rf sample-vault
echo "Sample bare repo ready at deploy/verify/sample-vault.git"
