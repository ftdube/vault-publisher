#!/usr/bin/env bash
# Assert that the Node running this CI job is the one the Dockerfile builds on.
#
# The version is declared twice and cannot be deduplicated: `setup-node` cannot
# read the Dockerfile. So it is asserted instead. Run this in EVERY job that
# sets up Node — a guard in one job leaves the others free to drift and still
# report green.
#
# `|| true` on the grep pipeline is load-bearing: under `pipefail` a
# non-matching grep would abort the script here, before the explicit
# "could not parse" message below could ever run.
set -euo pipefail

want=$(grep -oE '^FROM node:[0-9]+' Dockerfile | cut -d: -f2 | sort -u || true)

if [ -z "$want" ]; then
  echo "::error::could not parse any 'FROM node:<major>' line from Dockerfile"
  exit 1
fi
if [ "$(printf '%s\n' "$want" | wc -l | tr -d ' ')" -ne 1 ]; then
  echo "::error::Dockerfile stages disagree on the Node major: $(printf '%s ' $want)"
  exit 1
fi

have=$(node -p 'process.versions.node.split(".")[0]')
if [ "$want" != "$have" ]; then
  echo "::error::Dockerfile builds on node $want but this CI job runs $have"
  exit 1
fi
echo "node $have matches the Dockerfile"
