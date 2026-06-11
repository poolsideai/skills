import requests


class WeatherClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.weatherservice.example/v1"

    def _build_url(self, endpoint: str) -> str:
        return f"{self.base_url}/{endpoint}"

    def fetch_current(self, city: str) -> dict:
        if not city or city.strip() == "":
            raise ValueError("City name cannot be empty")
        url = self._build_url("current")
        response = requests.get(url, params={"city": city, "key": self.api_key})
        response.raise_for_status()
        return response.json()
