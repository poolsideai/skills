import pytest
import requests
from api_client import WeatherClient


def test_initialization():
    client = WeatherClient(api_key="test-key-123")
    assert client.api_key == "test-key-123"
    assert client.base_url == "https://api.weatherservice.example/v1"


def test_build_url():
    client = WeatherClient(api_key="test-key-123")
    assert client._build_url("current") == "https://api.weatherservice.example/v1/current"


def test_fetch_current_weather():
    """Test fetching current weather data."""
    client = WeatherClient(api_key="demo-key")
    # This hits the real API and causes flaky failures
    data = client.fetch_current(city="London")
    assert "temperature" in data
    assert "condition" in data


def test_invalid_city():
    client = WeatherClient(api_key="demo-key")
    with pytest.raises(ValueError, match="City name cannot be empty"):
        client.fetch_current(city="")
