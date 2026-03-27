$ProgressPreference = 'SilentlyContinue'

Write-Host "Downloading OpenJDK 17..."
Invoke-WebRequest -Uri "https://download.java.net/java/GA/jdk17.0.2/dfd4a8d0985749f896bed50d7138ee7f/8/GPL/openjdk-17.0.2_windows-x64_bin.zip" -OutFile "jdk.zip"
Expand-Archive -Path "jdk.zip" -DestinationPath "jdk_temp" -Force

Write-Host "Downloading bundletool..."
Invoke-WebRequest -Uri "https://github.com/google/bundletool/releases/download/1.15.6/bundletool-all-1.15.6.jar" -OutFile "bundletool.jar"

$keytool = ".\jdk_temp\jdk-17.0.2\bin\keytool.exe"
$java = ".\jdk_temp\jdk-17.0.2\bin\java.exe"

Write-Host "Generating sign key..."
& $keytool -genkey -v -keystore test.keystore -alias test -keyalg RSA -keysize 2048 -validity 10000 -storepass password -keypass password -dname "CN=Test, OU=Test, O=Test, L=Test, S=Test, C=US"

$aabFiles = Get-ChildItem -Filter "*.aab"
$i = 1
foreach ($aab in $aabFiles) {
    Write-Host "Converting and Signing $($aab.Name)..."
    & $java -jar bundletool.jar build-apks --bundle="$($aab.FullName)" --output="app$i-signed.apks" --mode=universal --ks=test.keystore --ks-pass=pass:password --ks-key-alias=test --key-pass=pass:password
    
    Rename-Item "app$i-signed.apks" "app$i-signed.zip"
    Expand-Archive -Path "app$i-signed.zip" -DestinationPath "app$i-extracted" -Force
    Move-Item "app$i-extracted\universal.apk" ".\app$i-signed.apk" -Force
    $i++
}

Write-Host "Cleaning up..."
Remove-Item -Recurse -Force "jdk_temp"; Remove-Item "jdk.zip"; Remove-Item "bundletool.jar"; Remove-Item "test.keystore"
Remove-Item -Recurse -Force "app1-extracted"; Remove-Item "app1-signed.zip" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "app2-extracted"; Remove-Item "app2-signed.zip" -ErrorAction SilentlyContinue

Write-Host "Successfully generated signed APKs!"
