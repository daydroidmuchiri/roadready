$ProgressPreference = 'SilentlyContinue'

Write-Host "Downloading OpenJDK 17..."
Invoke-WebRequest -Uri "https://download.java.net/java/GA/jdk17.0.2/dfd4a8d0985749f896bed50d7138ee7f/8/GPL/openjdk-17.0.2_windows-x64_bin.zip" -OutFile "jdk.zip"
Write-Host "Extracting OpenJDK..."
Expand-Archive -Path "jdk.zip" -DestinationPath "jdk_temp" -Force

Write-Host "Downloading bundletool..."
Invoke-WebRequest -Uri "https://github.com/google/bundletool/releases/download/1.15.6/bundletool-all-1.15.6.jar" -OutFile "bundletool.jar"

$java = ".\jdk_temp\jdk-17.0.2\bin\java.exe"

$aabFiles = Get-ChildItem -Filter "*.aab"
$i = 1
foreach ($aab in $aabFiles) {
    $outApks = "app$i.apks"
    $outZip = "app$i.zip"
    $outDir = "app$i"
    
    Write-Host "Converting $($aab.Name) to Universal APK..."
    & $java -jar bundletool.jar build-apks --bundle="$($aab.FullName)" --output="$outApks" --mode=universal
    
    Rename-Item $outApks $outZip
    Expand-Archive -Path $outZip -DestinationPath $outDir -Force
    
    Move-Item "$outDir\universal.apk" ".\app$i-universal.apk" -Force
    Write-Host "Created app$i-universal.apk"
    $i++
}

Write-Host "Cleaning up temporary files..."
Remove-Item -Recurse -Force "jdk_temp"
Remove-Item "jdk.zip"
Remove-Item "bundletool.jar"
Remove-Item "app1.zip" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "app1" -ErrorAction SilentlyContinue
Remove-Item "app2.zip" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "app2" -ErrorAction SilentlyContinue

Write-Host "Conversion completed successfully!"
