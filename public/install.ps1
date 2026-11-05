# penthouse-install-ps1 : relie ce PC Windows à ton étage du penthouse (équivalent Windows de install.sh).
#
# Depuis « Relier mes agents » (Windows PowerShell 5.1 de Windows 10/11, ou PowerShell 7) :
#   powershell -ExecutionPolicy Bypass -NoProfile -Command "& ([scriptblock]::Create((irm 'https://agent.ashuraz.xyz/install.ps1'))) -Key 'CLE'"
# Paramètres : -Key (obligatoire, ou variable d'environnement PENTHOUSE_KEY), -Site (défaut https://agent.ashuraz.xyz,
# ou PENTHOUSE_URL), -Replace (remplace une autre clé déjà en place, avec sauvegarde), -SansApp (n'installe pas l'app),
# -PartagerDemandes (le texte des demandes est visible des autres résidents), -SansDemandes (arrête ce partage).
# Sans -PartagerDemandes ni -SansDemandes, le choix déjà fait sur ce PC est gardé.
# Codes de sortie : 0 relié ; 1 échec ; 2 Python 3 ou curl.exe manquant ; 3 déjà relié à une autre clé (relancer avec -Replace).
#
# Comme install.sh : vérifie la clé avant de toucher à quoi que ce soit, copie les collecteurs dans ~\.config\tour,
# fait un premier envoi, planifie le suivi (tâche « Penthouse - suivi ») et installe l'app Penthouse.
# Seules des métadonnées partent (jamais les conversations). La clé n'est jamais affichée ni passée en argument.
# Ce fichier reste sans BOM (sinon [scriptblock]::Create échoue) et sans guillemets ni tirets typographiques :
# il doit s'analyser même si Windows PowerShell le décode en Windows-1252.
param(
  [string]$Key = '',
  [string]$Site = '',
  [switch]$Replace,
  [switch]$SansApp,
  [switch]$PartagerDemandes,
  [switch]$SansDemandes
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest est très lent avec la barre de progression (PowerShell 5.1)
$Task = 'Penthouse - suivi'

function Say([string]$Text) { Write-Host $Text }
function Fail([string]$Text, [int]$Code = 1) {
  Write-Host $Text -ForegroundColor Yellow
  exit $Code
}

# Lance un collecteur Python ; sa sortie va directement à l'écran, le code de retour reste dans $LASTEXITCODE.
function Invoke-Python([string]$File, [string[]]$Arguments = @()) {
  $ErrorActionPreference = 'Continue'   # PowerShell 5.1 : une ligne sur stderr ne doit pas devenir une exception
  & $Python $File @Arguments
}

# Premier Python 3.8+ qui répond vraiment (les raccourcis « python » du Microsoft Store répondent par une erreur).
function Find-Python {
  $ErrorActionPreference = 'Continue'
  $probe = 'import sys,json;print(json.dumps([sys.version_info[0],sys.version_info[1],sys.executable]))'
  $tooOld = ''
  foreach ($name in 'py', 'python', 'python3') {
    if (-not (Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)) { continue }
    $prefix = @()
    if ($name -eq 'py') { $prefix = @('-3') }
    $out = & $name @prefix -c $probe 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { continue }
    try { $info = ConvertFrom-Json ([string](@($out)[-1])) } catch { continue }
    if ($info[0] -eq 3 -and $info[1] -ge 8 -and $info[2]) { return [string]$info[2] }
    $tooOld = '' + $info[0] + '.' + $info[1]
  }
  if ($tooOld) { Say "Python $tooOld est trop ancien : il faut Python 3.8 ou plus récent." }
  return $null
}

# Équivalent de chmod 700 / 600 : héritage coupé, seul l'utilisateur garde l'accès. Sans icacls, le dossier
# personnel (réservé à l'utilisateur, au système et aux administrateurs) protège déjà ces fichiers.
function Protect-Path([string]$Path, [switch]$Folder) {
  if (-not $Owner) { return }
  $ErrorActionPreference = 'Continue'
  $right = if ($Folder) { '(OI)(CI)F' } else { 'F' }
  & icacls $Path /inheritance:r /grant:r ($Owner + ':' + $right) 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Say "Droits de $Path non restreints (icacls) : le dossier personnel les protège déjà." }
}

function Read-Setting([string]$Name) {
  $path = Join-Path $Dir $Name
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return ([IO.File]::ReadAllText($path)).Trim()
}

# UTF-8 sans BOM, comme les fichiers écrits par install.sh (lus par Python).
function Write-Setting([string]$Name, [string]$Value) {
  [IO.File]::WriteAllText((Join-Path $Dir $Name), $Value + "`n", (New-Object System.Text.UTF8Encoding $false))
}

# Ouvre l'app Penthouse sans fenêtre de console : pythonw + Penthouse.pyw, sinon PowerShell masqué.
function Start-App([string]$Folder) {
  $pythonw = Join-Path (Split-Path -Parent $Python) 'pythonw.exe'
  $launcher = Join-Path $Folder 'Penthouse.pyw'
  if ((Test-Path -LiteralPath $pythonw) -and (Test-Path -LiteralPath $launcher)) {
    Start-Process -FilePath $pythonw -ArgumentList ('"' + $launcher + '"')
  } else {
    $shell = 'powershell.exe'
    if ($env:SystemRoot) { $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }
    Start-Process -FilePath $shell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Folder 'Penthouse.ps1') + '"')
  }
}

function Install-App {
  $zip = Join-Path $Stage 'Penthouse-Windows.zip'
  $unpacked = Join-Path $Stage 'app'
  $target = Join-Path $env:LOCALAPPDATA 'Penthouse'
  try {
    Invoke-WebRequest -Uri ($Site + '/Penthouse-Windows.zip') -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
    $main = Get-ChildItem -LiteralPath $unpacked -Recurse -Filter 'Penthouse.ps1' | Select-Object -First 1
    if (-not $main) { throw "Penthouse.ps1 absent de l'archive." }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Get-ChildItem -LiteralPath $main.DirectoryName | Copy-Item -Destination $target -Recurse -Force
    try { Get-ChildItem -LiteralPath $target -Recurse -File | Unblock-File } catch { }   # retire la marque « téléchargé d'Internet »
  } catch {
    Say "App Penthouse non installée (facultative) : le suivi de tes agents fonctionne quand même."
    return
  }
  Say "App Penthouse installée : elle s'ouvre pour choisir les outils à lancer à chaque ouverture de session."
  try { Start-App $target } catch {
    Say ("Pour l'ouvrir plus tard : double-clic sur « Installer Penthouse.cmd » dans " + $target)
  }
}

# ---------- paramètres ----------
if (-not $Key) { $Key = '' + $env:PENTHOUSE_KEY }
$Key = $Key.Trim()
if (-not $Key) { Fail "Il manque la clé de ton étage : recopie la commande complète depuis « Relier mes agents »." }
if ($Key -notmatch '^[\x21-\x7E]+$') { Fail "Clé invalide : recopie la commande complète depuis « Relier mes agents » (ce n'est pas le code d'entrée)." }
if (-not $Site) { $Site = '' + $env:PENTHOUSE_URL }
if (-not $Site) { $Site = 'https://agent.ashuraz.xyz' }
$Site = $Site.Trim().TrimEnd('/')
$uri = $null
$local = @('localhost', '127.0.0.1', '[::1]')
if (-not [Uri]::TryCreate($Site, [UriKind]::Absolute, [ref]$uri) -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
    -not ($uri.Scheme -eq 'https' -or ($uri.Scheme -eq 'http' -and $local -contains $uri.Host))) {
  Fail "Adresse du penthouse invalide : HTTPS est requis pour envoyer la clé (http seulement pour localhost)."
}

$Dir = Join-Path (Join-Path $HOME '.config') 'tour'
$Stage = Join-Path ([IO.Path]::GetTempPath()) ('penthouse-' + [guid]::NewGuid().ToString('N'))
$Owner = ''
try { $Owner = '*' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value } catch { $Owner = '' + $env:USERNAME }
$previousEncoding = $null

try {
  # Sortie lue par un autre programme (app Penthouse) : tout en UTF-8, PowerShell comme Python.
  $env:PYTHONIOENCODING = 'utf-8'
  try {
    if ([Console]::IsOutputRedirected) {
      $previousEncoding = [Console]::OutputEncoding
      [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
    }
  } catch { }
  # PowerShell 5.1 n'active pas toujours TLS 1.2, exigé par le site.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  $Python = Find-Python
  if (-not $Python) {
    Fail ("Python 3 est nécessaire : il lit les journaux de Claude Code et Codex sur ce PC (rien d'autre n'est installé).`n" +
          "Pour l'installer, au choix :`n" +
          "  - dans un terminal : winget install -e --id Python.Python.3.12`n" +
          "  - ou depuis le Microsoft Store : « Python 3.12 »`n" +
          "Ferme ensuite cette fenêtre, ouvre-en une nouvelle et relance la même commande.") 2
  }
  $hasCurl = [bool](Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue)
  if (-not $hasCurl -and $env:SystemRoot) { $hasCurl = Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\curl.exe') }
  if (-not $hasCurl) {
    Fail ("curl.exe est nécessaire : il est fourni avec Windows 10 (version 1803 et plus) et Windows 11.`n" +
          "Mets Windows à jour, ou installe-le : winget install -e --id cURL.cURL") 2
  }

  # Une autre clé (ou un autre site) déjà en place : rien n'est touché sans -Replace.
  $oldKey = Read-Setting 'secret'
  if ($oldKey -and ($oldKey -cne $Key -or (Read-Setting 'url').TrimEnd('/') -cne $Site) -and -not $Replace) {
    Fail ("Ce PC est déjà relié à une autre configuration. Rien n'a été modifié.`n" +
          "Conserve ton relais actuel, ou ajoute -Replace à la commande pour le remplacer avec sauvegarde.") 3
  }

  New-Item -ItemType Directory -Path $Stage | Out-Null
  $files = 'tour-sync', 'install-sync.py', 'tour-check', 'tour_http.py'
  try {
    foreach ($file in $files) { Invoke-WebRequest -Uri ($Site + '/' + $file) -OutFile (Join-Path $Stage $file) -UseBasicParsing }
  } catch {
    Fail ("Téléchargement impossible depuis " + $Site + " : " + $_.Exception.Message + "`nVérifie le réseau, le proxy ou le VPN, puis relance la commande.")
  }

  # La clé est vérifiée avant toute modification ; elle passe par l'environnement du seul processus Python.
  $env:PENTHOUSE_KEY = $Key
  $env:PENTHOUSE_SITE = $Site
  try { Invoke-Python (Join-Path $Stage 'tour-check') @('--verify') }
  finally { Remove-Item Env:PENTHOUSE_KEY, Env:PENTHOUSE_SITE -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { Fail "Clé non vérifiée : rien n'a été modifié sur ce PC." }

  if (Test-Path -LiteralPath $Dir) {
    $backup = $Dir + '.backup-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + $PID
    Copy-Item -LiteralPath $Dir -Destination $backup -Recurse
    Protect-Path $backup -Folder
    Say 'Configuration précédente sauvegardée.'
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Protect-Path $Dir -Folder
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $Stage $file) -Destination (Join-Path $Dir $file) -Force }
  Write-Setting 'url' $Site
  Write-Setting 'secret' $Key
  Protect-Path (Join-Path $Dir 'secret')
  if (-not (Read-Setting 'host')) {
    $machine = ''
    try { $machine = ([Net.Dns]::GetHostName() -split '\.')[0] } catch { }
    if (-not $machine) { $machine = '' + $env:COMPUTERNAME }
    Write-Setting 'host' $machine
  }
  # Partage du texte des demandes : un simple fichier, lu par tour-sync.
  $share = Join-Path $Dir 'partage-demandes'
  if ($PartagerDemandes) { Set-Content -LiteralPath $share -Value '' -Encoding ASCII; Say 'Tes demandes seront visibles des autres résidents (-SansDemandes pour arrêter).' }
  if ($SansDemandes) { Remove-Item -LiteralPath $share -Force -ErrorAction SilentlyContinue; Say 'Tes demandes ne sont plus partagées.' }

  Invoke-Python (Join-Path $Dir 'tour-sync')
  if ($LASTEXITCODE -ne 0) { Fail 'Premier envoi impossible : vérifie le réseau, puis relance la commande.' }
  Invoke-Python (Join-Path $Dir 'tour-check')
  if ($LASTEXITCODE -ne 0) { Fail 'Diagnostic impossible : vérifie le réseau, puis relance la commande.' }
  Invoke-Python (Join-Path $Dir 'install-sync.py')
  if ($LASTEXITCODE -ne 0) { Fail ("Suivi automatique non planifié : ouvre le Planificateur de tâches et vérifie la tâche « " + $Task + " ».") }

  # L'app Penthouse (lance tes outils à chaque ouverture de session) s'installe avec, dans %LOCALAPPDATA%\Penthouse.
  # Facultative : -SansApp pour s'en passer ; le suivi fonctionne sans elle.
  if (-not $SansApp -and $env:LOCALAPPDATA) { Install-App }

  Say "C'est connecté. Les sessions locales récentes et les quotas disponibles sont envoyés au site automatiquement."
  Say ('Pour vérifier plus tard (PowerShell) : & "' + $Python + '" "' + (Join-Path $Dir 'tour-check') + '"')
} finally {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($previousEncoding) { try { [Console]::OutputEncoding = $previousEncoding } catch { } }
}
exit 0
