class ConfigurationHost {
    private _webSocketChannel?: number;

    private readonly _logger: Logger;
    private readonly _loggerContext: string;
    private readonly _onConfigureCompanionApp: (deviceIndex: number) => void;
    private readonly _onInitiatePairing: (deviceIndex: number) => void;
    private readonly _onInstallCompanionApp: (deviceIndex: number) => void;
    private readonly _onSendPairingAnswer: (deviceIndex: number, answer: string) => void;
    private readonly _onWebSocketConnected: () => void;
    private readonly _tcp: TCPServer;

    constructor(
        port: number,
        onCommRx: (channel: number, data: string, handle: number) => void,
        onConfigureCompanionApp: (deviceIndex: number) => void,
        onInitiatePairing: (deviceIndex: number) => void,
        onInstallCompanionApp: (deviceIndex: number) => void,
        onSendPairingAnswer: (deviceIndex: number, answer: string) => void,
        onWebSocketConnected: () => void,
        logger: Logger
    ) {
        this._tcp = new TCPServer(onCommRx);
        this._tcp.UseHandleInCallbacks = true;

        this._onConfigureCompanionApp = onConfigureCompanionApp;
        this._onInitiatePairing = onInitiatePairing;
        this._onInstallCompanionApp = onInstallCompanionApp;
        this._onSendPairingAnswer = onSendPairingAnswer;
        this._onWebSocketConnected = onWebSocketConnected;

        this._logger = logger;
        this._loggerContext = 'ConfigurationHost (' + port + ')';

        this._tcp.Listen('GenericServer', port);
    }

    onCommRx(channel: number, data: string, handle: number) {
        this._logger.logTrace('OnCommRx', this._loggerContext);
        this._logger.logTrace('channel [' + channel + '], data length [' + data.length + '], data [' + data + ']', this._loggerContext);

        if (data.indexOf('websocket') > -1) {
            this.sendWebSocketUpgradeResponse(channel, data);
        }
        else if (data.indexOf('OPTIONS') == 0) {
            this._logger.logTrace('Handling OPTIONS', this._loggerContext);
            const header = 'HTTP/1.0 200 OK\r\nServer: HTTP Server\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: *\r\nAccess-Control-Allow-Headers: *\r\n\r\n';
            this._tcp.Write(channel, header);
            this._tcp.CloseChannel(channel);
        }
        else if (data.indexOf('GET') === 0) {
            this._logger.logTrace('Handling GET', this._loggerContext);

            const targetArray = data.split(' ', 2);
            this._logger.logTrace('targetArray: [' + JSON.stringify(targetArray) + ']', this._loggerContext);
                 
            if (targetArray.length < 2) {
                this._logger.logTrace('Bad Taget, target.length: [' + targetArray.length + ']', this._loggerContext);
                this.sendErrorResponse(channel, 'Bad target');
                return;
            }
    
            let target = data.split(' ', 2)[1];
    
            if (target == '/') { target = 'index.html'; }
            target = target.indexOf('/') == 0 ? target.substr(1) : target; // Make target relative (remove leading slash)
        
            this._logger.logTrace('target: [' + target + ']', this._loggerContext);
        
            this.sendFileResponse(channel, target);
        } else if (data.indexOf('POST') === 0) {
            this._logger.logTrace('Handling POST', this._loggerContext);

            const bodyStartIndex = data.indexOf('{');
            const bodyEndIndex = data.lastIndexOf('}') + 1;
            const bodyJson =  data.substr(bodyStartIndex, bodyEndIndex - bodyStartIndex);
            this._logger.logTrace('Request Body JSON: [' + bodyJson + ']', this._loggerContext);
            const body = JSON.parse(bodyJson);

            // handle API POST
            if (data.indexOf('ConfigureCompanionApp') > -1) {
                this._onConfigureCompanionApp(body.deviceIndex);
                this.sendOkResponse(channel);
            } else if (data.indexOf('InitiatePairing') > -1) {
                this._onInitiatePairing(body.deviceIndex);
                this.sendOkResponse(channel);
            } else if (data.indexOf('InstallCompanionApp') > -1) {
                this._onInstallCompanionApp(body.deviceIndex);
                this.sendOkResponse(channel);
            } else if (data.indexOf('SendAnswer') > -1) {
                this._onSendPairingAnswer(body.deviceIndex, body.answer);
                this.sendOkResponse(channel);
            } else {
                this._logger.logTrace('Unrecognized API request: ' + data, this._loggerContext);
                this.sendErrorResponse(channel, 'Unrecognized API request.');
            }
        }
    }

    sendState(devices: Device[]) {
        if (this._webSocketChannel) {
            const payload = JSON.stringify(
                devices
                    .slice(1) // First index in array is null
                    .map(device => {
                        const deviceState: DeviceState = {
                            index: device.index,
                            ipAddress: device.ipAddress,
                            name: device.name,
                            controlState: ControlConnectionState[device.controlConnection.state],
                            pairingState: device.pairingConnection?.state ? PairingState[device.pairingConnection?.state] : ""
                        }

                        return deviceState;
                    })
            );

            this._logger.logTrace('sendState payload: ' + payload, this._loggerContext);

            const buffer = new forge.util.ByteStringBuffer();
            buffer.putByte(129);

            if (payload.length <= 125) {
                buffer.putByte(payload.length)
            } else if (payload.length < Math.pow(2, 16)) {
                buffer.putByte(126);
                buffer.putInt(payload.length, 16);
            }
            else {
                buffer.putByte(127);
                buffer.putInt(payload.length, 64);
            }

            buffer.putBytes(payload);

            this.logBytes('WebSocket State Frame', buffer);

            this._tcp.Write(this._webSocketChannel, buffer.getBytes(buffer.length()));
        }
    }

    private logBytes(label: string, buffer: forge.util.ByteStringBuffer) {
        let datadump = buffer.copy();
        this._logger.logTrace('start ' + label + " data:", this._loggerContext);

        while (datadump.length() > 0) {
            const hex = forge.util.bytesToHex(datadump.getBytes(16)).replace(/(.{2})/g, "$&" + " ");
            this._logger.logTrace(hex);
        }

        this._logger.logTrace('end ' + label + " data:", this._loggerContext);
    }
    
    private sendFileResponse(channel: number, resourceName: string) {
        this._logger.logTrace('sendFileResponse');
        try {
            let payload = System.LoadResource(resourceName);
            if (!payload) {
                this._logger.logTrace('Unrecognized resourceName' + resourceName + ', sending index.html', this._loggerContext);
                payload = System.LoadResource('index.html')
            }

            this._logger.logTrace('Returning 200 Response', this._loggerContext);
            this._tcp!.Write(channel, 'HTTP/1.0 200 OK\r\n');
            const contentType = resourceName.indexOf('css') > -1 ? 'text/css' : (resourceName.indexOf('js') > -1 ? 'text/javascript' : 'text/html');
            const header = 'Server: HTTP Server\r\nCache-Control: no-cache, no-store, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-type: ' + contentType + '; charset=UTF-8\r\nContent-Length: ' + payload.length + '\r\n\r\n';

            this._tcp.Write(channel, header);

            const chunkSize = 1024*8;
            for (let i = 0; i < payload.length/chunkSize; i++) {
                const startIndex = i*chunkSize;
                const endIndex = startIndex + Math.min(chunkSize, payload.length - startIndex);
                this._logger.logTrace(resourceName + " sending chunk: " + startIndex + ", " + endIndex);
                this._tcp.Write(channel, payload.slice(startIndex, endIndex));
            }

            this._tcp.CloseChannel(channel);
        } catch (ex) {
            this._logger.logTrace('Returning 404 Response', this._loggerContext);
            this._tcp.Write(channel, 'HTTP/1.0 404 Not Found\r\n');
            const contentType = 'text/html';
            const header = 'Server: HTTP Server\r\nCache-Control: no-cache, no-store, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-type: ' + contentType + '; charset=UTF-8\r\nContent-Length: ' + ex.length + '\r\n\r\n';
            this._tcp.Write(channel, header + ex);
            this._tcp.CloseChannel(channel);
        }
    }
    
    private sendErrorResponse(channel: number, errorMsg: string) {
        this._logger.logTrace('sendErrorResponse');
        this._tcp.Write(channel, 'HTTP/1.0 400 Bad Request\r\n');

        const resp = '<!DOCTYPE html><html><body>' + errorMsg + '</body></html>\r\n';
        const header = 'Server: HTTP Server\r\nContent-type: text/html; charset=UTF-8\r\nContent-Length: ' + resp.length + '\r\n\r\n';

        this._tcp.Write(channel, header + resp);
        this._tcp.CloseChannel(channel);
    }

    private sendOkResponse(channel: number) {
        this._logger.logTrace('sendOkResponse');
        const header = 'HTTP/1.0 200 OK\r\nServer: HTTP Server\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: *\r\nAccess-Control-Allow-Headers: *\r\n\r\n';
        this._tcp.Write(channel, header);
        this._tcp.CloseChannel(channel);
    }
    
    private sendWebSocketUpgradeResponse(channel: number, data: string) {
        const keyIndex = data.indexOf('Sec-WebSocket-Key:');
        if (keyIndex < 0) { return; }
        const key = data.substr(keyIndex + 'Sec-WebSocket-Key:'.length + 1, 24);
        this._logger.logTrace('Sec-WebSocket-Key: [' + key + ']', this._loggerContext);
        const hashData = key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
        const hash = Crypto.Hash('SHA1', hashData, hashData.length);
        const hashB64 = Crypto.Base64Encode(hash, hash.length);
        this._logger.logTrace('Sec-WebSocket-Accept: [' + hashB64 + ']', this._loggerContext);
        const response = "HTTP/1.1 101 Web Socket Protocol Handshake\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {hashB64}\r\nServer: RTI\r\nUpgrade: websocket".replace('{hashB64}', hashB64) + '\r\n\r\n'; 
        this._logger.logTrace('Sending websocket response: ' + response, this._loggerContext);

        this._tcp.Write(channel, response);

        this._webSocketChannel = channel;
        this._onWebSocketConnected();
    }
}

interface DeviceState {
    index: number,
    ipAddress: string,
    name: string,
    controlState: string,
    pairingState: string
}
