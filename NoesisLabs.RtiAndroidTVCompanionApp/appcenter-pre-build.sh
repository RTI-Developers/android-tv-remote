#!/usr/bin/env bash

echo "Pre-build script executing..."

# Add support for C#9
MonoFrameworkPackage=MonoFramework-MDK-6.12.0.154.macos10.xamarin.universal.pkg
wget https://download.mono-project.com/archive/6.12.0/macos-10-universal/$MonoFrameworkPackage
sudo chmod +x $MonoFrameworkPackage
sudo installer -pkg $MonoFrameworkPackage -target /