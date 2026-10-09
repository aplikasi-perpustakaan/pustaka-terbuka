@echo off
setlocal

set CSC="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist %CSC% (
    set CSC="C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

if not exist %CSC% (
    echo Error: .NET Framework 4.0 or higher is not installed.
    echo This is required to compile the application.
    exit /b 1
)

echo Compiling Harvester.cs...
%CSC% /nologo /out:PNM-Harvester.exe /reference:System.Web.Extensions.dll Harvester.cs

if %ERRORLEVEL% EQU 0 (
    echo Compilation successful! You can now run PNM-Harvester.exe
) else (
    echo Compilation failed.
)
