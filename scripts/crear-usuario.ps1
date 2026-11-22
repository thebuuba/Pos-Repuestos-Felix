[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Usuario,
    [Security.SecureString] $Clave,
    [string] $Perfil = 'repuestos-felix'
)

$ErrorActionPreference = 'Stop'
$Usuario = $Usuario.Trim().ToLowerInvariant()
if ($Usuario -notmatch '^[a-z0-9][a-z0-9._-]{1,39}$' -or $Usuario.EndsWith('.') -or $Usuario.Contains('..')) {
    throw 'Usa entre 2 y 40 letras sin tildes, numeros, puntos, guiones o guiones bajos.'
}
$ref = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../supabase/.temp/project-ref')).Trim()
if ($ref -ne 'uzbranexwuzcwkxaifsq') { throw 'El CLI debe estar vinculado al proyecto de Repuestos Felix.' }
$keys = supabase --profile $Perfil projects api-keys --project-ref $ref --reveal -o json
if ($LASTEXITCODE -ne 0) { throw 'Inicia sesion en el CLI con la cuenta de Repuestos Felix.' }
$available = $keys -join "`n" | ConvertFrom-Json
$role = ($available | Where-Object { $_.type -eq 'secret' -and $_.api_key -match '^sb_secret_' } | Select-Object -First 1).api_key
if (-not $role) { $role = ($available | Where-Object name -eq 'service_role').api_key }
if (-not $role) { throw 'Se necesita la clave administrativa del proyecto para crear usuarios.' }
if (-not $Clave) {
    $Clave = Read-Host "Contrasena para $Usuario (al menos 6 caracteres, sin combinaciones obligatorias)" -AsSecureString
    $confirm = Read-Host 'Repite la contrasena' -AsSecureString
}
$plain = [Net.NetworkCredential]::new('', $Clave).Password
if ($confirm -and $plain -cne [Net.NetworkCredential]::new('', $confirm).Password) { throw 'Las contrasenas no coinciden.' }
$characterCount = [Text.Encoding]::UTF32.GetByteCount($plain) / 4
if ($characterCount -lt 6 -or [Text.Encoding]::UTF8.GetByteCount($plain) -gt 72) { throw 'Usa al menos 6 caracteres y hasta 72 bytes.' }
$body = @{
    email = "$Usuario@usuarios.repuestosfelix.invalid"
    password = $plain
    email_confirm = $true
    user_metadata = @{ nombre_usuario = $Usuario }
    app_metadata = @{ acceso_pos = $true }
} | ConvertTo-Json -Compress
try {
    $headers = @{ apikey = $role }
    if ($role -notmatch '^sb_secret_') { $headers.Authorization = "Bearer $role" }
    $result = Invoke-RestMethod -Method Post -Uri "https://$ref.supabase.co/auth/v1/admin/users" -MaximumRedirection 0 -TimeoutSec 20 `
        -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
} catch {
    throw ('Supabase no confirmo el alta. Revisa Usuarios antes de reintentar. Estado HTTP ' + [int]$_.Exception.Response.StatusCode)
}
if ($result.email -cne "$Usuario@usuarios.repuestosfelix.invalid" -or $result.app_metadata.acceso_pos -ne $true) {
    throw 'Revisa la cuenta en Supabase. La respuesta no confirmo su acceso al POS.'
}
Write-Output "Usuario creado en Supabase: $Usuario"
