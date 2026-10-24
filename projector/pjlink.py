#!/usr/bin/env python3
"""Tiny PJLink Class 1 client for the Casio XJ-F211WN projectors. No dependencies.

  pjlink.py [--host H ...] [--password P] [--retry N] status
  pjlink.py on | off | mute | unmute | input <code> | raw "<CMD arg>" ...

Config: PJ_HOSTS (space separated) and PJ_PASSWORD, from the environment or from the stack .env next to
compose.yaml (also tried next to this script). Flags --host/--password override. Defaults: none / admin (PJ_HOSTS is required).
Every action opens a fresh TCP session (the projector allows one at a time and drops idle ones).
Exit status is non-zero if any projector returned an error or was unreachable.

Gotchas learned on the real unit (see docs-projector-control.md):
  * Lines end in "\\r" only, never "\\n" -- read byte-wise, don't use readline().
  * Auth is on: the first command of each session is prefixed with md5(nonce + password).
  * After power-on the LAN link is dead for ~1 min; `--retry N` keeps trying.
"""
import argparse
import hashlib
import os
import socket
import sys
import time

PORT = 4352
INPUTS = {'11': 'RGB1', '12': 'RGB2', '13': 'RGB3', '21': 'Video', '31': 'HDMI1', '32': 'HDMI2',
          '43': 'USB', '44': 'Network', '45': 'USB(2)'}
POWER = {'0': 'off (standby)', '1': 'on', '2': 'cooling', '3': 'warming up'}
MUTE = {'11': 'video muted', '21': 'audio muted', '31': 'audio+video muted', '30': 'not muted'}
ERRORS = {'OK': 'ok', 'ERR1': 'undefined command', 'ERR2': 'out of parameter',
          'ERR3': 'unavailable time (e.g. cooling / warming)', 'ERR4': 'projector failure',
          'ERRA': 'authentication failed'}


def _readline(s):
    buf = b''
    while not buf.endswith(b'\r'):
        ch = s.recv(1)
        if not ch:
            break
        buf += ch
    return buf.decode(errors='replace').strip()


def session(host, password, cmds, timeout=6):
    """Run PJLink commands in one session; return list of (cmd, reply-body-or-ERRx)."""
    with socket.create_connection((host, PORT), timeout=timeout) as s:
        greet = _readline(s)
        prefix = ''
        if greet.startswith('PJLINK 1 '):
            prefix = hashlib.md5((greet.split()[2] + password).encode()).hexdigest()
        elif not greet.startswith('PJLINK 0'):
            raise RuntimeError(f'unexpected greeting {greet!r}')
        out = []
        for c in cmds:
            s.sendall((prefix + '%1' + c + '\r').encode())
            prefix = ''  # only the first command of a session carries the digest
            r = _readline(s)
            if r == 'PJLINK ERRA':
                raise RuntimeError('authentication failed (wrong password?)')
            # reply looks like %1POWR=1 ; strip the "%1XXXX=" echo
            out.append((c, r.split('=', 1)[1] if '=' in r else r))
        return out


def with_retry(fn, tries, delay=5):
    for i in range(tries):
        try:
            return fn()
        except (OSError, RuntimeError) as e:
            if i == tries - 1:
                raise
            print(f'  ... {e}; retry {i + 1}/{tries - 1} in {delay}s', file=sys.stderr)
            time.sleep(delay)


def status(host, pw):
    q = ['NAME ?', 'INF2 ?', 'POWR ?', 'INPT ?', 'AVMT ?', 'ERST ?', 'LAMP ?', 'INST ?']
    r = dict(session(host, pw, q))
    lamp = r['LAMP ?'].split()
    print(f"{host}: {r['NAME ?']} ({r['INF2 ?']})")
    print(f"  power  {POWER.get(r['POWR ?'], r['POWR ?'])}")
    print(f"  input  {r['INPT ?']} {INPUTS.get(r['INPT ?'], '')}   available: "
          + ' '.join(f"{c}={INPUTS.get(c, '?')}" for c in r['INST ?'].split()))
    print(f"  mute   {MUTE.get(r['AVMT ?'], r['AVMT ?'])}")
    print(f"  lamp   {lamp[0]} h, {'on' if lamp[1:] == ['1'] else 'off'}")
    e = r['ERST ?']
    print(f"  errors {'none' if e == '000000' else e + '  (fan lamp temp cover filter other; 1=warn 2=err)'}")
    return True


def do(host, pw, cmds):
    ok = True
    for c, r in session(host, pw, cmds):
        print(f'{host}: {c} -> {r} {ERRORS.get(r, "")}'.rstrip())
        ok &= not r.startswith('ERR')
    return ok


def _load_dotenv():
    """Fill os.environ from the first .env found next to this script or in its parent (repo/stack root).
    KEY=VALUE lines only; quotes stripped; ' # ...' trailing comments dropped; existing env wins."""
    here = os.path.dirname(os.path.abspath(__file__))
    for d in (here, os.path.dirname(here)):
        p = os.path.join(d, '.env')
        if not os.path.isfile(p):
            continue
        with open(p) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                v = v.split(' #', 1)[0].strip().strip('"').strip("'")
                os.environ.setdefault(k.strip(), v)
        return


def main():
    _load_dotenv()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--host', action='append', help='projector IP/hostname (repeatable)')
    ap.add_argument('--password', default=os.environ.get('PJ_PASSWORD', 'admin'))
    ap.add_argument('--retry', type=int, default=1, metavar='N', help='attempts per projector (default 1)')
    ap.add_argument('action', choices=['status', 'on', 'off', 'mute', 'unmute', 'input', 'raw'])
    ap.add_argument('args', nargs='*')
    a = ap.parse_args()
    hosts = a.host or os.environ.get('PJ_HOSTS', '').split()
    if not hosts:
        ap.error('no projector hosts: set PJ_HOSTS in the environment or .env, or pass --host')

    cmds = {'on': ['POWR 1'], 'off': ['POWR 0'], 'mute': ['AVMT 31'], 'unmute': ['AVMT 30'],
            'input': ['INPT ' + (a.args[0] if a.args else '31')], 'raw': a.args}.get(a.action)

    ok = True
    for h in hosts:
        try:
            if a.action == 'status':
                ok &= with_retry(lambda: status(h, a.password), a.retry)
            else:
                ok &= with_retry(lambda: do(h, a.password, cmds), a.retry)
        except (OSError, RuntimeError) as e:
            print(f'{h}: {e}', file=sys.stderr)
            ok = False
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
