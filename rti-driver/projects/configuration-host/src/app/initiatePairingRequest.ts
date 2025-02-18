export class InitiatePairingRequest {
    readonly deviceIndex?: number;
    readonly method: string = "InitiatePairing"

    constructor(deviceIndex: number) {
        this.deviceIndex = deviceIndex;
    }
}