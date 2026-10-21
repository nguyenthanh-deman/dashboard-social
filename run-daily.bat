@echo off
rem Daily job: snapshot Zernio data into the data folder and build the weekly report.
rem Log file: data\last-run.log
cd /d "%~dp0"
if not exist data mkdir data
echo ===== %date% %time% =====>> data\last-run.log
node snapshot.mjs >> data\last-run.log 2>&1
exit /b %errorlevel%
