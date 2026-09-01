@echo off
setlocal
REM ============================================================
REM  update-github.bat
REM  Commits project changes and pushes to GitHub.
REM  Pushing to 'main' auto-triggers the GitHub Pages deploy
REM  (.github/workflows/deploy.yml) and updates the live site.
REM
REM  Excludes scratch/archive files: f1.zip, review.zip, files.txt
REM ============================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo === 1/4: Checking for changes...
git fetch origin --quiet
git status --porcelain > nul
if errorlevel 1 (
    echo ERROR: not a git repository. Aborting.
    exit /b 1
)

echo.
echo === 2/4: Staging project files (excluding scratch archives)...
git add -- . ":(exclude)f1.zip" ":(exclude)review.zip" ":(exclude)files.txt"
if errorlevel 1 goto :fail

echo.
echo === 3/4: Committing changes (if any)...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "feat: gameplay/HUD updates"
    if errorlevel 1 goto :fail
    echo Committed.
) else (
    echo No staged changes to commit.
)

echo.
echo === 4/4: Pushing to origin/main (triggers GitHub Pages deploy)...
git push origin main
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo   Done. Pushed to GitHub.
echo   GitHub Pages deploy should now run automatically.
echo   Live site: https://mas-ghub.github.io/Formula-one-Polygon/
echo ============================================================
exit /b 0

:fail
echo.
echo ERROR: A step failed. See messages above.
exit /b 1
