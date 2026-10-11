"""Account management from the command line (stop the server first: the
database can only be opened by one process). Day to day, admins manage
users in the app (account menu -> Manage users).

    python -m app.cli create-user <username> [--user] [--email you@example.com]
        Creates an admin unless --user is given.
    python -m app.cli set-password <username>
    python -m app.cli list-users
"""

import getpass
import sys

from app.services import accounts


def _password() -> str | None:
    password = getpass.getpass(f"Password (min {accounts.MIN_PASSWORD} characters): ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords don't match.")
        return None
    return password


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    command, rest = argv[0], argv[1:]
    try:
        if command == "list-users":
            for u in accounts.list_users():
                flags = " (disabled)" if u["disabled"] else ""
                print(f"{u['username']:20} {u['role']:6} {u['email'] or '':30}{flags}")
            return 0
        if command not in ("create-user", "set-password") or not rest:
            print(__doc__)
            return 2
        username = rest[0]
        password = _password()
        if password is None:
            return 1
        if command == "create-user":
            role = "user" if "--user" in rest else "admin"
            email = rest[rest.index("--email") + 1] if "--email" in rest and rest.index("--email") + 1 < len(rest) else None
            u = accounts.create_user(username, password, role=role, email=email, created_by="cli")
            print(f"Created {u['role']} '{u['username']}'.")
        else:
            accounts.set_password(username, password)
            print(f"Password changed for '{username.lower()}' (their sessions were signed out).")
    except (ValueError, LookupError) as e:
        print(e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
