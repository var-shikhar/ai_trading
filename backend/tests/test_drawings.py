from fastapi.testclient import TestClient

from app.main import app


def test_drawings_roundtrip_per_symbol():
    with TestClient(app) as client:
        assert client.get("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}).json() == {"drawings": []}
        items = [{"id": "a", "type": "trend", "points": [{"time": 1, "price": 10}, {"time": 2, "price": 11}]}]
        assert client.put("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}, json={"drawings": items}).json() == {"count": 1}
        assert client.get("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}).json()["drawings"] == items
        assert client.get("/api/drawings", params={"symbol": "NSE:TCS-EQ"}).json()["drawings"] == []
        client.put("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}, json={"drawings": []})
        assert client.get("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}).json()["drawings"] == []
