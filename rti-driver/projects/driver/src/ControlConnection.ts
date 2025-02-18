class ControlConnection { 
    private static PING_INTERVAL: number = 120000;

    private _currentMessage: { size: number, type: ControlMessageType | null } | null = null;
    private _keyPresses: number = 0;
    private _missedPings: number = 0;
    private _receivedFrameBuffer = forge.util.createBuffer();
    private readonly _http: HTTP;
    private readonly _httpTimeoutTimer: Timer;
    private readonly _ipAddress: string;
    private readonly _logger: Logger;
    private readonly _loggerContext: string;
    private readonly _onHttpTimeout: (handle: number) => void;
    private readonly _onPingTimeout: (handle: number) => void;
    private readonly _onReconnect: (handle: number) => void;
    private readonly _stateChanged: (state: ControlConnectionState) => void;
    private readonly _pingTimeoutTimer: Timer;
    private readonly _port: number;
    private readonly _reconnectTimer: Timer;
    
    httpHandle: number;
    httpTimoutTimerHandle: number;
    pingTimeoutTimerHandle: number;
    reconnectTimerHandle: number;
    state: ControlConnectionState;

    constructor(
        ipAddress: string,
        port: number,
        privateKey: string,
        certificate: string,
        onCommRx: (data: string, handle: number) => void,
        onConnect: (handle: number) => void,
        onDisconnect: (handle: number) => void,
        onHttpTimeout: (handl: number) => void,
        onPingTimeout: (handle: number) => void,
        onReconnect: (handle: number) => void,
        onSslHandshakeFailed: (handle: number) => void,
        onSslHandshakeOK: (handle: number) => void,
        stateChanged: () => void,
        logger: Logger
    ) {
        
        this._logger = logger;
        this._loggerContext = "ContorlConnection (" + ipAddress + ":" + port + ")";

        logger.logTrace("constructor", this._loggerContext);

        this._ipAddress = ipAddress;
        this._port = port;

        this._http = new HTTP(onCommRx);
        this._http.UseHandleInCallbacks = true;
        this._http.OnConnectFunc = onConnect;
        this._http.OnDisconnectFunc = onDisconnect;
        this._http.SSLHandshakeTimeout = 5000;
        this._http.OnSSLHandshakeFailedFunc = onSslHandshakeFailed;
        this._http.OnSSLHandshakeOKFunc = onSslHandshakeOK;
        this._http.LoadClientCertificate(certificate, privateKey);

        this._httpTimeoutTimer = new Timer();
        this._httpTimeoutTimer.UseHandleInCallbacks = true;
        this._pingTimeoutTimer = new Timer();
        this._pingTimeoutTimer.UseHandleInCallbacks = true;
        this._reconnectTimer = new Timer();
        this._reconnectTimer.UseHandleInCallbacks = true;

        this._onHttpTimeout = onHttpTimeout;
        this._onPingTimeout = onPingTimeout;
        this._onReconnect = onReconnect;
        this._stateChanged = stateChanged;

        this.state = ControlConnectionState.Disconnected;
        this.httpHandle = this._http.Handle;
        this.httpTimoutTimerHandle = this._httpTimeoutTimer.Handle;
        this.pingTimeoutTimerHandle = this._pingTimeoutTimer.Handle;
        this.reconnectTimerHandle = this._reconnectTimer.Handle;

        logger.logTrace("opening HTTP", this._loggerContext);
        this._http.Open(ipAddress, port);
        this._httpTimeoutTimer.Start(onHttpTimeout, 5000);
    }

    onCommRx(data: string) {
        logger.logTrace("onCommRx", this._loggerContext);
        logger.logTrace("data length (" + data.length + ")", this._loggerContext);

        this._receivedFrameBuffer.putBytes(data);

        logger.logTrace("receivedDataBuffer (" + this._receivedFrameBuffer.toHex() + ")", this._loggerContext);
        logger.logTrace("receivedDataBuffer.length (" + this._receivedFrameBuffer.length() + ")", this._loggerContext);

        if (!this._currentMessage) {
            const messageSize = ProtobufUtil.ReadMessageLength(this._receivedFrameBuffer);

            logger.logTrace("new message size (" + messageSize + ")", this._loggerContext);

            if (!messageSize) { return; }  // Need more bytes to determine message size

            this._currentMessage = {
                size: messageSize,
                type: null
            }
        }

        if (this._currentMessage && this._receivedFrameBuffer.length() >= this._currentMessage.size) {
            let messageBuffer = forge.util.createBuffer(this._receivedFrameBuffer.getBytes(this._currentMessage.size));
            logger.logTrace("handling message (" + messageBuffer.toHex() + ")", this._loggerContext);

            const keyBytes = ProtobufUtil.ReadVarInt(messageBuffer);

            if (!keyBytes) {
                logger.logError("Failed to extract message key bytes from buffer", this._loggerContext);
            }

            logger.logTrace("keyBytes (" + keyBytes + ")", this._loggerContext);

            const key = ProtobufUtil.DecodeKey(keyBytes as number);

            if (!key) {
                logger.logError("Failed to decode message key from buffer", this._loggerContext);
            }

            logger.logTrace("key field number (" + key.FieldNumber + "), wire type (" + key.WiretType + ")", this._loggerContext);

            this._currentMessage.type = key.FieldNumber;

            switch (this._currentMessage.type) {
                case ControlMessageType.Configure:
                    logger.logTrace("Received Configure message", this._loggerContext);
                    this.sendConfigure();                    
                    break;

                case ControlMessageType.SetActive:
                    logger.logTrace("Received SetActive message", this._loggerContext);
                    this.setState(ControlConnectionState.Configured);
                    this.sendActive();                    
                    break;

                case ControlMessageType.PingRequest:
                    logger.logTrace("Received Ping message", this._loggerContext);

                    this._missedPings = 0;

                    logger.logTrace("Starting messageBuffer length (" + messageBuffer.length() + ")", this._loggerContext);

                    let nestedLength = ProtobufUtil.ReadVarInt(messageBuffer);

                    logger.logTrace("Nested message length (" + nestedLength + ")", this._loggerContext);
                    
                    let nestedKeyBytes: number | null;
                    while(nestedKeyBytes = ProtobufUtil.ReadVarInt(messageBuffer)) {

                        logger.logTrace("nestedKeyBytes (" + nestedKeyBytes + ")", this._loggerContext);

                        logger.logTrace("messageBuffer length (" + messageBuffer.length() + ")", this._loggerContext);

                        const nestedKey = ProtobufUtil.DecodeKey(nestedKeyBytes as number);

                        logger.logTrace("nestedKey field number (" + nestedKey.FieldNumber + "), wire type (" + nestedKey.WiretType + ")", this._loggerContext);

                        if (!nestedKey) {
                            logger.logError("Failed to decode message nested key from buffer", this._loggerContext);
                            break;
                        }

                        if (nestedKey.FieldNumber == 1) {
                            const pingCount = ProtobufUtil.ReadVarInt(messageBuffer);

                            if (!pingCount) {
                                logger.logError("Failed to read ping count from buffer", this._loggerContext);
                                break;
                            }
    
                            this.sendPong(pingCount as number);
                            break;
                        }
                    }
                    break;

                default:
                    break;
            }

            this._currentMessage = null;
        }
    }

    onConnect() {
        logger.logTrace("onConnect", this._loggerContext);
        this.setState(ControlConnectionState.Connected);

        if (this._httpTimeoutTimer.State == 1) { 
            this._httpTimeoutTimer.Stop();
        }

        if (this._reconnectTimer.State == 1) {
            this._reconnectTimer.Stop();
        }

        this._http.StartSSLHandshake();
    }

    onDisconnect() {
        logger.logTrace("onDisconnect", this._loggerContext);
        this._logger.logTrace("http disconnected, reconnecting", this._loggerContext);
        this.reconnect(5000);
    }

    onHttpTimeout() {
        logger.logTrace("onHttpTimeout", this._loggerContext);
        this._logger.logTrace("http connection timed out, reconnecting", this._loggerContext);
        this.setState(ControlConnectionState.Failed);
        this.reconnect(5000);
    }

    onPingTimeout() {
        logger.logTrace("onPingTimeout", this._loggerContext);

        if (this.state <= ControlConnectionState.Disconnected) {
            return;
        }

        this._missedPings++;
        this._logger.logTrace("missed ping, total (" + this._missedPings + ")", this._loggerContext);

        if (this._missedPings > 2) {
            this._logger.logTrace("missed too many pings, reconnecting", this._loggerContext);
            this.reconnect();
        }

        this.reschedulePingTimer();
    }

    onReconnect() {
        logger.logTrace("onReconnect", this._loggerContext);
        this._http.Open(this._ipAddress, this._port);

        if (this._httpTimeoutTimer.State == 1) {
            this._httpTimeoutTimer.Stop();
        }

        this._httpTimeoutTimer.Start(this._onHttpTimeout, 5000);
    }

    onSslHandshakeFailed() {
        logger.logTrace("onSslHandshakeFailed", this._loggerContext);
        this._logger.logTrace("TLS handshake failed, reconnecting", this._loggerContext);
        this.reconnect(5000);
    }

    onSSLHandshakeOK() {
        logger.logInfo("onSSLHandshakeOKFunc", this._loggerContext);
        this.setState(ControlConnectionState.Paired);

        logger.logInfo("TLS handshake succeeeded, starting scheduled ping checks", this._loggerContext);
        this.reschedulePingTimer();
    }

    reconnect(delay: number = 0) {
        logger.logTrace("reconnect, delay: [" + delay + "]", this._loggerContext);

        if (this._reconnectTimer.State == 1) {
            this._reconnectTimer.Stop();
        }

        this.disconnect();
        this._reconnectTimer.Start(this._onReconnect, delay);
    }

    sendActive() {
        logger.logTrace("sendActive", this._loggerContext);

        this._http.Write(forge.util.hexToBytes("05120308EE04"));
    }

    sendConfigure() {
        logger.logTrace("sendConfigure", this._loggerContext);

        // Android TV Remote Service Config Mask
        // {
        //     PING_CONTROL(1),
        //     KEYBOARD(2),
        //     IME(4),
        //     VOICE(8),
        //     PTT_ASSISTANT(16),
        //     POWER(32),
        //     VOLUME(64),
        //     MEDIA_SESSION(128),
        //     GAMEPAD(256),
        //     APP_LINK(512),
        //     AUDIO_DEVICES(1024)
        // }

        this._http.Write(forge.util.hexToBytes("050A0308EE04"));
    }

    sendIntent(intentUri: string) {
        this.sendIntentInternal(intentUri, null);
    }

    sendIntentInternal(intentUri: string, packageName: string | null) {
        logger.logTrace("sendIntent intentUri (" + intentUri + "), packageName (" + packageName + ")", this._loggerContext);

        const intentPayloadBuffer = forge.util.createBuffer();
        intentPayloadBuffer.putBytes(intentUri ?? "");

        const nestedPayloadBuffer = forge.util.createBuffer();

        nestedPayloadBuffer.putBytes(ProtobufUtil.EncodeKey(1, 2)!.getBytes());
        nestedPayloadBuffer.putBytes(ProtobufUtil.CreateVarInt(intentPayloadBuffer!.length())!.bytes())
        nestedPayloadBuffer.putBytes(intentPayloadBuffer.bytes());

        // TODO: Figure out how to pass PackageName in protobuf without causing disconnection
        // if (packageName) {
        //     const packageNamePayloadBuffer = forge.util.createBuffer();
        //     packageNamePayloadBuffer.putBytes(packageName ?? "");

        //     nestedPayloadBuffer.putBytes(ProtobufUtil.EncodeKey(3, 2)!.getBytes());
        //     nestedPayloadBuffer.putBytes(ProtobufUtil.CreateVarInt(packageNamePayloadBuffer!.length())!.bytes())
        //     nestedPayloadBuffer.putBytes(packageNamePayloadBuffer.bytes());
        // }

        // nestedPayloadBuffer.putBytes(ProtobufUtil.EncodeKey(7, 0)!.getBytes());
        // nestedPayloadBuffer.putBytes(ProtobufUtil.CreateVarInt(1)!.getBytes()); // Redirect to app store

        // nestedPayloadBuffer.putBytes(ProtobufUtil.EncodeKey(15, 0)!.getBytes());
        // nestedPayloadBuffer.putBytes(ProtobufUtil.CreateVarInt(0)!.getBytes()); // Start playback

        const messageBuffer = forge.util.createBuffer();
        messageBuffer.putBytes(ProtobufUtil.EncodeKey(90, 2)!.getBytes());
        messageBuffer.putBytes(ProtobufUtil.CreateVarInt(nestedPayloadBuffer!.length())!.bytes());
        messageBuffer.putBytes(nestedPayloadBuffer.bytes());

        const frameBuffer = forge.util.createBuffer();
        frameBuffer.putBytes(ProtobufUtil.CreateMessageLength(messageBuffer)!.getBytes());
        frameBuffer.putBytes(messageBuffer.getBytes());

        logger.logTrace("sending intent (" + frameBuffer.toHex() + ")", this._loggerContext);

        this._http.Write(frameBuffer.getBytes());
    }

    sendKey(key: number, action: KeyAction) {
        logger.logTrace("sendKey key (" + key + "), action (" + action + ")", this._loggerContext);

        const keyPayloadBuffer = ProtobufUtil.CreateVarInt(key);

        if (!keyPayloadBuffer) {
            logger.logError("failed creating keyPayloadBuffer", this._loggerContext);
            return;
        }

        logger.logTrace("keyPayloadBuffer (" + keyPayloadBuffer.toHex() + ")", this._loggerContext);

        const actionPayloadBuffer = ProtobufUtil.CreateVarInt(action);

        if (!actionPayloadBuffer) {
            logger.logError("failed creating actionPayloadBuffer", this._loggerContext);
            return;
        }

        logger.logTrace("actionPayloadBuffer (" + actionPayloadBuffer.toHex() + ")", this._loggerContext);

        const nestedPayloadBuffer = forge.util.createBuffer();
        nestedPayloadBuffer.putByte(8); // Key key (x08)
        nestedPayloadBuffer.putBytes(keyPayloadBuffer.bytes());
        nestedPayloadBuffer.putByte(16) // Action key (x10)
        nestedPayloadBuffer.putBytes(actionPayloadBuffer.bytes());

        const nestedPayloadSizeBuffer = ProtobufUtil.CreateVarInt(nestedPayloadBuffer!.length());  // key key (08) length + key payload length + action key (10) length + action payload length

        if (!nestedPayloadSizeBuffer) {
            logger.logError("failed creating nestedPayloadSizeBuffer", this._loggerContext);
            return;
        }

        logger.logTrace("nestedPayloadSizeBuffer (" + nestedPayloadSizeBuffer.toHex() + ")", this._loggerContext);

        const messageBuffer = forge.util.createBuffer();
        messageBuffer.putByte(82); // SendKey key (x52)
        messageBuffer.putBytes(nestedPayloadSizeBuffer.bytes());
        messageBuffer.putBytes(nestedPayloadBuffer.bytes());

        const frameBuffer = forge.util.createBuffer();
        frameBuffer.putBytes(ProtobufUtil.CreateMessageLength(messageBuffer)!.getBytes());
        frameBuffer.putBytes(messageBuffer.getBytes());

        logger.logTrace("sending key action (" + frameBuffer.toHex() + ")", this._loggerContext);

        this._http.Write(frameBuffer.getBytes());
    }
    
    private disconnect() {
        logger.logTrace("disconnect", this._loggerContext);

        if (this._http.OpenState == 1) {
            logger.logTrace("connection open, closing", this._loggerContext);
            this._http.Close();
        }

        this.setState(ControlConnectionState.Disconnected);
    }
  
    private getMessageBuffer(messageType: ControlMessageType): forge.util.ByteStringBuffer {
        const buffer = forge.util.createBuffer();

        buffer.putByte(1);
        buffer.putByte(messageType);
        buffer.putInt16(0); // add zero for intiial packet size

        return buffer;
    }

    private reschedulePingTimer() {
        this._logger.logTrace("reschedulePingTimer", this._loggerContext);
        if (this.state <= ControlConnectionState.Disconnected) {
            this._logger.logTrace("not rescheduling ping timer due to being disconnected", this._loggerContext);
            return;
        }

        this._logger.logTrace("rescheduling ping timer", this._loggerContext);
        if (this._pingTimeoutTimer.State == 1) {
            this._pingTimeoutTimer.Stop();
        }
        this._pingTimeoutTimer.Start(this._onPingTimeout, ControlConnection.PING_INTERVAL);
    }

    private sendPong(count: number) {
        logger.logTrace("sendPong, count (" + count + ")", this._loggerContext);

        const countPayloadBuffer = ProtobufUtil.CreateVarInt(count);

        if (!countPayloadBuffer) {
            logger.logError("failed creating countPayloadBuffer", this._loggerContext);
            return;
        }

        logger.logTrace("countPayloadBuffer (" + countPayloadBuffer.toHex() + ")", this._loggerContext);

        const nestedPayloadBuffer = forge.util.createBuffer();
        nestedPayloadBuffer.putByte(8); // Count key (x08)
        nestedPayloadBuffer.putBytes(countPayloadBuffer.bytes());

        const nestedPayloadSizeBuffer = ProtobufUtil.CreateVarInt(nestedPayloadBuffer!.length());  // count key (08) length + count payload length

        if (!nestedPayloadSizeBuffer) {
            logger.logError("failed creating nestedPayloadSizeBuffer", this._loggerContext);
            return;
        }

        logger.logTrace("nestedPayloadSizeBuffer (" + nestedPayloadSizeBuffer.toHex() + ")", this._loggerContext);

        const messageBuffer = forge.util.createBuffer();
        messageBuffer.putByte(74); // SendKey key (x4a)
        messageBuffer.putBytes(nestedPayloadSizeBuffer.bytes());
        messageBuffer.putBytes(nestedPayloadBuffer.bytes());

        const frameBuffer = forge.util.createBuffer();
        frameBuffer.putBytes(ProtobufUtil.CreateMessageLength(messageBuffer)!.getBytes());
        frameBuffer.putBytes(messageBuffer.getBytes());

        logger.logTrace("sending pong (" + frameBuffer.toHex() + ")", this._loggerContext);

        this._http.Write(frameBuffer.getBytes());
    }

    private setPayloadSize(messageBuffer: forge.util.ByteStringBuffer) {
        const payloadSize = messageBuffer.length() - 4;

        messageBuffer.setAt(2, payloadSize >> 8 & 0xFF);
        messageBuffer.setAt(3, payloadSize & 0xFF);
    }
    
    private setState(state: ControlConnectionState) {
        logger.logTrace("setState, state: [" + ControlConnectionState[state] + "]", this._loggerContext);

        if (this.state == ControlConnectionState.Failed && state == ControlConnectionState.Disconnected) { 
            // Failed state overrides Disconnected state
            return;
        }

        if (state !== this.state) {
            this.state = state;
            this._stateChanged(state);
        }
    }
}

enum KeyAction {
    Down = 1,
    Up = 2
}

enum ControlConnectionState {
    Failed = 0,
    Disconnected = 1,
    Connected = 2,
    Paired = 3,
    Configured = 4
};

enum ControlMessageType {
    NotSet = 0,
    Configure = 1,
    SetActive = 2,
    PingRequest = 8,
    PingResponse = 9,
    KeyInject = 10,
    ImeKeyInject = 20,
    ImeBatchEdit = 21,
    ImeShowRequest = 22,
    VoiceBegin = 30,
    VoicePayload = 31,
    VoiceEnd = 32,
    SetVolumeLevel = 50,
    AdjustVolumeLevel = 51,
    SetPreferredAudioDevice = 60,
    ResetPreferredAudioDevice = 61,
    AppLinkLaunchRequest = 90
}