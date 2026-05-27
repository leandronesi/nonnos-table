@echo off
REM ==========================================================================
REM Mygotham — pipeline completa locale
REM
REM Replica la sequenza di .github/workflows/refresh-and-deploy.yml in locale.
REM Scarica nuove partite Chess.com, le analizza, ribuilda il db, rigenera
REM player_model + coach brief.
REM
REM Uso:
REM   refresh.bat            (pipeline completa)
REM   refresh.bat fast       (skip analyze --deep, piu` veloce)
REM   refresh.bat coachonly  (solo player_model + coach, no ingest/analyze)
REM
REM Prerequisiti: venv attivo a C:\dev\chesspath-venv, Stockfish in PATH
REM (o ./engine/stockfish.exe), OPENAI_API_KEY in .env.
REM ==========================================================================

setlocal
REM Self-locate: il batch funziona da qualunque cwd (anche con spazi nel path)
cd /d "%~dp0"

set "PY=C:\dev\chesspath-venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

set "MODE=%1"
if "%MODE%"=="" set "MODE=full"

set "PYTHONIOENCODING=utf-8"

echo.
echo === [1/10] Ingest Chess.com (partite nuove) ===
%PY% backend\ingest.py || goto :err

if "%MODE%"=="coachonly" goto :coachonly

echo.
echo === [2/10] Analyze (Stockfish) ===
if "%MODE%"=="fast" (
    %PY% backend\analyze.py || goto :err
) else (
    %PY% backend\analyze.py --deep || goto :err
    %PY% backend\analyze.py || goto :err
)

echo.
echo === [3/10] Build positions DB ===
%PY% backend\build_positions_db.py || goto :err

echo.
echo === [4/10] Maia features ===
%PY% backend\maia_features.py
REM Maia puo` fallire se non installato — non blocca il resto
if errorlevel 1 echo (Maia features skipped — engine non disponibile)

echo.
echo === [5/10] Derive features ===
%PY% backend\derive_features.py || goto :err

echo.
echo === [6/10] Enrich decisions ===
%PY% backend\enrich_decisions.py || goto :err

echo.
echo === [7/10] Tactical patterns (motif tagging) ===
%PY% backend\tactical_patterns.py || goto :err

echo.
echo === [8/10] Compute waiting_moves (Stockfish multi-PV) ===
%PY% backend\compute_waiting_moves.py
if errorlevel 1 echo (waiting_moves skipped — Stockfish non disponibile)

:coachonly
echo.
echo === [9/10] Player model build ===
%PY% backend\player_model.py || goto :err

echo.
echo === [10/10] Coach LLM (brief + voce Nonno + session phrases) ===
%PY% backend\coach.py || goto :err

echo.
echo === DONE === Pipeline completata. Hard-reload del browser su localhost.
exit /b 0

:err
echo.
echo === ERRORE === Pipeline interrotta. Vedi messaggi sopra.
exit /b 1
