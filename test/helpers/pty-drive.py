#!/usr/bin/env python3
# Runs a command on a pseudo-terminal and relays bytes, for test/integration/shell-tty.test.ts (plan 02-19).
#
#   pty-drive.py ROWS COLS command [args...]
#
# The command gets a pseudo-terminal of ROWS x COLS as its standard input, output and error. Everything this program reads on its own standard
# input is written to the terminal as keyboard input, as it arrives (so a test can wait for output and then type); everything the command prints
# is copied to this program's standard output; the exit status is the command's. Closing this program's standard input sends nothing to the
# command: unlike script(1), which sends end-of-file to the terminal when its input ends, this lets a test decide when and how a shell ends.
# Test tooling only: nothing under src/ or bin/ uses it.
import fcntl
import os
import pty
import select
import struct
import sys
import termios


def main() -> int:
    rows, cols = int(sys.argv[1]), int(sys.argv[2])
    command = sys.argv[3:]
    pid, master = pty.fork()
    if pid == 0:
        # In the child, so the size is set before the command starts and reads it.
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.execvp(command[0], command)
    reading_input = True
    while True:
        wanted = [master] + ([0] if reading_input else [])
        readable, _, _ = select.select(wanted, [], [])
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(1, data)
        if reading_input and 0 in readable:
            data = os.read(0, 65536)
            if not data:
                reading_input = False
            else:
                os.write(master, data)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == '__main__':
    sys.exit(main())
