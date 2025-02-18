namespace MediaNotification {

    export class Host {
        private readonly _frameBuffer: {size: number, data: string}[] = [];
        private readonly _coverArt: (string | null)[] = [];
        private readonly _logger: Logger;
        private readonly _loggerContext: string;
        private readonly _onError: (deviceIndex: number, error: Error | null) => void;
        private readonly _onMediaStateChanged: (deviceIndex: number, mediaState: MediaStateChanged | null) => void;
        private readonly _onPlaybackStateChanged: (deviceIndex: number, state: PlaybackStateChanged | null) => void;
        private readonly _tcp: TCPServer;

        public Port: number = -1;

        constructor(
            port: number,
            onCommRx: (channel: number, data: string, handle: number) => void,
            onError: (deviceIndex: number, error: Error | null) => void,
            onMediaStateChanged: (deviceIndex: number, mediaState: MediaStateChanged | null) => void,
            onPlaybackStateChanged: (deviceIndex: number, state: PlaybackStateChanged | null) => void,
            logger: Logger
        ) {
            this.Port = port;

            this._tcp = new TCPServer(onCommRx);
            this._tcp.UseHandleInCallbacks = true;

            this._onError = onError;
            this._onMediaStateChanged = onMediaStateChanged;
            this._onPlaybackStateChanged = onPlaybackStateChanged;

            this._logger = logger;
            this._loggerContext = 'MediaNotificationHost (' + port + ')';

            this._tcp.Listen('GenericServer', port);
        }

        onCommRx(channel: number, data: string, handle: number) {
            this._logger.logTrace('OnCommRx, channel [' + channel + '], data length [' + data.length + ']', this._loggerContext);

            if (data.indexOf('GET') === 0 && data.indexOf('deviceIndex=') > 0) {
                const deviceIndex = parseInt(data.substr(data.lastIndexOf('deviceIndex=') + 'deviceIndex='.length, 2));
                this.sendCoverArtResponse(channel, deviceIndex);
                return;
            }

            if (!this._frameBuffer[channel]) {
                this._frameBuffer[channel] = {
                    size: this.stringToInt32(data.substr(0, 4)),
                    data: data.substr(4)
                }
            } else {
                this._frameBuffer[channel].data += data;
            }

            if (this._frameBuffer[channel].data.length >= this._frameBuffer[channel].size) {
                this.processFramePayload(
                    channel, 
                    Crypto.Base64Decode(this._frameBuffer[channel].data, this._frameBuffer[channel].size)
                );
                delete this._frameBuffer[channel];
            }
        }

        private processFramePayload(channel: number, framePayload: string) {
            this._logger.logTrace('processFramePayload, channel: [' + channel + ']', this._loggerContext);

            const message = JSON.parse(framePayload) as ApiMessage;

            if (!message) {
                this._logger.logError('Failed to process body as ApiMessage', this._loggerContext);
                this._tcp.CloseChannel(channel);
            }

            if (message.PayloadType == 'MediaStateChanged') {
                delete this._coverArt[message.DeviceIndex];
                const albumArt = (message.Payload as MediaStateChanged)?.Metadata?.AlbumArt ?? null
                this._coverArt[message.DeviceIndex] = albumArt ? Crypto.Base64Decode(albumArt, albumArt.length) : null;
                this._onMediaStateChanged(message.DeviceIndex, message.Payload as MediaStateChanged ?? null);
            } else if (message.PayloadType == 'PlaybackStateChanged') {
                this._onPlaybackStateChanged(message.DeviceIndex, message.Payload as PlaybackStateChanged ?? null);
            } else if (message.PayloadType == 'ServiceErrorEncountered') {
                this._onError(message.DeviceIndex, message.Payload as Error ?? null);
            } else {
                this._logger.logError('Unrecognized API request.', this._loggerContext);
            }

            this._tcp.CloseChannel(channel);
        }

        private sendCoverArtResponse(channel: number, deviceIndex: number) {
            this._logger.logTrace('sendCoverArtResponse, channel: [' + channel + '], deviceIndex: [' + deviceIndex + ']', this._loggerContext);
            
            let payload = this._coverArt[deviceIndex];
            if (!payload) {
                const errorMsg = 'Could not find cover art for device with index [' + deviceIndex + ']';
                this._logger.logTrace(errorMsg, this._loggerContext);
                this.sendError(channel, errorMsg);
                return;
            }

            this._logger.logTrace('Returning 200 Response', this._loggerContext);
            this._tcp!.Write(channel, 'HTTP/1.0 200 OK\r\n');
            const contentType = 'image/jpeg';
            const header = 'Server: HTTP Server\r\nCache-Control: no-cache, no-store, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-type: ' + contentType + '; charset=UTF-8\r\nContent-Length: ' + payload.length + '\r\n\r\n';

            this._tcp.Write(channel, header);

            const chunkSize = 1024*8;
            for (let i = 0; i < payload.length/chunkSize; i++) {
                const startIndex = i*chunkSize;
                const endIndex = startIndex + Math.min(chunkSize, payload.length - startIndex);
                this._logger.logTrace("sending cover art chunk: " + startIndex + ", " + endIndex);
                this._tcp.Write(channel, payload.slice(startIndex, endIndex));
            }

            this._tcp.CloseChannel(channel);
        }

        private sendError(channel: number, errorMsg: string) {
            this._tcp.Write(channel, 'HTTP/1.0 400 Bad Request\r\n');
    
            const resp = '<!DOCTYPE html><html><body>' + errorMsg + '</body></html>\r\n';
            const header = 'Server: HTTP Server\r\nContent-type: text/html; charset=UTF-8\r\nContent-Length: ' + resp.length + '\r\n\r\n';
    
            this._tcp.Write(channel, header + resp);
            this._tcp.CloseChannel(channel);
        }    

        // Litte-endian conversion
        private stringToInt32(data: string): number {
            return (
                data.charCodeAt(0) ^
                data.charCodeAt(1) << 8 ^
                data.charCodeAt(2) << 16 ^
                data.charCodeAt(3) << 24 
            );
        }
    }

    interface ApiMessage {
        DeviceIndex: number,
        PayloadType: string,
        Payload: Error | MediaStateChanged | PlaybackStateChanged | null
    }

    export interface Error {
        ErrorMessage: string
    }

    export interface MediaStateChanged {
        AppName: string,
        Metadata: Metadata | null,
        PackageName: string,
    }

    export interface Metadata {
        Album: string,
        AlbumArt: string,
        AlbumArtUri: string,
        Artist: string,
        Duration: number,
        Title: string
    }

    export interface PlaybackState {
        State: State,
        Position: number,
        PlaybackSpeed: number
    }

    export interface PlaybackStateChanged {
        PlaybackState: PlaybackState | null
    }

    export enum State {
        STATE_BUFFERING = 6,
        STATE_CONNECTING = 8,
        STATE_ERROR = 7,
        STATE_FAST_FORWARDING = 4,
        STATE_NONE = 0,
        STATE_PAUSED = 2,
        STATE_PLAYING = 3,
        STATE_REWINDING = 5,
        STATE_SKIPPING_TO_NEXT = 10,
        STATE_SKIPPING_TO_PREVIOUS = 9,
        STATE_SKIPPING_TO_QUEUE_ITEM = 11,
        STATE_STOPPED = 1
    }
}
