"""Account management (there is no public sign-up).

    python -m app.cli create-user <username>
    python -m app.cli set-password <username>
"""

import getpass
import sys

from app.services import accounts


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("create-user", "set-password"):
        print(__doc__)
        return 2
    command, username = argv
    password = getpass.getpass("Password (min 8 characters): ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords don't match.")
        return 1
    try:
        if command == "create-user":
            accounts.create_user(username, password)
            print(f"Created user '{username.lower()}'.")
        else:
            accounts.set_password(username, password)
            print(f"Password changed for '{username.lower()}' (their sessions were signed out).")
    except ValueError as e:
        print(e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
