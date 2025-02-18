class PairingConnection {
    httpHandle: number;
    httpTimeoutTimerHandle: number;
    state: PairingState = PairingState.Connecting;
    
    private readonly _clientCertificate: forge.pki.Certificate;
    private readonly _http: HTTP;
    private readonly _httpTimeoutTimer: Timer;
    private readonly _logger: Logger;
    private readonly _loggerContext: string;
    private readonly _onHttpTimeout: (handle: number) => void;
    private readonly _serverCertificate: forge.pki.Certificate;
    private readonly _pairingStateChanged: (state: PairingState) => void;

    private _currentMessageSize: number | null = null;
    private _receivedDataBuffer = forge.util.createBuffer();

    constructor(
        ipAddress: string,
        port: number,
        privateKey: string,
        publicKey: string,
        serverCert: forge.pki.Certificate,
        onCommRx: (data: string, handle: number) => void,
        onConnect: (handle: number) => void,
        onDisconnect: (handle: number) => void,
        onHttpTimeout: (handle: number) => void,
        onSSLHandshakeFailed: (handle: number) => void,
        onSSLHandshakeOK: (handle: number) => void,
        pairingStateChanged: () => void,
        logger: Logger
    ) {
        this._http = new HTTP(onCommRx);
        this._http.UseHandleInCallbacks = true;
        this._http.OnConnectFunc = onConnect;
        this._http.OnDisconnectFunc = onDisconnect;
        this._http.SSLHandshakeTimeout = 5000;
        this._http.OnSSLHandshakeFailedFunc = onSSLHandshakeFailed;
        this._http.OnSSLHandshakeOKFunc = onSSLHandshakeOK;
        this._http.LoadClientCertificate(publicKey, privateKey);
        this.httpHandle = this._http.Handle;

        this._httpTimeoutTimer = new Timer();
        this._httpTimeoutTimer.UseHandleInCallbacks = true;
        
        this.httpTimeoutTimerHandle = this._httpTimeoutTimer.Handle;

        this._clientCertificate = forge.pki.certificateFromPem(publicKey);
        this._serverCertificate = serverCert;
        this._pairingStateChanged = pairingStateChanged;
        this._logger = logger;
        this._loggerContext = "PairingConnection (" + ipAddress + ":" + port + ")";

        this._http.Open(ipAddress, port);
        this._httpTimeoutTimer.Start(onHttpTimeout, 5000);
    }

    onCommRx(data: string) {
        logger.logTrace("OnCommRx", this._loggerContext);
        logger.logTrace("data length (" + data.length + ")", this._loggerContext);

        this._receivedDataBuffer.putBytes(data);

        logger.logTrace("receivedDataBuffer.length (" + this._receivedDataBuffer.length() + ")", this._loggerContext);

        if (!this._currentMessageSize && this._receivedDataBuffer.length() >= 1) {
            this._currentMessageSize = this._receivedDataBuffer.getInt(8);
            logger.logTrace("setting currentMessageSize to (" + this._currentMessageSize + ")", this._loggerContext);
        }

        if (this._currentMessageSize && this._receivedDataBuffer.length() >= this._currentMessageSize) {
            const messageBuffer = forge.util.createBuffer(this._receivedDataBuffer.getBytes(this._currentMessageSize));
            const serializedMessage = messageBuffer.toHex();
            this._currentMessageSize = null;

            logger.logTrace("serializedMessage (" + serializedMessage + ")", this._loggerContext);

            // Bad message if length is less than 5 or beginning of message doesn't match protocol version 2 and status of 200
            if (serializedMessage.length < 10 || serializedMessage.substring(0, 10) !== "080210c801") {
                logger.logTrace("bad header (" + serializedMessage + ")", this._loggerContext);
                this.setState(PairingState.Failed);
                this.cleanUp();
                return;
            }

            // Advance buffer 5 bytes for protocol version and status
            messageBuffer.getBytes(5);

            const messageType = messageBuffer.getInt(8);

            logger.logTrace("Processing messageType (" + messageType + ")");

            // Match on protobuf representation of enum
            switch (messageType) {
                case 90: // PairingRequestAck
                    // Send Options
                    this._http.Write(forge.util.hexToBytes("16080210c801a2010e0a04080310061204080310061802"));
                    break;

                case 162: // Options
                    // Send Configuration
                    this._http.Write(forge.util.hexToBytes("10080210c801f201080a04080310061001"));
                    break;

                case 250: // ConfigurationAck
                    this.setState(PairingState.WaitingForAnswer);
                    break;

                case 202: // SecretAck
                    this.setState(PairingState.Successful);
                    this.cleanUp();
                    break;
            
                default:
                    break;
            }
        }
    }

    onConnect() {
        logger.logTrace("onConnect", this._loggerContext);
        this.setState(PairingState.Connected);

        if (this._httpTimeoutTimer.State == 1) { 
            this._httpTimeoutTimer.Stop();
        }

        this._http.StartSSLHandshake();
    }

    onDisconnect() {
        logger.logTrace("onDisconnect", this._loggerContext);
        this.setState(PairingState.Failed);
        this.cleanUp();
    }

    onHttpTimeout() {
        logger.logInfo("onHttpTimeout", this._loggerContext);
        this.setState(PairingState.Failed);
        this.cleanUp();
    }

    onSSLHandshakeFailed() {
        logger.logError("sslHandshakeFailed", this._loggerContext);
        this.setState(PairingState.Failed);
        this.cleanUp();
    }

    onSSLHandshakeOK() {
        logger.logInfo("onSSLHandshakeOK", this._loggerContext);
        this.setState(PairingState.Connected);

        // Send PairingRequest: serviceName: com.google.android.videos, clientName: RTI
        this._http.Write(forge.util.hexToBytes("27080210c80152200a19636f6d2e676f6f676c652e616e64726f69642e766964656f731203525449"));
    }

    sendAnswer(answer: string) {
        logger.logInfo("sendAnswer", this._loggerContext);
        logger.logTrace("Answer: " + answer, this._loggerContext);
        this.setState(PairingState.SendingAnswer);

        const secret = forge.util.hexToBytes(answer);
        const nonce = secret.substring(secret.length/2);
        const alpha = this.getAlpha(nonce, this._clientCertificate, this._serverCertificate);

        const secretMessage = "2a080210c801c202220a20" + alpha.toHex()
        
        logger.logTrace("sendAnswer: secretMessage: " + secretMessage, this._loggerContext);
        this._http.Write(forge.util.hexToBytes(secretMessage));
    }

    private cleanUp() {
        this._logger.logTrace("cleanUp", this._loggerContext);
        this._receivedDataBuffer.clear();

        if (this._http.OpenState == 1) {
            this._http.Close();
        }
    }

    private getAlpha(nonce: string, clientCertificate: forge.pki.Certificate, serverCertificate: forge.pki.Certificate) {
        var nonceBuffer = forge.util.createBuffer(nonce);
      
        var clientModulusBuffer = forge.util.createBuffer(forge.util.hexToBytes(clientCertificate.publicKey.n.abs().toString(16)));
        var clientExponentBuffer =forge.util.createBuffer(forge.util.hexToBytes(clientCertificate.publicKey.e.abs().toString(16)));
        var serverModulusBuffer = forge.util.createBuffer(forge.util.hexToBytes(serverCertificate.publicKey.n.abs().toString(16)));
        var serverExponentBuffer = forge.util.createBuffer(forge.util.hexToBytes(serverCertificate.publicKey.e.abs().toString(16)));
      
        this.removeLeadingNullBytes(clientModulusBuffer);
        this.removeLeadingNullBytes(clientExponentBuffer);
        this.removeLeadingNullBytes(serverModulusBuffer);
        this.removeLeadingNullBytes(serverExponentBuffer);
      
        this._logger.logTrace("client modulus (" + clientModulusBuffer.toHex() + ")", this._loggerContext);
        this._logger.logTrace("client exponent (" + clientExponentBuffer.toHex() + ")", this._loggerContext);
        this._logger.logTrace("server modulus (" + serverModulusBuffer.toHex() + ")", this._loggerContext);
        this._logger.logTrace("server exponent (" + serverExponentBuffer.toHex() + ")", this._loggerContext);
        this._logger.logTrace("nonce (" + nonceBuffer.toHex() + ")", this._loggerContext);
      
        const digest = forge.md.sha256.create();
        digest.update(clientModulusBuffer.bytes());
        digest.update(clientExponentBuffer.bytes());
        digest.update(serverModulusBuffer.bytes());
        digest.update(serverExponentBuffer.bytes());
        digest.update(nonceBuffer.bytes());
      
        const digestBytes = digest.digest();
        this._logger.logTrace("generated hash (" + digestBytes.toHex() + ")", this._loggerContext);
        return digestBytes;
    }
      
    private removeLeadingNullBytes(buffer: forge.util.ByteStringBuffer) {
        let offset = 0;
        while (offset < buffer.length() && buffer.bytes()[offset] == "0") {
          offset++;
        }
      
        buffer.getBytes(offset);
    }  

    private setState(state: PairingState) {
        logger.logTrace("setState (" + state + ")", this._loggerContext);
        if (state != this.state) {
            this.state = state;
            this._pairingStateChanged(this.state);
        }
    }
}

interface PairingMessageWrapper {
    protocol_version: number;
    status: number;
    type: PairingMessageType;
    payload: object;
}

enum PairingMessageType {
    PairingRequest = 10,
    PairingRequestAck = 11,
    Options = 20,
    Configuration = 30,
    ConfigurationAck = 31,
    Secret = 40,
    SecretAck = 41
}

enum PairingState {
    Connecting = 1,
    Connected = 2,
    WaitingForAnswer = 3,
    SendingAnswer = 4,
    Successful = 5,
    Failed = 6
}