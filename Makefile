# Chess Coach — entry point principali.
# Su Windows: serve `make` (Git for Windows lo include come `make` in MSYS,
# in alternativa usa direttamente i comandi Python sotto).

PY      ?= python
VENV    ?= .venv
ifeq ($(OS),Windows_NT)
  PYBIN := $(VENV)/Scripts/python.exe
  PIPBIN := $(VENV)/Scripts/pip.exe
else
  PYBIN := $(VENV)/bin/python
  PIPBIN := $(VENV)/bin/pip
endif

DEEP_FLAG := $(if $(DEEP),--deep,)
LIMIT_FLAG := $(if $(LIMIT),--limit $(LIMIT),)

.PHONY: help setup fetch analyze metrics dashboard all clean

help:
	@echo "Target disponibili:"
	@echo "  make setup       # crea venv e installa dipendenze backend+frontend"
	@echo "  make fetch       # scarica/aggiorna le partite da Chess.com"
	@echo "  make analyze     # analizza con Stockfish (DEEP=1 per profondità alta, LIMIT=N per le ultime N partite)"
	@echo "  make metrics     # ricostruisce data/metrics.json + copia in frontend/public"
	@echo "  make dashboard   # avvia il frontend Vite su http://localhost:5173"
	@echo "  make all         # fetch + analyze + metrics + dashboard"
	@echo "  make clean       # svuota data/raw e data/analysis (lascia metrics)"

setup:
	$(PY) -m venv $(VENV)
	$(PIPBIN) install --upgrade pip
	$(PIPBIN) install -r backend/requirements.txt
	cd frontend && npm install

fetch:
	$(PYBIN) backend/ingest.py

analyze:
	$(PYBIN) backend/analyze.py $(DEEP_FLAG) $(LIMIT_FLAG)

metrics:
	$(PYBIN) backend/metrics.py

dashboard:
	cd frontend && npm run dev

all: fetch analyze metrics dashboard

clean:
	@rm -rf data/raw data/analysis data/index.json
