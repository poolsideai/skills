#!/usr/bin/env python3
"""Python hello world demonstration."""


def greet(name: str) -> str:
    return f"Hello from Python, {name}!"


if __name__ == "__main__":
    print(greet("world"))
