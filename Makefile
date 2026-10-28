.PHONY: setup demo demo-live serve test lint frontend deck docker watch clean

PY ?= python3
VENV ?= .venv
BIN := $(VENV)/bin

setup:            ## create the virtualenv, install SAQR (+dev) and the Chromium build Playwright needs
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e ".[dev]"
	$(BIN)/python -m playwright install chromium

demo:             ## full demonstration: replayed certificate feed + scripted scam wave, dashboard on :8000
	$(BIN)/saqr demo

demo-live:        ## same demo on top of the real global certificate logs (needs Internet)
	$(BIN)/saqr demo --live

serve:            ## run the node with the settings in .env
	$(BIN)/saqr serve

watch:            ## tail the live Certificate Transparency logs and print look-alike matches (no browser needed)
	$(BIN)/saqr watch --seconds 60

test:             ## run the test-suite
	$(BIN)/pytest -q

lint:
	$(BIN)/ruff check saqr tests

frontend:         ## rebuild the dashboard bundle (needs Node 22)
	cd frontend && npm install && npm run build

deck:             ## render the pitch deck (docs/presentation/index.html) to docs/SAQR-pitch.pdf
	$(BIN)/python docs/presentation/build.py

docker:           ## build and run with Docker Compose
	docker compose up --build

clean:
	rm -rf var .pytest_cache .ruff_cache
