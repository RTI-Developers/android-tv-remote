## Build Instructions

- Create `./android-tv-remote/rti-driver/tools` folder
- Place PackageDriver.exe in `tools` folder
- Open `./android-tv-remote/rti-driver/projects` folder in VS Code
- Run Task `Install Dependencies - All`
- Run Task `Package Driver`
- Locate resultant driver file in `./android-tv-remote/dist` folder

## Recommended Development/Debugging Steps

- Install VS Code recommended extensions
- Run Task `Install Dependencies - All`
- Run Task `Package Driver`
- Locate resultant driver file in `./android-tv-remote/dist` folder
- Include driver in RTI project
- Tick `Enable Trace` in Integration Designer driver configuration
