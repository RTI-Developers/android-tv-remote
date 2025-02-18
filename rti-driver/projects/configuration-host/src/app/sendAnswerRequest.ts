export class SendAnswerRequest {
    readonly answer: string = '';
    readonly deviceIndex?: number;
    readonly method: string = 'SendAnswer';

    constructor(deviceIndex: number, answer: string) {
        this.deviceIndex = deviceIndex;
        this.answer = answer;
    }
}