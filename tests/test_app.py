from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_read_main():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_get_all_pcs():
    response = client.get("/api/pcs")
    assert response.status_code == 200
    assert "pcs" in response.json()
    assert isinstance(response.json()["pcs"], list)


def test_get_active_pcs():
    response = client.get("/api/pcs/active")
    assert response.status_code == 200
    assert "pcs" in response.json()
    assert isinstance(response.json()["pcs"], list)


def test_add_pc_invalid_data():
    response = client.post("/api/pcs", json={"invalid_field": "test"})
    assert response.status_code == 422  # Unprocessable Entity for validation error
