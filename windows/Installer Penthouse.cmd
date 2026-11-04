@echo off
rem Penthouse pour Windows : copie l'app dans %LOCALAPPDATA%\Penthouse, puis l'ouvre.
rem Ainsi le lancement a l'ouverture de session ne depend pas du dossier telecharge.
rem Fichier en ASCII (fins de ligne CRLF) : les messages s'affichent correctement dans toutes les consoles.
setlocal
set "SOURCE=%~dp0"
set "DEST=%LOCALAPPDATA%\Penthouse"
if not exist "%SOURCE%Penthouse.ps1" goto extraire
if /i "%SOURCE%"=="%DEST%\" goto ouvrir
echo Penthouse : installation dans "%DEST%"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%SOURCE%*.*" "%DEST%" >nul || goto copie
:ouvrir
echo Ouverture de Penthouse...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -STA -File "%DEST%\Penthouse.ps1"
exit /b %errorlevel%
:extraire
echo Extrais d'abord tout le dossier du zip (clic droit sur le zip, puis Extraire tout), puis relance ce fichier.
pause
exit /b 1
:copie
echo Copie impossible vers "%DEST%".
pause
exit /b 1
