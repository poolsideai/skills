#!/usr/bin/env python3
"""Main entry point for acme-widgets service."""

import sys
from config import load_config

def main():
    config = load_config()
    print(f"Starting acme-widgets service on port {config.port}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
