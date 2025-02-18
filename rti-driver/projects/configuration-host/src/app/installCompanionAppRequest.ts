export class InstallCompanionAppRequest {
    readonly deviceIndex?: number;
    readonly method: string = "InstallCompanionApp"

    constructor(deviceIndex: number) {
        this.deviceIndex = deviceIndex;
    }
}