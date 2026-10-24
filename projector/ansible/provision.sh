#!/bin/sh
# Run the playbook. The stdin/stdout redirects are needed when launched from Claude Code
# (Ansible refuses non-blocking file handles); harmless from a normal terminal.
cd "$(dirname "$0")" && ansible-playbook site.yml "$@" </dev/null 2>&1 | cat
