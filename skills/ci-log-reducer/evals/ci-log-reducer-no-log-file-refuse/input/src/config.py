"""Configuration loader for acme-widgets."""

from dataclasses import dataclass

@dataclass
class Config:
    port: int = 8080
    debug: bool = False

def load_config():
    return Config()
