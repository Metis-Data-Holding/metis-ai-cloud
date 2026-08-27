param(
    [string]$OutputDirectory = "artifacts/benchmarks"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    throw "未找到 nvidia-smi，请确认 NVIDIA 驱动已正确安装。"
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$outputPath = Join-Path $OutputDirectory "gpu-$runId.csv"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Write-Host "GPU 监控已开始：$outputPath"
Write-Host "测试结束后按 Ctrl+C 停止。"

nvidia-smi `
    --query-gpu=timestamp,index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw `
    --format=csv,nounits `
    -l 1 | Tee-Object -FilePath $outputPath
