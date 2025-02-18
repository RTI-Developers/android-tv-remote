class Logger {
    private readonly _enableTrace: boolean;
    private readonly _prefix: string;

    constructor(prefix: string, enableTrace: boolean) {
        this._enableTrace = enableTrace;
        this._prefix = prefix;
    }

    logError(message: string, context?: string) {
        this.logInternal("Error", message, context);
    }

    logInfo(message: string, context?: string) {
        this.logInternal("Info", message, context);
    }

    logTrace(message: string, context?: string) {
        if (this._enableTrace) {
            this.logInternal("Trace", message, context);
        }
    }

    private logInternal(messageType: string, message: string, context?: string) {
        let prefix = this._prefix + " [" + messageType + "] - ";
        if (context) {
            prefix += "Context: [" + context + "] - ";
        }
        System.Print(prefix + message);
    }
}