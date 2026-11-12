# 一键启动本地预览 + 临时公网地址
# 用法：右键“使用 PowerShell 运行”，或在终端执行  powershell -ExecutionPolicy Bypass -File .\启动预览.ps1

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) {
  $py = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
}

Write-Host '正在启动本地服务（端口 8848）...' -ForegroundColor Cyan
$server = Start-Process -WindowStyle Hidden -PassThru $py -ArgumentList '-m', 'http.server', '8848', '--bind', '0.0.0.0'
Start-Sleep -Seconds 2

$ip = (ipconfig | Select-String 'IPv4' | ForEach-Object { ($_ -split ':')[-1].Trim() } | Select-Object -First 1)
Write-Host ''
Write-Host "本机预览： http://127.0.0.1:8848" -ForegroundColor Green
Write-Host "同一Wi-Fi：http://${ip}:8848" -ForegroundColor Green
Write-Host ''
Write-Host '正在建立临时公网隧道（关闭此窗口即失效）...' -ForegroundColor Cyan
Write-Host ''

try {
  ssh -T -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ServerAliveInterval=30 -R 80:127.0.0.1:8848 nokey@localhost.run
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  Write-Host '已停止本地服务。' -ForegroundColor DarkGray
}
