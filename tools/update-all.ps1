# 资源AI小站 · 完整自动更新
# 顺序：确保 Clash 在 -> 确保聚合站在 -> 触发抓取 -> 补解析链接 -> 同步小站 -> 提交推送
# 由计划任务 ResourceAI-Update 在每天 12:00 / 20:00 调用。

$ROOT = "E:\codex_out\GROK\blog2"
$AGG = "E:\codex_out\linux"
$GIT = "D:\Program Files\git\cmd\git.exe"  # git 不在 PATH 里
$CLASH = "D:\Program Files\Clash Party\Clash Party.exe"
$LOG = Join-Path $ROOT "logs\update.log"

$null = New-Item -ItemType Directory -Path (Join-Path $ROOT "logs") -Force
function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -LiteralPath $LOG -Value $line -Encoding utf8
    Write-Host $line
}
function PortListening($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Log "==== 更新开始 ===="

# 1. Clash：Jina 必须走代理，7890 不在就直接拉起
if (-not (PortListening 7890)) {
    Log "Clash 未运行，尝试启动"
    if (Test-Path -LiteralPath $CLASH) {
        Start-Process -FilePath $CLASH -WorkingDirectory (Split-Path $CLASH)
        for ($i = 0; $i -lt 12; $i++) {
            Start-Sleep -Seconds 5
            if (PortListening 7890) { break }
        }
    } else {
        Log "找不到 Clash 可执行文件，跳过代理启动"
    }
}
if (PortListening 7890) { Log "Clash 就绪（7890）" } else { Log "警告：7890 仍未监听，抓取可能失败" }

# 2. 聚合站：没起来就 node server.js（必须放在 Clash 之后，否则代理探测拿不到 7890）
if (-not (PortListening 3000)) {
    Log "聚合站未运行，启动 server.js"
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $AGG -WindowStyle Hidden
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 2
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/state" -TimeoutSec 8
            break
        } catch { }
    }
}
try {
    $state = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/state" -TimeoutSec 20
    Log "聚合站在线：round=$($state.round) ok=$($state.okSources)/$($state.totalSources)"
} catch {
    Log "聚合站不可用，本次跳过：$($_.Exception.Message)"
    exit 0
}

# 3. 触发抓取（服务端刷新要 2-4 分钟；刚启动服务时会自己先跑一轮，此时 POST 返回 409）
try {
    $beforeRaw = (Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/state" -UseBasicParsing -TimeoutSec 20).Content
    $before = ([regex]::Match($beforeRaw, '"lastRefresh":"([^"]*)"')).Groups[1].Value
    $refresh = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/refresh" -Method Post -TimeoutSec 600
    Log "刷新完成：round=$($refresh.round) ok=$($refresh.okSources)/$($refresh.totalSources) active=$($refresh.activeCount)"
} catch {
    Log "刷新请求未直接完成（$($_.Exception.Message)），等待服务端那轮跑完"
    for ($i = 0; $i -lt 48; $i++) {
        Start-Sleep -Seconds 10
        try {
            $nowRaw = (Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/state" -UseBasicParsing -TimeoutSec 20).Content
            $now = ([regex]::Match($nowRaw, '"lastRefresh":"([^"]*)"')).Groups[1].Value
            if ($now -and $now -ne $before) {
                $ok = ([regex]::Match($nowRaw, '"okSources":(\d+)')).Groups[1].Value
                $round = ([regex]::Match($nowRaw, '"round":(\d+)')).Groups[1].Value
                Log "服务端刷新已完成：round=$round ok=$ok last=$now"
                break
            }
        } catch { }
        if ($i -eq 47) { Log "等待刷新超时，继续用库里现有数据" }
    }
}

# 4. 补解析帖内网盘链接（刷新只解析最近 30 条）
try {
    $out = & node (Join-Path $AGG "tools\enrich-loop.mjs") 2>&1
    Log ("补解析：" + (($out | Out-String).Trim() -replace "`r?`n", " | "))
} catch {
    Log "补解析失败：$($_.Exception.Message)"
}

# 5. 同步小站（内部会重算 updates.json）
Push-Location -LiteralPath $ROOT
try {
    $sync = & node "tools\sync-linuxdo.mjs" 2>&1
    $syncText = ($sync | Out-String).Trim()
    Log ("同步：" + ($syncText -replace "`r?`n", " "))
    if ($LASTEXITCODE -ne 0) {
        Log "同步失败，跳过提交"
        exit 0
    }

    # 6. 提交推送
    & $GIT add -A 2>&1 | Out-Null
    & $GIT diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Log "无变更，不提交"
        exit 0
    }
    & $GIT commit -m "auto: sync netdisk resources" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "提交失败"
        exit 0
    }
    & $GIT push origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Log "已推送" } else { Log "推送失败，检查 git 凭据" }
} finally {
    Pop-Location
}

Log "==== 更新结束 ===="
