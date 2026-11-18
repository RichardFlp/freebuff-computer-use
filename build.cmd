@echo off
rem Builds build\FbcuHelper.exe and build\FreebuffComputerUse-Setup.exe
setlocal
cd /d "%~dp0"
if not exist build mkdir build
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
"%FW%\csc.exe" -nologo -optimize+ -platform:x64 -target:exe -out:build\FbcuHelper.exe ^
  -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:System.Web.Extensions.dll ^
  -r:"%FW%\WPF\UIAutomationClient.dll" -r:"%FW%\WPF\UIAutomationTypes.dll" -r:"%FW%\WPF\WindowsBase.dll" ^
  helper\FbcuHelper.cs || exit /b 1

copy /y ext\patch.cjs build\payload-patch.cjs >nul
set BUN=%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\resources\bun\bun.exe
if not exist "%BUN%" set BUN=bun
"%BUN%" build installer\install.js --compile --target=bun-windows-x64 --outfile build\FreebuffComputerUse-Setup.exe || exit /b 1
echo Built build\FreebuffComputerUse-Setup.exe
