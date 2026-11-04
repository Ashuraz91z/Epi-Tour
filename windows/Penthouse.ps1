# Penthouse pour Windows : relie ce PC au penthouse et lance tes outils d'IA à chaque ouverture de session.
#   Première ouverture : clé de ton étage (comme « Relier mes agents »), choix des outils, lancement automatique.
#   Ouverture de session (-Login, raccourci du dossier Démarrage) : lance les outils cochés et relance le suivi.
#   Ouverture à la main (menu Démarrer > Penthouse) : lancer maintenant, changer les outils, vérifier la connexion,
#   relier avec une autre clé, arrêter le lancement automatique, désinstaller.
# Rien n'est envoyé d'autre que ce que fait déjà install.ps1 (métadonnées des sessions, jamais les conversations).
# Windows PowerShell 5.1 (Windows 10/11). Fichier en UTF-8 avec BOM, sans guillemets ni tirets typographiques.
param([switch]$Login)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SiteDefault = 'https://agent.ashuraz.xyz'
$Task = 'Penthouse - suivi'
$Here = $PSScriptRoot
$script:PythonPath = $null
$script:StartApps = $null
$script:Icon = $null

# Chemins de ce PC, fixés au démarrage (shell:startup et menu Démarrer de l'utilisateur).
function Initialize-Paths {
  $script:Conf = Join-Path (Join-Path $HOME '.config') 'tour'
  $script:AppsFile = Join-Path $script:Conf 'login-apps.json'
  $script:AppDir = Join-Path $env:LOCALAPPDATA 'Penthouse'
  $script:WindowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script:StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Penthouse.lnk'
  $script:MenuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Penthouse.lnk'
}

# ---------- journal (jamais la clé) ----------
function Write-Log([string]$Text) {
  try {
    New-Item -ItemType Directory -Force -Path $Conf | Out-Null
    Add-Content -LiteralPath (Join-Path $Conf 'penthouse-app.log') -Value ((Get-Date -Format 's') + ' ' + $Text) -Encoding UTF8
  } catch { }
}

# ---------- fenêtres (Windows Forms) ----------
function Update-Ui { [System.Windows.Forms.Application]::DoEvents() }

function New-Window {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Penthouse'
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $form.AutoSize = $true
  $form.AutoSizeMode = 'GrowAndShrink'
  $form.Tag = ''
  if ($script:Icon) { $form.Icon = $script:Icon }
  $layout = New-Object System.Windows.Forms.FlowLayoutPanel
  $layout.FlowDirection = 'TopDown'
  $layout.WrapContents = $false
  $layout.AutoSize = $true
  $layout.AutoSizeMode = 'GrowAndShrink'
  $layout.Location = New-Object System.Drawing.Point(12, 12)
  $layout.Margin = New-Object System.Windows.Forms.Padding(0, 0, 12, 12)
  $form.Controls.Add($layout)
  return $form
}

function Add-Text($Layout, [string]$Text) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.UseMnemonic = $false
  $label.AutoSize = $true
  $label.MaximumSize = New-Object System.Drawing.Size(460, 0)
  $label.Margin = New-Object System.Windows.Forms.Padding(3, 3, 3, 12)
  $Layout.Controls.Add($label)
}

# Rangée de boutons ; le bouton cliqué ferme la fenêtre et laisse son libellé dans Tag. Renvoie les boutons.
function Add-Buttons($Layout, [string[]]$Labels) {
  $row = New-Object System.Windows.Forms.FlowLayoutPanel
  $row.FlowDirection = 'LeftToRight'
  $row.WrapContents = $false
  $row.AutoSize = $true
  $row.Anchor = 'Right'
  $buttons = @()
  foreach ($text in $Labels) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $text
    $button.UseMnemonic = $false
    $button.AutoSize = $true
    $button.MinimumSize = New-Object System.Drawing.Size(96, 32)
    $button.Add_Click({ $window = $this.FindForm(); $window.Tag = $this.Text; $window.Close() })
    $row.Controls.Add($button)
    $buttons += $button
  }
  $Layout.Controls.Add($row)
  return $buttons
}

# Message et boutons ; renvoie le libellé choisi ('' si la fenêtre est fermée).
function Show-Choice([string]$Text, [string[]]$Buttons) {
  $form = New-Window
  Add-Text $form.Controls[0] $Text
  $form.AcceptButton = @(Add-Buttons $form.Controls[0] $Buttons)[0]
  [void]$form.ShowDialog()
  $choice = [string]$form.Tag
  $form.Dispose()
  return $choice
}

# Liste verticale d'actions (Réglages).
function Show-Menu([string]$Text, [string[]]$Items) {
  $form = New-Window
  Add-Text $form.Controls[0] $Text
  foreach ($item in $Items) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $item
    $button.UseMnemonic = $false
    $button.TextAlign = 'MiddleLeft'
    $button.Size = New-Object System.Drawing.Size(460, 36)
    $button.Add_Click({ $window = $this.FindForm(); $window.Tag = $this.Text; $window.Close() })
    $form.Controls[0].Controls.Add($button)
  }
  [void]$form.ShowDialog()
  $choice = [string]$form.Tag
  $form.Dispose()
  return $choice
}

# Saisie ; renvoie $null si annulée.
function Show-Input([string]$Text, [string]$Default, [switch]$Hidden) {
  $form = New-Window
  Add-Text $form.Controls[0] $Text
  $box = New-Object System.Windows.Forms.TextBox
  $box.Width = 460
  $box.Text = $Default
  $box.UseSystemPasswordChar = [bool]$Hidden
  $box.Margin = New-Object System.Windows.Forms.Padding(3, 0, 3, 12)
  $form.Controls[0].Controls.Add($box)
  $buttons = @(Add-Buttons $form.Controls[0] @('OK', 'Annuler'))
  $form.AcceptButton = $buttons[0]
  $form.CancelButton = $buttons[1]
  $form.ActiveControl = $box
  [void]$form.ShowDialog()
  $value = $null
  if ($form.Tag -eq 'OK') { $value = $box.Text.Trim() }
  $form.Dispose()
  return $value
}

# Cases à cocher ; renvoie les libellés cochés (liste éventuellement vide), ou $null si annulé.
function Show-Checklist([string]$Text, [string[]]$Labels, [bool[]]$Checked) {
  $form = New-Window
  Add-Text $form.Controls[0] $Text
  $list = New-Object System.Windows.Forms.CheckedListBox
  $list.CheckOnClick = $true
  $list.Width = 460
  for ($i = 0; $i -lt $Labels.Count; $i++) { [void]$list.Items.Add($Labels[$i], $Checked[$i]) }
  $form.Controls[0].Controls.Add($list)
  $list.Height = [Math]::Min($Labels.Count, 12) * $list.ItemHeight + 12
  $buttons = @(Add-Buttons $form.Controls[0] @('OK', 'Annuler'))
  $form.AcceptButton = $buttons[0]
  $form.CancelButton = $buttons[1]
  [void]$form.ShowDialog()
  $chosen = $null
  if ($form.Tag -eq 'OK') { $chosen = @($list.CheckedItems | ForEach-Object { [string]$_ }) }
  $form.Dispose()
  if ($null -eq $chosen) { return $null }
  return ,$chosen
}

# Petite fenêtre « en cours » pendant une opération longue ; l'appelant la ferme.
function Show-Busy([string]$Text) {
  $form = New-Window
  $form.ControlBox = $false
  Add-Text $form.Controls[0] $Text
  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Style = 'Marquee'
  $bar.Width = 460
  $form.Controls[0].Controls.Add($bar)
  $form.Show()
  Update-Ui
  return $form
}

function Show-Notification([string]$Text) {
  try {
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = if ($script:Icon) { $script:Icon } else { [System.Drawing.SystemIcons]::Information }
    $notify.Text = 'Penthouse'
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000, 'Penthouse', $Text, 'Info')
    $until = (Get-Date).AddSeconds(6)
    while ((Get-Date) -lt $until) { Update-Ui; Start-Sleep -Milliseconds 100 }
    $notify.Dispose()
  } catch { Write-Log ('notification : ' + $_.Exception.Message) }
}

# ---------- réglages ----------
function Read-Setting([string]$Name) {
  $path = Join-Path $Conf $Name
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return ([IO.File]::ReadAllText($path)).Trim()
}

function Test-Linked { return [bool]((Read-Setting 'secret') -and (Read-Setting 'url')) }

# Même règle que install.ps1 et tour_http.py : HTTPS, ou http pour localhost seulement.
function Test-Site([string]$Site) {
  if ($Site -notmatch '^[A-Za-z0-9._~%:/\[\]-]+$') { return $false }
  $uri = $null
  if (-not [Uri]::TryCreate($Site, [UriKind]::Absolute, [ref]$uri)) { return $false }
  if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) { return $false }
  return ($uri.Scheme -eq 'https' -or ($uri.Scheme -eq 'http' -and @('localhost', '127.0.0.1', '[::1]') -contains $uri.Host))
}

# Outils cochés, dans %USERPROFILE%\.config\tour\login-apps.json.
function Read-Apps {
  if (-not (Test-Path -LiteralPath $AppsFile)) { return }
  try {
    $data = [IO.File]::ReadAllText($AppsFile) | ConvertFrom-Json
    foreach ($app in @($data.apps)) { if ($app -and $app.id -and $app.kind) { $app } }
  } catch { Write-Log ('login-apps.json illisible : ' + $_.Exception.Message) }
}

function Save-Apps($Apps) {
  New-Item -ItemType Directory -Force -Path $Conf | Out-Null
  $list = @($Apps | ForEach-Object { [ordered]@{ id = $_.id; label = $_.label; kind = $_.kind; target = $_.target } })
  $json = ConvertTo-Json -InputObject ([ordered]@{ version = 1; apps = $list }) -Depth 4
  [IO.File]::WriteAllText($AppsFile, $json, (New-Object System.Text.UTF8Encoding $false))
}

# Relit le PATH enregistré : un outil ou Python installé depuis l'ouverture de session est trouvé.
function Update-Path {
  $parts = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path)
  $env:Path = (@($parts | Where-Object { $_ }) -join [IO.Path]::PathSeparator)
}

# ---------- Python (collecteurs) ----------
# Premier Python 3.8+ qui répond vraiment (les raccourcis « python » du Microsoft Store répondent par une erreur).
function Find-Python {
  if ($script:PythonPath) { return $script:PythonPath }
  $ErrorActionPreference = 'Continue'
  $probe = 'import sys,json;print(json.dumps([sys.version_info[0],sys.version_info[1],sys.executable]))'
  foreach ($name in 'py', 'python', 'python3') {
    if (-not (Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)) { continue }
    $prefix = @()
    if ($name -eq 'py') { $prefix = @('-3') }
    $out = & $name @prefix -c $probe 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { continue }
    try { $info = ConvertFrom-Json ([string](@($out)[-1])) } catch { continue }
    if ($info[0] -eq 3 -and $info[1] -ge 8 -and $info[2]) {
      $script:PythonPath = [string]$info[2]
      return $script:PythonPath
    }
  }
  return $null
}

function Confirm-Python {
  if (Find-Python) { return $true }
  $store = 'ms-windows-store://search/?query=Python%203.12'
  $choice = Show-Choice ("Python 3 est nécessaire : il lit les journaux de Claude Code et Codex sur ce PC (rien d'autre n'est installé).`n" +
                         "L'installer maintenant ?") @('Installer avec winget', 'Microsoft Store', 'Annuler')
  if ($choice -eq 'Installer avec winget' -and (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    $process = Start-Process -FilePath 'winget.exe' -Wait -PassThru -ArgumentList 'install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements'
    Write-Log ('winget Python : code ' + $process.ExitCode)
  } elseif ($choice -eq 'Installer avec winget' -or $choice -eq 'Microsoft Store') {
    Start-Process -FilePath $store
    if ((Show-Choice "Installe « Python 3.12 » depuis le Microsoft Store, puis clique sur Continuer." @('Continuer', 'Annuler')) -ne 'Continuer') { return $false }
  } else {
    return $false
  }
  Update-Path
  if (Find-Python) { return $true }
  Show-Choice "Python n'est pas encore visible pour Penthouse. Ferme ta session Windows, rouvre-la, puis relance Penthouse (menu Démarrer)." @('OK') | Out-Null
  return $false
}

# Lance un programme sans fenêtre et récupère sa sortie (stdout puis stderr) en gardant l'interface vivante.
function Invoke-Hidden([string]$File, [string]$Arguments, [hashtable]$Environment = @{}) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $File
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
  foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = $Environment[$name] }
  $process = [System.Diagnostics.Process]::Start($info)
  $out = New-Object System.IO.MemoryStream
  $err = New-Object System.IO.MemoryStream
  $copies = @($process.StandardOutput.BaseStream.CopyToAsync($out), $process.StandardError.BaseStream.CopyToAsync($err))
  while (-not $process.WaitForExit(100)) { Update-Ui }
  $process.WaitForExit()
  [System.Threading.Tasks.Task]::WaitAll($copies)
  $text = (ConvertFrom-ConsoleBytes $out.ToArray()) + "`n" + (ConvertFrom-ConsoleBytes $err.ToArray())
  return @{ Code = $process.ExitCode; Output = $text.Trim() }
}

# Python écrit en UTF-8 ; PowerShell 5.1 peut écrire dans la page de code OEM (cp850) : chaque ligne est
# décodée en UTF-8 strict, sinon en OEM, pour garder les accents des messages.
function ConvertFrom-ConsoleBytes([byte[]]$Bytes) {
  if (-not $Bytes -or $Bytes.Length -eq 0) { return '' }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  $oem = $null
  try { $oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage) } catch { $oem = [Text.Encoding]::UTF8 }
  $lines = New-Object System.Collections.Generic.List[string]
  $start = 0
  for ($i = 0; $i -le $Bytes.Length; $i++) {
    if ($i -lt $Bytes.Length -and $Bytes[$i] -ne 10) { continue }
    $count = $i - $start
    if ($count -gt 0 -and $Bytes[$i - 1] -eq 13) { $count-- }
    if ($count -gt 0) {
      try { $lines.Add($utf8.GetString($Bytes, $start, $count)) } catch { $lines.Add($oem.GetString($Bytes, $start, $count)) }
    } else { $lines.Add('') }
    $start = $i + 1
  }
  return ($lines -join "`n")
}

function Get-Tail([string]$Text, [int]$Count) {
  $lines = @($Text -split "`r?`n" | Where-Object { $_.Trim() })
  return (@($lines | Select-Object -Last $Count) -join "`n")
}

# ---------- relier ce PC au penthouse (même procédure que « Relier mes agents ») ----------
# install.ps1 vient du site configuré (HTTPS) ; la clé passe par l'environnement du processus, jamais par sa ligne de commande.
function Invoke-Installer([string]$Site, [string]$Key, [bool]$Replace) {
  $busy = Show-Busy 'Connexion au penthouse en cours...'
  $file = Join-Path ([IO.Path]::GetTempPath()) ('penthouse-install-' + [guid]::NewGuid().ToString('N') + '.ps1')
  try {
    try {
      $text = [string](Invoke-RestMethod -Uri ($Site + '/install.ps1') -UseBasicParsing)
    } catch {
      return @{ Code = 1; Output = ('Téléchargement impossible depuis ' + $Site + ' : ' + $_.Exception.Message) }
    }
    if ($text -notmatch 'penthouse-install-ps1') {
      return @{ Code = 1; Output = "Le site n'a pas renvoyé le script d'installation : un portail Wi-Fi ou un proxy intercepte peut-être la connexion." }
    }
    # BOM : Windows PowerShell 5.1 lit alors le fichier en UTF-8 (accents des messages).
    [IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $true))
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $file + '" -Site "' + $Site + '" -SansApp'
    if ($Replace) { $arguments += ' -Replace' }
    return (Invoke-Hidden $WindowsPowerShell $arguments @{ PENTHOUSE_KEY = $Key })
  } finally {
    Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    $busy.Close()
  }
}

function Connect-PC {
  $current = Read-Setting 'url'
  if (-not $current) { $current = $SiteDefault }
  $site = Show-Input 'Adresse du penthouse :' $current
  if (-not $site) { return $false }
  $site = $site.TrimEnd('/')
  if (-not (Test-Site $site)) {
    Show-Choice 'Adresse invalide : HTTPS est requis pour envoyer la clé (http seulement pour localhost).' @('OK') | Out-Null
    return $false
  }
  $key = Show-Input ("Clé de ton étage (dans « Relier mes agents » sur le site, ou dans %USERPROFILE%\.config\tour\secret sur un PC déjà relié).`n" +
                     "Ce n'est pas le code d'entrée.") '' -Hidden
  if (-not $key) { return $false }
  if (-not (Confirm-Python)) { return $false }
  $result = Invoke-Installer $site $key $false
  if ($result.Code -eq 3) {
    $answer = Show-Choice "Ce PC est déjà relié à une autre clé. La remplacer par celle-ci (l'ancienne configuration est sauvegardée) ?" @('Remplacer', 'Annuler')
    if ($answer -ne 'Remplacer') { return $false }
    $result = Invoke-Installer $site $key $true
  }
  Write-Log ('installation : code ' + $result.Code)
  $summary = Get-Tail $result.Output 8
  if (-not $summary) { $summary = 'Installation terminée (code ' + $result.Code + ').' }
  Show-Choice $summary @('OK') | Out-Null
  return (Test-Linked)
}

function Show-Check {
  $python = Find-Python
  $check = Join-Path $Conf 'tour-check'
  if (-not $python -or -not (Test-Path -LiteralPath $check)) {
    Show-Choice "Ce PC n'est pas encore relié." @('OK') | Out-Null
    return
  }
  $busy = Show-Busy 'Vérification de la connexion au penthouse...'
  try { $result = Invoke-Hidden $python ('"' + $check + '"') } finally { $busy.Close() }
  $summary = Get-Tail $result.Output 6
  if (-not $summary) { $summary = "Ce PC n'est pas encore relié." }
  Show-Choice $summary @('OK') | Out-Null
}

# ---------- outils connus ----------
function Get-Catalog {
  $site = Read-Setting 'url'
  if (-not $site) { $site = $SiteDefault }
  $local = '' + $env:LOCALAPPDATA
  $programs = '' + $env:ProgramFiles
  $under = { param($Base, $Child) if ($Base) { Join-Path $Base $Child } }
  @(
    [ordered]@{ id = 'claude-app'; label = 'Claude (app)'; kind = 'app'; target = ''; names = @('Claude')
                paths = @((& $under $local 'AnthropicClaude\claude.exe')) }
    [ordered]@{ id = 'claude-code'; label = 'Claude Code (terminal)'; kind = 'term'; target = 'claude'; names = @()
                paths = @((& $under $HOME '.local\bin\claude.exe')) }
    [ordered]@{ id = 'codex'; label = 'Codex (terminal)'; kind = 'term'; target = 'codex'; names = @(); paths = @() }
    [ordered]@{ id = 'chatgpt'; label = 'ChatGPT (app)'; kind = 'app'; target = ''; names = @('ChatGPT')
                paths = @((& $under $local 'Programs\ChatGPT\ChatGPT.exe')) }
    [ordered]@{ id = 'cursor'; label = 'Cursor'; kind = 'app'; target = ''; names = @('Cursor')
                paths = @((& $under $local 'Programs\cursor\Cursor.exe'), (& $under $programs 'cursor\Cursor.exe')) }
    [ordered]@{ id = 'windsurf'; label = 'Windsurf'; kind = 'app'; target = ''; names = @('Windsurf')
                paths = @((& $under $local 'Programs\Windsurf\Windsurf.exe'), (& $under $programs 'Windsurf\Windsurf.exe')) }
    [ordered]@{ id = 'grok-app'; label = 'Grok (app)'; kind = 'app'; target = ''; names = @('Grok'); paths = @() }
    [ordered]@{ id = 'grok-web'; label = 'Grok (site web)'; kind = 'url'; target = 'https://grok.com'; names = @(); paths = @() }
    [ordered]@{ id = 'penthouse'; label = 'Le penthouse (site)'; kind = 'url'; target = $site; names = @(); paths = @() }
  )
}

# Applications du menu Démarrer (y compris celles du Microsoft Store, comme ChatGPT), lues une fois.
function Find-StartApp([string]$Name) {
  if ($null -eq $script:StartApps) {
    $script:StartApps = @()
    if (Get-Command Get-StartApps -ErrorAction SilentlyContinue) {
      try { $script:StartApps = @(Get-StartApps) } catch { Write-Log ('Get-StartApps : ' + $_.Exception.Message) }
    }
  }
  foreach ($app in $script:StartApps) { if ($app.Name -eq $Name) { return [string]$app.AppID } }
  return ''
}

# Cible à lancer pour un outil du catalogue ('' s'il n'est pas sur ce PC).
function Resolve-Tool($Tool) {
  if ($Tool.kind -eq 'url') { return [string]$Tool.target }
  if ($Tool.kind -eq 'term' -and (Get-Command $Tool.target -ErrorAction SilentlyContinue)) { return [string]$Tool.target }
  foreach ($path in @($Tool.paths)) { if ($path -and (Test-Path -LiteralPath $path)) { return [string]$path } }
  foreach ($name in @($Tool.names)) {
    $id = Find-StartApp $name
    if ($id) { return 'shell:AppsFolder\' + $id }
  }
  return ''
}

function Find-Tools {
  foreach ($tool in @(Get-Catalog)) {
    $target = Resolve-Tool $tool
    if ($target) { [ordered]@{ id = $tool.id; label = $tool.label; kind = $tool.kind; target = $target } }
  }
}

function Select-Tools {
  $found = @(Find-Tools)
  if ($found.Count -eq 0) {
    Show-Choice 'Aucun outil trouvé sur ce PC.' @('OK') | Out-Null
    return $false
  }
  $saved = @(Read-Apps | ForEach-Object { [string]$_.id })
  $defaults = @('claude-app', 'claude-code', 'cursor', 'penthouse')
  if ($saved.Count -gt 0) { $defaults = $saved }
  $checked = [bool[]]@($found | ForEach-Object { $defaults -contains $_.id })
  $labels = [string[]]@($found | ForEach-Object { $_.label })
  $chosen = Show-Checklist 'Que lancer à chaque ouverture de session ? (seuls les outils trouvés sur ce PC sont proposés)' $labels $checked
  if ($null -eq $chosen) { return $false }
  Save-Apps @($found | Where-Object { $chosen -contains $_.label })
  return $true
}

# Claude Code et Codex : dans Windows Terminal s'il est là, sinon dans une fenêtre PowerShell, depuis le dossier personnel.
function Start-Terminal([string]$Command, [string]$Title) {
  if ($Command -notmatch '^[A-Za-z0-9._-]+$') { $Command = '"& ''' + $Command.Replace("'", "''") + '''"' }
  # Bypass pour cette fenêtre seulement : les raccourcis .ps1 installés par npm sont bloqués sinon.
  $arguments = '-NoExit -ExecutionPolicy Bypass -Command ' + $Command
  $terminal = Get-Command wt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($terminal) {
    Start-Process -FilePath $terminal.Source -ArgumentList ('-d "' + $HOME + '" --title "' + $Title + '" "' + $WindowsPowerShell + '" ' + $arguments)
  } else {
    Start-Process -FilePath $WindowsPowerShell -ArgumentList $arguments -WorkingDirectory $HOME
  }
}

function Start-Tool($App) {
  $target = [string]$App.target
  if ($App.kind -eq 'url') {
    if ($target -notmatch '^https?://') { return $false }
    Start-Process -FilePath $target
    return $true
  }
  if ($App.kind -eq 'term') {
    Start-Terminal $target ($App.label -replace ' \(terminal\)$', '')
    return $true
  }
  if ($App.kind -ne 'app') { return $false }
  # Application déplacée par une mise à jour : on la cherche de nouveau.
  if (-not ($target.StartsWith('shell:AppsFolder\') -or ($target -and (Test-Path -LiteralPath $target)))) {
    $tool = @(Get-Catalog | Where-Object { $_.id -eq $App.id }) | Select-Object -First 1
    $target = ''
    if ($tool) { $target = Resolve-Tool $tool }
    if (-not $target) { return $false }
  }
  if ($target.StartsWith('shell:AppsFolder\')) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"') }
  else { Start-Process -FilePath $target }
  return $true
}

# Relance tout de suite la tâche de suivi (installée par install.ps1), qui tourne ensuite chaque minute ;
# sans la tâche, un passage direct de tour-sync, sans fenêtre.
function Start-Sync {
  $ErrorActionPreference = 'Continue'
  & schtasks /Run /TN $Task 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  $python = Find-Python
  $sync = Join-Path $Conf 'tour-sync'
  if (-not $python -or -not (Test-Path -LiteralPath $sync)) { return }
  $pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
  if (-not (Test-Path -LiteralPath $pythonw)) { $pythonw = $python }
  Start-Process -FilePath $pythonw -ArgumentList ('"' + $sync + '"') -WindowStyle Hidden
}

function Start-Tools {
  $apps = @(Read-Apps)
  if ($apps.Count -eq 0) { return }
  $count = 0
  foreach ($app in $apps) {
    try { if (Start-Tool $app) { $count++ } } catch { Write-Log ('lancement de ' + $app.id + ' : ' + $_.Exception.Message) }
  }
  Start-Sync
  Show-Notification ([string]$count + " outil(s) lancé(s). Tes agents apparaissent au penthouse dès qu'ils travaillent.")
}

# ---------- lancement à l'ouverture de session ----------
# L'app est copiée dans %LOCALAPPDATA%\Penthouse : les raccourcis ne dépendent pas du dossier téléchargé.
function Copy-App {
  $source = [IO.Path]::GetFullPath($Here).TrimEnd('\', '/')
  $target = [IO.Path]::GetFullPath($AppDir).TrimEnd('\', '/')
  if ($source -eq $target) { return }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Get-ChildItem -LiteralPath $source -File | Copy-Item -Destination $target -Force
  try { Get-ChildItem -LiteralPath $target -File | Unblock-File } catch { }   # retire la marque « téléchargé d'Internet »
}

# Raccourci vers l'app : pythonw + Penthouse.pyw (aucune console), sinon PowerShell réduit et masqué.
function New-Shortcut([string]$Path, [string]$Arguments) {
  $python = Find-Python
  $pythonw = ''
  if ($python) { $pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  if ($pythonw -and (Test-Path -LiteralPath $pythonw)) {
    $link.TargetPath = $pythonw
    $link.Arguments = ('"' + (Join-Path $AppDir 'Penthouse.pyw') + '" ' + $Arguments).Trim()
  } else {
    $link.TargetPath = $WindowsPowerShell
    $link.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $AppDir 'Penthouse.ps1') + '" ' + $Arguments).Trim()
    $link.WindowStyle = 7
  }
  $link.WorkingDirectory = $AppDir
  $link.Description = "Penthouse : lance tes outils d'IA et relie ce PC au penthouse"
  $icon = Join-Path $AppDir 'Penthouse.ico'
  if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon + ',0' }
  $link.Save()
}

function Test-LoginInstalled { return (Test-Path -LiteralPath $StartupLink) }

function Install-Login {
  Copy-App
  New-Shortcut $StartupLink '-Login'
  New-Shortcut $MenuLink ''
}

function Remove-Login { Remove-Item -LiteralPath $StartupLink -ErrorAction SilentlyContinue }

function Uninstall-Penthouse {
  $answer = Show-Choice ("Désinstaller Penthouse de ce PC ?`nLe lancement à l'ouverture de session et le suivi automatique " +
                         "(tâche planifiée « " + $Task + " ») sont retirés ; tes outils ne sont pas touchés.") @('Désinstaller', 'Annuler')
  if ($answer -ne 'Désinstaller') { return }
  Remove-Login
  Remove-Item -LiteralPath $MenuLink, $AppsFile -ErrorAction SilentlyContinue
  $ErrorActionPreference = 'Continue'
  & schtasks /Delete /TN $Task /F 2>&1 | Out-Null
  $forget = Show-Choice ("Effacer aussi la clé de ce PC (%USERPROFILE%\.config\tour et ses sauvegardes) ?`n" +
                         "Sans elle, il faudra relier ce PC de nouveau pour réapparaître au penthouse.") @('Effacer la clé', 'Garder la clé')
  if ($forget -eq 'Effacer la clé') {
    $parent = Split-Path -Parent $Conf
    Get-ChildItem -LiteralPath $parent -Directory -Filter 'tour.backup-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Conf -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue
  Show-Choice "Penthouse est désinstallé de ce PC." @('OK') | Out-Null
}

function Show-Settings {
  $choice = Show-Menu 'Réglages' @('Choisir les outils à lancer', 'Vérifier la connexion au penthouse', 'Relier ce PC avec une autre clé',
                                  "Ne plus rien lancer à l'ouverture de session", 'Désinstaller Penthouse', 'Fermer')
  switch ($choice) {
    'Choisir les outils à lancer' { if (Select-Tools) { Install-Login; Show-Notification 'Outils mis à jour.' } }
    'Vérifier la connexion au penthouse' { Show-Check }
    'Relier ce PC avec une autre clé' { [void](Connect-PC) }
    "Ne plus rien lancer à l'ouverture de session" { Remove-Login; Show-Notification "Plus rien ne se lance à l'ouverture de session." }
    'Désinstaller Penthouse' { Uninstall-Penthouse }
  }
}

# ---------- point d'entrée ----------
function Start-Penthouse {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  try { $script:Icon = New-Object System.Drawing.Icon (Join-Path $Here 'Penthouse.ico') } catch { $script:Icon = $null }
  Update-Path
  if ($Login) {
    Start-Tools
    return
  }
  Copy-App
  if (-not (Test-Path -LiteralPath $MenuLink)) { New-Shortcut $MenuLink '' }
  if (-not (Test-Linked)) {
    $start = Show-Choice ("Bienvenue dans le penthouse ! Penthouse relie ce PC à ton étage, puis lance tes outils d'IA " +
                          "à chaque ouverture de session pour que tes agents apparaissent dans la tour.") @('Commencer', 'Quitter')
    if ($start -ne 'Commencer') { return }
    if (-not (Connect-PC)) {
      Show-Choice "Ce PC n'est pas relié. Rouvre Penthouse (menu Démarrer) quand tu as ta clé." @('OK') | Out-Null
      return
    }
  }
  if (@(Read-Apps).Count -eq 0 -or -not (Test-LoginInstalled)) {
    if (-not (Select-Tools)) { return }
    Install-Login
    if ((Show-Choice "C'est prêt : ces outils se lanceront à chaque ouverture de session. Les lancer maintenant ?" @('Lancer', 'Plus tard')) -eq 'Lancer') { Start-Tools }
    return
  }
  switch (Show-Choice 'Penthouse est actif : tes outils se lancent à chaque ouverture de session.' @('Lancer maintenant', 'Réglages...', 'Fermer')) {
    'Lancer maintenant' { Start-Tools }
    'Réglages...' { Show-Settings }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Initialize-Paths
    Start-Penthouse
  } catch {
    Write-Log ('erreur : ' + $_.Exception.Message)
    if (-not $Login) {
      try { [void][System.Windows.Forms.MessageBox]::Show('Penthouse a rencontré une erreur : ' + $_.Exception.Message, 'Penthouse') } catch { }
    }
    exit 1
  }
  exit 0
}
