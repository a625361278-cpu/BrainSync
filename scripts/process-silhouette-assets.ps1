$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $root "tmp\silhouette_refs"
$outputDir = Join-Path $root "public\pvp-assets\silhouettes"
New-Item -ItemType Directory -Force $outputDir | Out-Null

$assets = @(
  @{
    Source = "shin-chan.png"
    Output = "shin-chan.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Shin-Chan-PNG-Pic-Background.png"
  },
  @{
    Source = "doraemon.png"
    Output = "doraemon.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/10/Doraemon-No-Background.png"
  },
  @{
    Source = "goku.png"
    Output = "goku.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Goku-Transparent-Images.png"
  },
  @{
    Source = "vegeta.png"
    Output = "vegeta.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Vegeta-PNG-Clipart-Background.png"
  },
  @{
    Source = "piccolo.png"
    Output = "piccolo.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Piccolo-PNG-HD-Quality.png"
  },
  @{
    Source = "krillin.png"
    Output = "krillin.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Krillin-Transparent-PNG.png"
  },
  @{
    Source = "trunks.png"
    Output = "trunks.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Trunks-No-Background.png"
  },
  @{
    Source = "frieza.png"
    Output = "frieza.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Frieza-PNG-HD-Quality.png"
  },
  @{
    Source = "bardock.png"
    Output = "bardock.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Bardock-Free-PNG.png"
  },
  @{
    Source = "naruto.png"
    Output = "naruto.png"
    SourceUrl = "https://www.pngplay.com/wp-content/uploads/12/Hokage-Free-PNG.png"
  }
)

$canvasSize = 512
$padding = 38
$alphaThreshold = 18

function Ensure-SourceAsset {
  param(
    [string] $SourcePath,
    [string] $SourceUrl
  )

  if (Test-Path $SourcePath) {
    return
  }

  if (-not $SourceUrl) {
    throw "参考图不存在且没有配置下载地址：$SourcePath"
  }

  Write-Output "downloading $SourceUrl"
  Invoke-WebRequest `
    -Uri $SourceUrl `
    -OutFile $SourcePath `
    -Headers @{ "User-Agent" = "Mozilla/5.0" } `
    -TimeoutSec 90

  $sourceFile = Get-Item $SourcePath
  if ($sourceFile.Length -lt 10000) {
    Remove-Item -LiteralPath $SourcePath -Force -ErrorAction SilentlyContinue
    throw "参考图下载异常，文件过小：$SourceUrl"
  }
}

function Get-AlphaBounds {
  param([System.Drawing.Bitmap] $Bitmap)

  $minX = $Bitmap.Width
  $minY = $Bitmap.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      $pixel = $Bitmap.GetPixel($x, $y)
      if ($pixel.A -gt $alphaThreshold) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    throw "参考图没有可用透明轮廓像素"
  }

  return [System.Drawing.Rectangle]::FromLTRB($minX, $minY, $maxX + 1, $maxY + 1)
}

function New-OpaqueMask {
  param(
    [System.Drawing.Bitmap] $Source,
    [System.Drawing.Rectangle] $Bounds
  )

  $mask = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $Bounds.Height; $y++) {
    for ($x = 0; $x -lt $Bounds.Width; $x++) {
      $pixel = $Source.GetPixel($Bounds.X + $x, $Bounds.Y + $y)
      if ($pixel.A -gt $alphaThreshold) {
        $mask.SetPixel($x, $y, [System.Drawing.Color]::Black)
      }
      else {
        $mask.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
      }
    }
  }
  return $mask
}

function Remove-SmallBlackComponents {
  param([System.Drawing.Bitmap] $Bitmap)

  $width = $Bitmap.Width
  $height = $Bitmap.Height
  $visited = New-Object bool[] ($width * $height)
  $minComponentArea = 420
  $nearWhiteThreshold = 245

  for ($startY = 0; $startY -lt $height; $startY++) {
    for ($startX = 0; $startX -lt $width; $startX++) {
      $startIndex = ($startY * $width) + $startX
      if ($visited[$startIndex]) {
        continue
      }
      $visited[$startIndex] = $true
      $startPixel = $Bitmap.GetPixel($startX, $startY)
      if ($startPixel.R -ge $nearWhiteThreshold -and $startPixel.G -ge $nearWhiteThreshold -and $startPixel.B -ge $nearWhiteThreshold) {
        continue
      }

      $queue = [System.Collections.Generic.Queue[System.Drawing.Point]]::new()
      $component = [System.Collections.Generic.List[System.Drawing.Point]]::new()
      $queue.Enqueue([System.Drawing.Point]::new($startX, $startY))
      $component.Add([System.Drawing.Point]::new($startX, $startY))

      while ($queue.Count -gt 0) {
        $point = $queue.Dequeue()
        $x = [int] $point.X
        $y = [int] $point.Y
        $directions = @(
          [System.Drawing.Point]::new(1, 0),
          [System.Drawing.Point]::new(-1, 0),
          [System.Drawing.Point]::new(0, 1),
          [System.Drawing.Point]::new(0, -1)
        )

        foreach ($direction in $directions) {
          $nx = $x + $direction.X
          $ny = $y + $direction.Y
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $width -or $ny -ge $height) {
            continue
          }
          $index = ($ny * $width) + $nx
          if ($visited[$index]) {
            continue
          }
          $visited[$index] = $true
          $pixel = $Bitmap.GetPixel($nx, $ny)
          if ($pixel.R -lt $nearWhiteThreshold -or $pixel.G -lt $nearWhiteThreshold -or $pixel.B -lt $nearWhiteThreshold) {
            $queue.Enqueue([System.Drawing.Point]::new($nx, $ny))
            $component.Add([System.Drawing.Point]::new($nx, $ny))
          }
        }
      }

      if ($component.Count -lt $minComponentArea) {
        foreach ($point in $component) {
          $Bitmap.SetPixel($point.X, $point.Y, [System.Drawing.Color]::White)
        }
      }
    }
  }
}

foreach ($asset in $assets) {
  $sourcePath = Join-Path $sourceDir $asset.Source
  Ensure-SourceAsset $sourcePath $asset.SourceUrl

  $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
  try {
    $bounds = Get-AlphaBounds $source
    $available = $canvasSize - ($padding * 2)
    $scale = [Math]::Min($available / $bounds.Width, $available / $bounds.Height)
    $targetWidth = [Math]::Max(1, [Math]::Round($bounds.Width * $scale))
    $targetHeight = [Math]::Max(1, [Math]::Round($bounds.Height * $scale))
    $targetX = [Math]::Round(($canvasSize - $targetWidth) / 2)
    $targetY = [Math]::Round(($canvasSize - $targetHeight) / 2)
    $mask = New-OpaqueMask $source $bounds

    $canvas = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

      $destRect = New-Object System.Drawing.Rectangle $targetX, $targetY, $targetWidth, $targetHeight
      $graphics.DrawImage($mask, $destRect)
      Remove-SmallBlackComponents $canvas

      $outputPath = Join-Path $outputDir $asset.Output
      $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "generated $($asset.Output) from $($asset.Source)"
    }
    finally {
      if ($graphics) { $graphics.Dispose() }
      if ($canvas) { $canvas.Dispose() }
      if ($mask) { $mask.Dispose() }
    }
  }
  finally {
    $source.Dispose()
  }
}
