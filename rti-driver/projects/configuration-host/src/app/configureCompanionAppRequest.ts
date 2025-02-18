export class ConfigureCompanionAppRequest {
    readonly deviceIndex?: number;
    readonly method: string = "ConfigureCompanionApp"

    constructor(deviceIndex: number) {
        this.deviceIndex = deviceIndex;
    }
}