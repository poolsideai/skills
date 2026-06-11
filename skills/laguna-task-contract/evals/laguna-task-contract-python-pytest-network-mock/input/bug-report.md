# Test suite hitting live API

**Reporter:** @emma-platform  
**Date:** 2024-01-18

## Problem

Our `tests/api_client_test.py` is making real HTTP requests to `https://api.weatherservice.example/v1/current` during test runs. This causes flaky CI failures when the external service is slow or down, and we're getting rate-limited on their free tier.

## What we need

Patch `tests/api_client_test.py` to use the `responses` library (already in requirements.txt) to mock the HTTP calls. The test should pass locally with `pytest tests/api_client_test.py` without hitting the network.

## Context

- The failing test is `test_fetch_current_weather` (line 15-22)
- We have `responses==0.24.1` available
- The API returns JSON like `{"temperature": 72, "condition": "sunny"}`
- Keep the existing assertions; just mock the network layer
