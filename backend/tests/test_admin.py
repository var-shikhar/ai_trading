import duckdb
import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.services import accounts

PW = "correct horse battery"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    get_settings.cache_clear()
    accounts.reset_throttle()
    from app.main import app

    with TestClient(app) as c:
        accounts.create_user("boss", PW, role="admin")
        yield c
    get_settings.cache_clear()


def login(client, username, password=PW):
    client.cookies.clear()
    r = client.post("/api/session/login", json={"username": username, "password": password})
    return r


def test_old_users_table_is_migrated_and_first_user_becomes_admin(tmp_path, monkeypatch):
    path = tmp_path / "old.duckdb"
    con = duckdb.connect(str(path))
    con.execute("CREATE TABLE users (username VARCHAR PRIMARY KEY, password_hash VARCHAR NOT NULL, created TIMESTAMP NOT NULL)")
    con.execute("INSERT INTO users VALUES ('first', 'x', '2026-01-01'), ('second', 'y', '2026-02-01')")
    con.close()
    monkeypatch.setenv("DB_PATH", str(path))
    get_settings.cache_clear()
    db.close_conn()
    users = {u["username"]: u for u in accounts.list_users()}
    assert users["first"]["role"] == "admin" and users["second"]["role"] == "user"
    assert users["second"]["disabled"] is False and users["second"]["email"] is None


def test_admin_creates_and_manages_users(client):
    assert login(client, "boss").status_code == 200
    assert client.get("/api/session/me").json()["role"] == "admin"

    made = client.post("/api/admin/users", json={"username": "Asha", "password": PW, "email": "asha@example.com"})
    assert made.status_code == 200 and made.json()["role"] == "user" and made.json()["created_by"] == "boss"
    assert client.post("/api/admin/users", json={"username": "asha", "password": PW}).status_code == 400  # duplicate
    assert client.post("/api/admin/users", json={"username": "x", "password": PW}).status_code == 400  # too short
    assert client.post("/api/admin/users", json={"username": "ok_name", "password": "short"}).status_code == 400
    assert client.post("/api/admin/users", json={"username": "bad", "password": PW, "email": "nope"}).status_code == 400
    names = [u["username"] for u in client.get("/api/admin/users").json()]
    assert names == ["boss", "asha"]

    # A normal user can sign in but can't manage users.
    assert login(client, "asha").status_code == 200
    assert client.get("/api/admin/users").status_code == 403
    assert client.post("/api/admin/users", json={"username": "evil", "password": PW}).status_code == 403


def test_disable_reset_delete_end_sessions(client):
    login(client, "boss")
    client.post("/api/admin/users", json={"username": "ravi", "password": PW})

    other = TestClient(client.app)
    assert other.post("/api/session/login", json={"username": "ravi", "password": PW}).status_code == 200
    assert other.get("/api/session/me").status_code == 200

    assert client.patch("/api/admin/users/ravi", json={"disabled": True}).json()["disabled"] is True
    assert other.get("/api/session/me").status_code == 401  # signed out
    assert other.post("/api/session/login", json={"username": "ravi", "password": PW}).status_code == 403

    client.patch("/api/admin/users/ravi", json={"disabled": False})
    assert other.post("/api/session/login", json={"username": "ravi", "password": PW}).status_code == 200
    assert client.post("/api/admin/users/ravi/password", json={"password": "brand new secret"}).status_code == 200
    assert other.get("/api/session/me").status_code == 401  # reset signs out
    assert other.post("/api/session/login", json={"username": "ravi", "password": "brand new secret"}).status_code == 200

    assert client.patch("/api/admin/users/ravi", json={"email": "ravi@x.io", "set_email": True}).json()["email"] == "ravi@x.io"
    assert client.patch("/api/admin/users/ravi", json={"set_email": True}).json()["email"] is None
    assert client.delete("/api/admin/users/ravi").status_code == 200
    assert other.get("/api/session/me").status_code == 401
    assert client.delete("/api/admin/users/ravi").status_code == 404


def test_admin_guard_rails(client):
    login(client, "boss")
    assert client.patch("/api/admin/users/boss", json={"role": "user"}).status_code == 400
    assert client.patch("/api/admin/users/boss", json={"disabled": True}).status_code == 400
    assert client.delete("/api/admin/users/boss").status_code == 400
    # A second admin can be demoted while the first remains...
    client.post("/api/admin/users", json={"username": "deputy", "password": PW, "role": "admin"})
    assert client.patch("/api/admin/users/deputy", json={"role": "user"}).json()["role"] == "user"


def test_last_admin_cannot_be_removed_by_another_admin(client):
    login(client, "boss")
    client.post("/api/admin/users", json={"username": "deputy", "password": PW, "role": "admin"})
    login(client, "deputy")
    assert client.patch("/api/admin/users/boss", json={"disabled": True}).status_code == 200
    # deputy is now the only active admin and can't demote themselves
    assert client.patch("/api/admin/users/deputy", json={"role": "user"}).status_code == 400


def test_change_own_password_keeps_this_session_only(client):
    login(client, "boss")
    client.post("/api/admin/users", json={"username": "meera", "password": PW})
    device_a = TestClient(client.app)
    device_b = TestClient(client.app)
    device_a.post("/api/session/login", json={"username": "meera", "password": PW})
    device_b.post("/api/session/login", json={"username": "meera", "password": PW})

    wrong = device_a.post("/api/session/password", json={"current": "nope", "new": "another secret"})
    assert wrong.status_code == 403
    ok = device_a.post("/api/session/password", json={"current": PW, "new": "another secret"})
    assert ok.status_code == 200
    assert device_a.get("/api/session/me").status_code == 200  # this device stays signed in
    assert device_b.get("/api/session/me").status_code == 401  # the other one is signed out
