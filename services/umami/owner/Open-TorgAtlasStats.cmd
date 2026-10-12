@echo off
REM Double-click launcher. Set TORGATLAS_SSH_TARGET to override the SSH alias (default: auction-core-v01).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-TorgAtlasStats.ps1" %*
