param([Parameter(Mandatory=$true)][string]$CapturePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$cells = Get-Content -LiteralPath $CapturePath -Raw -Encoding UTF8 | ConvertFrom-Json
$lastRow = $cells.Count - 1
while ($lastRow -gt 0 -and (($cells[$lastRow] | ForEach-Object { $_.text }) -join '').Trim().Length -eq 0) { $lastRow-- }
$cellWidth = 10
$cellHeight = 20
$padding = 14
$bitmap = [System.Drawing.Bitmap]::new($cells[0].Count * $cellWidth + $padding * 2, ($lastRow + 1) * $cellHeight + $padding * 2)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(12,12,12))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = [System.Drawing.Font]::new('Consolas', 16, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$boldFont = [System.Drawing.Font]::new('Consolas', 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::GenericTypographic
try {
  for ($y = 0; $y -le $lastRow; $y++) {
    for ($x = 0; $x -lt $cells[$y].Count; $x++) {
      $cell = $cells[$y][$x]
      if ($cell.text -eq ' ') { continue }
      $color = [System.Drawing.Color]::FromArgb(255, ($cell.color -shr 16) -band 255, ($cell.color -shr 8) -band 255, $cell.color -band 255)
      $brush = [System.Drawing.SolidBrush]::new($color)
      try {
        if ($cell.text -eq [string][char]0x2588) { $graphics.FillRectangle($brush, $padding + $x * $cellWidth, $padding + $y * $cellHeight, $cellWidth, $cellHeight) }
        else {
          $cellFont = if ($cell.bold) { $boldFont } else { $font }
          $graphics.DrawString([string]$cell.text, $cellFont, $brush, [single]($padding + $x * $cellWidth), [single]($padding + $y * $cellHeight), $format)
        }
      } finally { $brush.Dispose() }
    }
  }
  $destination = [IO.Path]::ChangeExtension([IO.Path]::GetFullPath($CapturePath), '.png')
  $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $destination
} finally { $font.Dispose(); $boldFont.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
