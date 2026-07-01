@echo off
setlocal EnableExtensions
title Agent Light - Generate production secrets

echo.
echo === Agent Light production secrets (64 hex chars each) ===
echo.

for %%V in (ACCESS_TOKEN_SECRET REFRESH_TOKEN_SECRET ACTIVATION_SIGNING_SECRET) do (
  for /f "delims=" %%S in ('powershell -NoProfile -Command "$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b|ForEach-Object { $_.ToString('x2') }) -join ''"') do (
    echo %%V=%%S
  )
)

echo.
echo Copy the lines above into server/.env or your cloud env vars.
echo.
